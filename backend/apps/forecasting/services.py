"""Forecast orchestration, monthly series construction and read models."""

import logging
from collections import defaultdict
from datetime import date
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework.exceptions import APIException, NotFound

from apps.datasets.models import Dataset
from apps.ingestion.models import FactReturn, FactSales
from apps.organisations.models import Organisation

from .forecast import (
    ANOMALY_METHOD,
    MIN_MONTHS,
    MODEL_NAME,
    MODEL_VERSION,
    forecast_monthly,
)
from .models import ForecastAnomaly, ForecastPoint, ForecastRun, ForecastStatus

logger = logging.getLogger(__name__)
ZERO = Decimal("0")


class InsufficientHistory(APIException):
    status_code = 400
    default_detail = "At least 12 monthly periods are required to forecast."


class ForecastAlreadyRunning(APIException):
    status_code = 409
    default_detail = "A forecast for this organisation is already queued or running."


class ForecastUnavailable(APIException):
    status_code = 503
    default_detail = "The forecast queue is unavailable. Check the broker."


def dataset_for(organisation, dataset_id) -> Dataset | None:  # type: ignore[no-untyped-def]
    if dataset_id is None:
        return None
    dataset = Dataset.objects.filter(id=dataset_id, organisation=organisation).first()
    if dataset is None:
        raise NotFound("Dataset not found.")
    return dataset


def _months(start: date, end: date) -> list[date]:
    months = []
    current = date(start.year, start.month, 1)
    last = date(end.year, end.month, 1)
    while current <= last:
        months.append(current)
        index = current.year * 12 + current.month
        year, month = divmod(index, 12)
        current = date(year, month + 1, 1)
    return months


def monthly_series(organisation, dataset: Dataset | None) -> list[tuple[date, Decimal]]:
    """Net sales per calendar month, with gaps filled as zero."""
    sales = FactSales.objects.filter(dataset__organisation=organisation)
    returns = FactReturn.objects.filter(dataset__organisation=organisation)
    if dataset is not None:
        sales = sales.filter(dataset=dataset)
        returns = returns.filter(dataset=dataset)

    buckets: dict[tuple[int, int], Decimal] = defaultdict(lambda: ZERO)
    for queryset in (sales, returns):
        for row in queryset.values("date_key__year", "date_key__month").annotate(
            total=Sum("net_line_amount")
        ):
            buckets[(row["date_key__year"], row["date_key__month"])] += row["total"] or ZERO

    if not buckets:
        return []

    first = min(buckets)
    last = max(buckets)
    series = []
    for month_start in _months(date(first[0], first[1], 1), date(last[0], last[1], 1)):
        series.append((month_start, buckets.get((month_start.year, month_start.month), ZERO)))
    return series


def start_forecast(*, organisation, dataset_id, horizon: int, user):  # type: ignore[no-untyped-def]
    dataset = dataset_for(organisation, dataset_id)
    series = monthly_series(organisation, dataset)
    if len(series) < MIN_MONTHS:
        raise InsufficientHistory(
            f"At least {MIN_MONTHS} monthly periods are required; "
            f"{len(series)} available for this selection."
        )

    with transaction.atomic():
        Organisation.objects.select_for_update().get(pk=organisation.pk)
        if ForecastRun.objects.filter(
            organisation=organisation,
            status__in=[ForecastStatus.QUEUED, ForecastStatus.RUNNING],
        ).exists():
            raise ForecastAlreadyRunning()

        run = ForecastRun.objects.create(
            organisation=organisation,
            dataset=dataset,
            horizon=horizon,
            model_name=MODEL_NAME,
            model_version=MODEL_VERSION,
            training_start=series[0][0],
            training_end=series[-1][0],
            anomaly_method=ANOMALY_METHOD,
            history=[
                {"period": period.isoformat(), "amount": str(amount)} for period, amount in series
            ],
            created_by=user,
        )

    from .tasks import run_forecast

    try:
        run_forecast.delay(str(run.id))
    except Exception as error:  # noqa: BLE001 - report the queue failure clearly
        logger.exception("Could not enqueue forecast run %s", run.id)
        run.status = ForecastStatus.FAILED
        run.error_message = "The forecast queue is unavailable."
        run.finished_at = timezone.now()
        run.save(update_fields=["status", "error_message", "finished_at"])
        raise ForecastUnavailable() from error

    return run


def execute_forecast(run_id: str) -> str:
    """Run one queued forecast and persist its points and anomalies."""
    run = ForecastRun.objects.get(pk=run_id)
    if run.status != ForecastStatus.QUEUED:
        return run.status

    run.status = ForecastStatus.RUNNING
    run.started_at = timezone.now()
    run.save(update_fields=["status", "started_at"])

    try:
        series = [
            (date.fromisoformat(item["period"]), Decimal(item["amount"])) for item in run.history
        ]
        outcome = forecast_monthly(series, run.horizon)
        with transaction.atomic():
            locked = ForecastRun.objects.select_for_update().get(pk=run.pk)
            ForecastPoint.objects.filter(run=locked).delete()
            ForecastAnomaly.objects.filter(run=locked).delete()
            ForecastPoint.objects.bulk_create(
                [
                    ForecastPoint(
                        run=locked,
                        target_date=point["target_date"],
                        predicted_amount=point["predicted_amount"],
                        lower_bound=point["lower_bound"],
                        upper_bound=point["upper_bound"],
                    )
                    for point in outcome.points
                ]
            )
            ForecastAnomaly.objects.bulk_create(
                [
                    ForecastAnomaly(
                        run=locked,
                        observed_date=anomaly["observed_date"],
                        observed_amount=anomaly["observed_amount"],
                        expected_amount=anomaly["expected_amount"],
                        deviation_amount=anomaly["deviation_amount"],
                        score=anomaly["score"],
                        direction=anomaly["direction"],
                    )
                    for anomaly in outcome.anomalies
                ]
            )
            locked.metrics = outcome.metrics
            locked.anomaly_count = len(outcome.anomalies)
            locked.status = ForecastStatus.SUCCEEDED
            locked.error_message = ""
            locked.finished_at = timezone.now()
            locked.save(
                update_fields=[
                    "metrics",
                    "anomaly_count",
                    "status",
                    "error_message",
                    "finished_at",
                ]
            )
        run.status = ForecastStatus.SUCCEEDED
    except Exception as error:  # noqa: BLE001 - the run records its failure
        logger.exception("Forecast run %s failed", run_id)
        run.status = ForecastStatus.FAILED
        run.error_message = str(error)[:2000]
        run.finished_at = timezone.now()
        run.save(update_fields=["status", "error_message", "finished_at"])

    return run.status


def run_payload(run: ForecastRun, *, detail: bool = False) -> dict:
    payload = {
        "id": str(run.id),
        "status": run.status,
        "granularity": run.granularity,
        "horizon": run.horizon,
        "dataset": ({"id": str(run.dataset.id), "name": run.dataset.name} if run.dataset else None),
        "model_name": run.model_name,
        "model_version": run.model_version,
        "training_start": run.training_start.isoformat() if run.training_start else None,
        "training_end": run.training_end.isoformat() if run.training_end else None,
        "metrics": run.metrics,
        "anomaly_method": run.anomaly_method,
        "anomaly_count": run.anomaly_count,
        "error_message": run.error_message,
        "created_at": run.created_at,
        "started_at": run.started_at,
        "finished_at": run.finished_at,
    }
    if not detail:
        return payload

    payload["history"] = run.history
    payload["points"] = [
        {
            "target_date": point.target_date.isoformat(),
            "predicted_amount": str(point.predicted_amount),
            "lower_bound": str(point.lower_bound),
            "upper_bound": str(point.upper_bound),
        }
        for point in run.points.all()
    ]
    payload["anomalies"] = [
        {
            "id": str(anomaly.id),
            "observed_date": anomaly.observed_date.isoformat(),
            "observed_amount": str(anomaly.observed_amount),
            "expected_amount": str(anomaly.expected_amount),
            "deviation_amount": str(anomaly.deviation_amount),
            "score": str(anomaly.score),
            "direction": anomaly.direction,
            "note": anomaly.note,
            "acknowledged_at": (
                anomaly.acknowledged_at.isoformat() if anomaly.acknowledged_at else None
            ),
        }
        for anomaly in run.anomalies.all()
    ]
    return payload


def runs_payload(organisation, dataset: Dataset | None, limit: int = 20) -> list[dict]:
    runs = ForecastRun.objects.filter(organisation=organisation).select_related("dataset")
    if dataset is not None:
        runs = runs.filter(dataset=dataset)
    return [run_payload(run) for run in runs[:limit]]

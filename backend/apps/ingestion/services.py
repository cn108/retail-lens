"""Processing orchestration and read models for the dataset API.

The API never imports warehouse models: these functions return plain payloads
so the datasets app can present them without crossing the model boundary.
"""

import logging

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import APIException

from apps.datasets.models import Dataset, DatasetStatus

from .canonical import REQUIRED_KEYS
from .models import (
    DataQualityIssue,
    DimCustomer,
    DimGeography,
    DimProduct,
    FactReturn,
    FactSales,
    ProcessingLog,
    ProcessingStatus,
    RawTransaction,
)

logger = logging.getLogger(__name__)


class DatasetNotReady(APIException):
    status_code = 400
    default_detail = "Map the required fields before processing this dataset."


class ProcessingAlreadyRunning(APIException):
    status_code = 409
    default_detail = "This dataset is already queued or processing."


class ProcessingUnavailable(APIException):
    status_code = 503
    default_detail = "The processing queue is unavailable. Check the broker."


def _mapped_fields(dataset: Dataset) -> set[str]:
    if dataset.current_import is None:
        return set()
    return set(
        dataset.current_import.columns.exclude(canonical_field="").values_list(
            "canonical_field", flat=True
        )
    )


def is_processable(dataset: Dataset) -> bool:
    return set(REQUIRED_KEYS).issubset(_mapped_fields(dataset))


def has_active_run(dataset: Dataset) -> bool:
    return dataset.processing_runs.filter(
        status__in=[ProcessingStatus.QUEUED, ProcessingStatus.RUNNING]
    ).exists()


def start_processing(*, dataset: Dataset, user) -> ProcessingLog:  # type: ignore[no-untyped-def]
    """Queue one run and mark the dataset as processing."""
    if not is_processable(dataset):
        raise DatasetNotReady()

    with transaction.atomic():
        dataset = Dataset.objects.select_for_update().get(pk=dataset.pk)
        if ProcessingLog.objects.filter(
            dataset=dataset,
            status__in=[ProcessingStatus.QUEUED, ProcessingStatus.RUNNING],
        ).exists():
            raise ProcessingAlreadyRunning()

        run = ProcessingLog.objects.create(dataset=dataset, created_by=user)
        dataset.status = DatasetStatus.PROCESSING
        dataset.save(update_fields=["status", "updated_at"])

    from .tasks import process_dataset

    try:
        process_dataset.delay(str(run.id))
    except Exception as error:  # noqa: BLE001 - report the queue failure clearly
        logger.exception("Could not enqueue processing run %s", run.id)
        run.status = ProcessingStatus.FAILED
        run.error_message = "The processing queue is unavailable."
        run.finished_at = timezone.now()
        run.save(update_fields=["status", "error_message", "finished_at"])
        Dataset.objects.filter(pk=dataset.pk).update(
            status=DatasetStatus.FAILED, updated_at=timezone.now()
        )
        raise ProcessingUnavailable() from error

    return run


def run_payload(run: ProcessingLog | None) -> dict | None:
    if run is None:
        return None
    return {
        "id": str(run.id),
        "status": run.status,
        "started_at": run.started_at,
        "finished_at": run.finished_at,
        "rows_read": run.rows_read,
        "rows_loaded": run.rows_loaded,
        "rows_rejected": run.rows_rejected,
        "summary": run.summary,
        "error_message": run.error_message,
        "created_at": run.created_at,
    }


def runs_payload(dataset: Dataset, limit: int = 20) -> list[dict]:
    return [run_payload(run) for run in dataset.processing_runs.all()[:limit]]


def warehouse_counts(dataset: Dataset) -> dict:
    return {
        "sales_rows": FactSales.objects.filter(dataset=dataset).count(),
        "return_rows": FactReturn.objects.filter(dataset=dataset).count(),
        "raw_rows": RawTransaction.objects.filter(dataset=dataset).count(),
        "issues": DataQualityIssue.objects.filter(dataset=dataset).count(),
        "customers": DimCustomer.objects.filter(dataset=dataset).count(),
        "products": DimProduct.objects.filter(dataset=dataset).count(),
        "countries": DimGeography.objects.filter(dataset=dataset).count(),
    }


def processing_summary(dataset: Dataset) -> dict:
    return {
        "latest_run": run_payload(dataset.processing_runs.first()),
        "warehouse": warehouse_counts(dataset),
        "can_process": is_processable(dataset) and not has_active_run(dataset),
    }


def issues_payload(dataset: Dataset, limit: int = 50) -> list[dict]:
    issues = DataQualityIssue.objects.filter(dataset=dataset).order_by("row_number", "id")[:limit]
    return [
        {
            "id": str(issue.id),
            "row_number": issue.row_number,
            "code": issue.code,
            "message": issue.message,
            "source_column": issue.source_column,
            "raw_value": issue.raw_value,
        }
        for issue in issues
    ]

"""Alert evaluation, target progress and scheduled report delivery.

Metric values are resolved through the analytics services so a breach, a target
and a dashboard can never disagree about the same number.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from decimal import Decimal

from django.conf import settings
from django.core.mail import EmailMessage
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.analytics.extended import returns_analysis
from apps.analytics.services import sales_summary
from apps.reporting.models import ReportJob
from apps.reporting.services import execute_export

from .models import (
    AlertComparator,
    AlertEvent,
    AlertMetric,
    AlertRule,
    AlertState,
    Board,
    ReportSchedule,
    ScheduleFrequency,
    Target,
)

logger = logging.getLogger(__name__)
ZERO = Decimal("0")


def metric_value(
    *,
    organisation,
    metric: str,
    dataset_id=None,
    date_from: date,
    date_to: date,
) -> Decimal | None:
    """Resolve one monitored metric for an inclusive date window."""
    if metric in {"return_rate", "discount_rate"}:
        payload = returns_analysis(
            organisation=organisation,
            dataset_id=dataset_id,
            date_from=date_from,
            date_to=date_to,
        )
        value = payload.get(metric)
    else:
        payload = sales_summary(
            organisation=organisation,
            dataset_id=dataset_id,
            date_from=date_from,
            date_to=date_to,
        )
        key = {
            "net_sales": "net_sales",
            "orders": "eligible_orders",
            "average_order_value": "average_order_value",
            "customers": "unique_customers",
        }[metric]
        value = payload.get(key)

    if value in (None, ""):
        return None
    return Decimal(str(value))


def evaluate_rule(rule: AlertRule) -> AlertEvent | None:
    """Check one rule and record an event on a fresh breach."""
    end = timezone.localdate()
    start = end - timedelta(days=max(rule.window_days, 1) - 1)
    value = metric_value(
        organisation=rule.organisation,
        metric=rule.metric,
        dataset_id=rule.dataset_id,
        date_from=start,
        date_to=end,
    )

    rule.last_checked_at = timezone.now()
    if value is None:
        rule.last_state = AlertState.UNKNOWN
        rule.last_value = None
        rule.save(update_fields=["last_checked_at", "last_state", "last_value"])
        return None

    breached = (
        value < rule.threshold
        if rule.comparator == AlertComparator.BELOW
        else value > rule.threshold
    )
    previous_state = rule.last_state
    rule.last_value = value
    rule.last_state = AlertState.BREACHED if breached else AlertState.OK
    rule.save(update_fields=["last_checked_at", "last_state", "last_value"])

    if not breached or previous_state == AlertState.BREACHED:
        return None

    return AlertEvent.objects.create(
        rule=rule,
        value=value,
        threshold=rule.threshold,
        message=(
            f"{rule.get_metric_display()} {rule.get_comparator_display().lower()} "
            f"{rule.threshold} over the last {rule.window_days} days "
            f"(observed {value})."
        )[:255],
    )


def evaluate_all_rules() -> int:
    """Evaluate every enabled rule; returns how many events were created."""
    created = 0
    rules = AlertRule.objects.filter(enabled=True).select_related("organisation", "dataset")
    for rule in rules:
        try:
            if evaluate_rule(rule) is not None:
                created += 1
        except Exception:  # noqa: BLE001 - one bad rule must not stop the sweep
            logger.exception("Alert rule %s could not be evaluated", rule.id)
    return created


def alert_payload(rule: AlertRule) -> dict:
    return {
        "id": str(rule.id),
        "name": rule.name,
        "metric": rule.metric,
        "metric_label": rule.get_metric_display(),
        "comparator": rule.comparator,
        "threshold": str(rule.threshold),
        "window_days": rule.window_days,
        "dataset": str(rule.dataset_id) if rule.dataset_id else None,
        "enabled": rule.enabled,
        "last_checked_at": rule.last_checked_at.isoformat() if rule.last_checked_at else None,
        "last_value": str(rule.last_value) if rule.last_value is not None else None,
        "last_state": rule.last_state,
        "events": [
            {
                "id": str(event.id),
                "value": str(event.value),
                "threshold": str(event.threshold),
                "message": event.message,
                "triggered_at": event.triggered_at.isoformat(),
                "acknowledged_at": (
                    event.acknowledged_at.isoformat() if event.acknowledged_at else None
                ),
            }
            for event in rule.events.all()[:5]
        ],
    }


def target_progress(target: Target) -> dict:
    """Actual versus target for the target's own period, to the current day."""
    today = timezone.localdate()
    end = min(target.period_end, today) if target.period_start <= today else target.period_start
    value = metric_value(
        organisation=target.organisation,
        metric=target.metric,
        dataset_id=target.dataset_id,
        date_from=target.period_start,
        date_to=max(end, target.period_start),
    )
    actual = value or ZERO
    amount = target.amount if target.amount > ZERO else ZERO
    elapsed_days = max((end - target.period_start).days + 1, 1)
    total_days = max((target.period_end - target.period_start).days + 1, 1)
    elapsed_ratio = min(elapsed_days / total_days, 1.0)

    return {
        "id": str(target.id),
        "name": target.name,
        "metric": target.metric,
        "metric_label": target.get_metric_display(),
        "target": str(target.amount),
        "actual": str(actual),
        "attainment_percent": (
            str((actual / amount * 100).quantize(Decimal("0.01"))) if amount > ZERO else None
        ),
        "expected_percent": str(round(elapsed_ratio * 100, 2) * 1),
        "pace": (
            "ahead"
            if amount > ZERO and (actual / amount) > Decimal(str(elapsed_ratio))
            else "behind"
            if amount > ZERO
            else "unknown"
        ),
        "period_start": target.period_start.isoformat(),
        "period_end": target.period_end.isoformat(),
        "days_elapsed": elapsed_days,
        "days_total": total_days,
        "dataset": str(target.dataset_id) if target.dataset_id else None,
    }


def schedule_payload(schedule: ReportSchedule) -> dict:
    return {
        "id": str(schedule.id),
        "report": str(schedule.report_id),
        "report_name": schedule.report.name,
        "frequency": schedule.frequency,
        "format": schedule.format,
        "recipients": schedule.recipients,
        "enabled": schedule.enabled,
        "next_run_at": schedule.next_run_at.isoformat() if schedule.next_run_at else None,
        "last_run_at": schedule.last_run_at.isoformat() if schedule.last_run_at else None,
        "last_status": schedule.last_status,
        "last_error": schedule.last_error,
    }


def board_payload(board: Board) -> dict:
    return {
        "id": str(board.id),
        "name": board.name,
        "description": board.description,
        "widgets": board.widgets,
        "created_at": board.created_at.isoformat(),
        "updated_at": board.updated_at.isoformat(),
        "created_by": board.created_by.display_name if board.created_by else None,
    }


def normalise_recipients(raw) -> list[str]:  # type: ignore[no-untyped-def]
    if isinstance(raw, str):
        items = [item.strip() for item in raw.replace(";", ",").split(",")]
    elif isinstance(raw, list):
        items = [str(item).strip() for item in raw]
    else:
        items = []
    recipients = [item for item in items if "@" in item]
    for address in recipients:
        if "@" not in address or address.startswith("@") or address.endswith("@"):
            raise ValidationError({"recipients": f"{address} is not an email address."})
    return recipients[:20]


def next_run_for(frequency: str, *, after=None):  # type: ignore[no-untyped-def]
    now = after or timezone.now()
    if frequency == ScheduleFrequency.DAILY:
        return now + timedelta(days=1)
    if frequency == ScheduleFrequency.MONTHLY:
        return now + timedelta(days=30)
    return now + timedelta(days=7)


def run_schedule(schedule: ReportSchedule) -> str:
    """Generate the scheduled export and email it to the recipients.

    The export is generated inline in the worker rather than queued, so the
    email can attach the finished file. A failed export is recorded on the
    schedule and never emails a broken attachment.
    """
    report = schedule.report
    job = ReportJob.objects.create(report=report, format=schedule.format)
    try:
        status = execute_export(str(job.id))
        job.refresh_from_db()
    except Exception as error:  # noqa: BLE001 - recorded on the schedule
        logger.exception("Scheduled export for %s failed", schedule.id)
        status = "failed"
        error_message = str(error)[:255]
    else:
        error_message = job.error_message[:255]

    schedule.last_run_at = timezone.now()
    schedule.last_status = status
    schedule.last_error = "" if status == "succeeded" else error_message
    if schedule.enabled:
        schedule.next_run_at = next_run_for(schedule.frequency)
    schedule.save(update_fields=["last_run_at", "last_status", "last_error", "next_run_at"])

    if status == "succeeded" and schedule.recipients:
        try:
            send_export_email(schedule, job)
        except Exception as error:  # noqa: BLE001 - delivery is reported, not hidden
            logger.exception("Could not email schedule %s", schedule.id)
            schedule.last_status = "email_failed"
            schedule.last_error = str(error)[:255]
            schedule.save(update_fields=["last_status", "last_error"])

    return schedule.last_status


def send_export_email(schedule: ReportSchedule, job: ReportJob) -> None:
    if not job.file:
        raise RuntimeError("The export file is missing.")
    job.file.open("rb")
    try:
        content = job.file.read()
    finally:
        job.file.close()

    message = EmailMessage(
        subject=f"[RetailLens] {schedule.report.name}",
        body=(
            f"Your scheduled {schedule.get_format_display()} report "
            f"“{schedule.report.name}” is attached.\n\n"
            "It was recomputed from the current warehouse at delivery time, so the "
            "numbers match the dashboards when the schedule ran.\n"
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=schedule.recipients,
    )
    mime = "application/pdf" if schedule.format == "pdf" else "text/csv"
    message.attach(job.filename or f"report.{schedule.format}", content, mime)
    message.send(fail_silently=False)


def dispatch_due_schedules() -> int:
    """Run every enabled schedule whose next run is due."""
    now = timezone.now()
    sent = 0
    for schedule in ReportSchedule.objects.filter(
        enabled=True, next_run_at__lte=now
    ).select_related("report__organisation"):
        run_schedule(schedule)
        sent += 1
    return sent


def metric_choices() -> list[dict]:
    return [{"value": value, "label": label} for value, label in AlertMetric.choices]

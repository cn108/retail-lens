"""Saved report read models, report composition and export orchestration.

Reports never recompute metrics: they call the same sales, customer and product
services used by the dashboards. This module owns only the report shape, the
export job lifecycle and the audit fields stored on a job.
"""

import logging
from datetime import date

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import QuerySet
from django.urls import reverse
from django.utils import timezone
from django.utils.text import slugify
from rest_framework.exceptions import APIException, NotFound, ValidationError

from apps.analytics.services import product_performance, sales_summary, sales_trend
from apps.customers.services import customer_rfm, customer_summary
from apps.datasets.models import Dataset
from apps.organisations.models import Organisation

from .definitions import DEFINITIONS, KIND_LABELS
from .exporters import render_csv, render_pdf
from .models import (
    ExportFormat,
    ExportStatus,
    ReportJob,
    ReportKind,
    SavedReport,
)

logger = logging.getLogger(__name__)
ACTIVE_STATUSES = (ExportStatus.QUEUED, ExportStatus.RUNNING)


class ExportAlreadyRunning(APIException):
    status_code = 409
    default_detail = "An export for this report is already queued or running."


class ExportUnavailable(APIException):
    status_code = 503
    default_detail = "The export queue is unavailable. Check the broker."


class ExportNotReady(APIException):
    status_code = 409
    default_detail = "This export has not finished generating."


def dataset_for(organisation: Organisation, dataset_id) -> Dataset | None:  # type: ignore[no-untyped-def]
    if dataset_id is None:
        return None
    dataset = Dataset.objects.filter(id=dataset_id, organisation=organisation).first()
    if dataset is None:
        raise NotFound("Dataset not found.")
    return dataset


def report_list_payload(report: SavedReport) -> dict:
    return {
        "id": str(report.id),
        "name": report.name,
        "kind": report.kind,
        "kind_label": KIND_LABELS[report.kind],
        "dataset": (
            {"id": str(report.dataset.id), "name": report.dataset.name} if report.dataset else None
        ),
        "date_from": report.date_from.isoformat() if report.date_from else None,
        "date_to": report.date_to.isoformat() if report.date_to else None,
        "created_by": report.created_by.email if report.created_by else None,
        "created_at": report.created_at,
        "updated_at": report.updated_at,
    }


def _card(label: str, value, fmt: str, note: str) -> dict:  # type: ignore[no-untyped-def]
    return {"label": label, "value": value, "format": fmt, "note": note}


def _column(key: str, label: str, fmt: str = "text") -> dict:
    return {"key": key, "label": label, "format": fmt}


def _section(key: str, title: str, description: str, columns: list[dict], rows: list[dict]) -> dict:
    return {
        "key": key,
        "title": title,
        "description": description,
        "columns": columns,
        "rows": rows,
    }


def _sales_payload(report: SavedReport) -> dict:
    query = {
        "organisation": report.organisation,
        "dataset_id": report.dataset_id,
        "date_from": report.date_from,
        "date_to": report.date_to,
    }
    summary = sales_summary(**query)
    trend = sales_trend(granularity="month", **query)
    products = product_performance(limit=100, **query)

    cards = [
        _card("Net sales", summary["net_sales"], "money", "After discounts and returns"),
        _card("Gross sales", summary["gross_sales"], "money", "Before discounts; returns excluded"),
        _card(
            "Eligible orders",
            summary["eligible_orders"],
            "number",
            "Distinct invoices with a sale",
        ),
        _card(
            "Average order value",
            summary["average_order_value"],
            "money",
            "Net sales divided by eligible orders",
        ),
        _card(
            "Unique customers",
            summary["unique_customers"],
            "number",
            "Identifiable customers with a sale",
        ),
        _card(
            "Sales growth",
            summary["sales_growth_percent"],
            "percent",
            "Against the preceding equal-length period",
        ),
    ]
    sections = [
        _section(
            "monthly_sales",
            "Monthly net sales",
            "Calendar months in the selected range. Months without facts are omitted.",
            [
                _column("month", "Month"),
                _column("gross", "Gross sales", "money"),
                _column("net", "Net sales", "money"),
                _column("orders", "Orders", "number"),
            ],
            [
                {
                    "month": point["label"],
                    "gross": point["gross_sales"],
                    "net": point["net_sales"],
                    "orders": point["orders"],
                }
                for point in trend["points"]
            ],
        ),
        _section(
            "products",
            "Top products",
            "Ranked by net sales in the selected range (maximum 100 rows).",
            [
                _column("product", "Product"),
                _column("description", "Description"),
                _column("net", "Net sales", "money"),
                _column("units", "Units", "number"),
                _column("orders", "Orders", "number"),
            ],
            [
                {
                    "product": row["source_product_code"],
                    "description": row["description"] or "No description",
                    "net": row["net_sales"],
                    "units": row["units"],
                    "orders": row["orders"],
                }
                for row in products["rows"]
            ],
        ),
    ]
    return {
        "has_data": summary["has_data"],
        "period": {"date_from": summary["date_from"], "date_to": summary["date_to"]},
        "comparison": {
            "date_from": summary["comparison_date_from"],
            "date_to": summary["comparison_date_to"],
        },
        "summary": cards,
        "sections": sections,
        "notes": [
            "Identity is dataset-scoped; invoices and customers are not merged across datasets.",
            "Amounts use the organisation currency without conversion.",
        ],
    }


def _customers_payload(report: SavedReport) -> dict:
    query = {
        "organisation": report.organisation,
        "dataset_id": report.dataset_id,
        "date_from": report.date_from,
        "date_to": report.date_to,
    }
    summary = customer_summary(**query)
    rfm = customer_rfm(limit=100, **query)

    cards = [
        _card(
            "Identifiable customers",
            summary["identifiable_customers"],
            "number",
            "Customers with at least one sales line",
        ),
        _card(
            "Repeat purchase rate",
            summary["repeat_purchase_rate"],
            "percent",
            "Customers with two or more invoices",
        ),
        _card(
            "Historical customer value",
            summary["historical_value"],
            "money",
            "Observed net sales, not predicted CLV",
        ),
        _card(
            "Month-1 retention",
            summary["month_1_retention"],
            "percent",
            "Size-weighted across eligible cohorts",
        ),
    ]
    sections = [
        _section(
            "rfm_segments",
            "RFM segments",
            "Scores are relative to the customers selected by this report's filters.",
            [
                _column("segment", "Segment"),
                _column("customers", "Customers", "number"),
                _column("net", "Net sales", "money"),
                _column("share", "Share", "percent"),
            ],
            [
                {
                    "segment": segment["label"],
                    "customers": segment["customers"],
                    "net": segment["net_sales"],
                    "share": segment["share"],
                }
                for segment in rfm["segments"]
            ],
        ),
        _section(
            "top_customers",
            "Customers by value",
            "Highest net sales in the selected range (maximum 100 rows).",
            [
                _column("customer", "Customer"),
                _column("dataset", "Dataset"),
                _column("orders", "Orders", "number"),
                _column("net", "Net sales", "money"),
                _column("segment", "Segment"),
            ],
            [
                {
                    "customer": row["source_customer_id"],
                    "dataset": row["dataset_name"],
                    "orders": row["orders"],
                    "net": row["net_sales"],
                    "segment": row["segment_label"],
                }
                for row in rfm["customers"]
            ],
        ),
    ]
    return {
        "has_data": summary["has_data"],
        "period": {"date_from": summary["date_from"], "date_to": summary["date_to"]},
        "comparison": {"date_from": None, "date_to": None},
        "summary": cards,
        "sections": sections,
        "notes": [
            "Customers are dataset-scoped; the same source id in two datasets is two customers.",
            "Anonymous sales are excluded from customer measures.",
        ],
    }


def _products_payload(report: SavedReport) -> dict:
    query = {
        "organisation": report.organisation,
        "dataset_id": report.dataset_id,
        "date_from": report.date_from,
        "date_to": report.date_to,
    }
    performance = product_performance(limit=100, **query)

    cards = [
        _card("Net sales", performance["net_sales"], "money", "After discounts and returns"),
        _card(
            "Products sold",
            performance["product_count"],
            "number",
            "Distinct product codes with activity",
        ),
        _card(
            "Top product share",
            performance["top_product_share"],
            "percent",
            "Largest net-sales contribution",
        ),
        _card(
            "Declining products",
            performance["declining_products"],
            "number",
            "Net sales down 20% or more",
        ),
    ]
    sections = [
        _section(
            "products",
            "Product performance",
            "Ranked by net sales in the selected range (maximum 100 rows).",
            [
                _column("product", "Product"),
                _column("description", "Description"),
                _column("net", "Net sales", "money"),
                _column("units", "Units", "number"),
                _column("orders", "Orders", "number"),
                _column("share", "Share", "percent"),
            ],
            [
                {
                    "product": row["source_product_code"],
                    "description": row["description"] or "No description",
                    "net": row["net_sales"],
                    "units": row["units"],
                    "orders": row["orders"],
                    "share": row["share"],
                }
                for row in performance["rows"]
            ],
        )
    ]
    return {
        "has_data": performance["has_data"],
        "period": {
            "date_from": performance["date_from"],
            "date_to": performance["date_to"],
        },
        "comparison": {
            "date_from": performance["comparison_date_from"],
            "date_to": performance["comparison_date_to"],
        },
        "summary": cards,
        "sections": sections,
        "notes": [
            "Product categories are not inferred; products are identified by source code.",
            "Direction and change compare with the preceding equal-length period.",
        ],
    }


def report_payload(report: SavedReport) -> dict:
    """Compute one report from the shared metric services."""
    generated_at = timezone.now().replace(microsecond=0).isoformat()
    base = report_list_payload(report)
    if report.kind == ReportKind.SALES:
        body = _sales_payload(report)
    elif report.kind == ReportKind.CUSTOMERS:
        body = _customers_payload(report)
    else:
        body = _products_payload(report)

    body.update(
        {
            **base,
            "generated_at": generated_at,
            "organisation_name": report.organisation.name,
            "currency": report.organisation.currency,
            "definitions": DEFINITIONS[report.kind],
        }
    )
    return body


def create_report(
    *,
    organisation: Organisation,
    name: str,
    kind: str,
    dataset_id,
    date_from: date | None,
    date_to: date | None,
    user,
) -> SavedReport:  # type: ignore[no-untyped-def]
    if kind not in ReportKind.values:
        raise ValidationError({"kind": "Use sales, customers or products."})
    if date_from and date_to and date_from > date_to:
        raise ValidationError({"date_from": "The start date must not be after the end date."})

    dataset = dataset_for(organisation, dataset_id)
    return SavedReport.objects.create(
        organisation=organisation,
        dataset=dataset,
        name=name.strip(),
        kind=kind,
        date_from=date_from,
        date_to=date_to,
        created_by=user,
    )


def update_report(report: SavedReport, changes: dict) -> SavedReport:
    """Update the filters or name of a saved report."""
    if "name" in changes:
        report.name = changes["name"].strip()
    if "kind" in changes:
        if changes["kind"] not in ReportKind.values:
            raise ValidationError({"kind": "Use sales, customers or products."})
        report.kind = changes["kind"]
    if "dataset" in changes:
        report.dataset = dataset_for(report.organisation, changes["dataset"])
    if "date_from" in changes:
        report.date_from = changes["date_from"]
    if "date_to" in changes:
        report.date_to = changes["date_to"]

    if report.date_from and report.date_to and report.date_from > report.date_to:
        raise ValidationError({"date_from": "The start date must not be after the end date."})
    report.save()
    return report


def delete_report(report: SavedReport) -> None:
    for job in report.jobs.all():
        if job.file:
            job.file.delete(save=False)
    report.delete()


def job_payload(job: ReportJob) -> dict:
    return {
        "id": str(job.id),
        "report_id": str(job.report_id),
        "report_name": job.report.name,
        "format": job.format,
        "status": job.status,
        "filename": job.filename,
        "row_count": job.row_count,
        "size_bytes": job.size_bytes,
        "error_message": job.error_message,
        "created_at": job.created_at,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
        "download_url": (
            reverse("report-export-download", args=[job.report_id, job.id])
            if job.status == ExportStatus.SUCCEEDED and job.file
            else None
        ),
    }


def jobs_payload(report: SavedReport, limit: int = 20) -> list[dict]:
    jobs: QuerySet[ReportJob] = report.jobs.select_related("report")[:limit]
    return [job_payload(job) for job in jobs]


def start_export(*, report: SavedReport, format: str, user):  # type: ignore[no-untyped-def]
    if format not in ExportFormat.values:
        raise ValidationError({"format": "Use csv or pdf."})

    with transaction.atomic():
        locked = SavedReport.objects.select_for_update().get(pk=report.pk)
        if ReportJob.objects.filter(report=locked, status__in=ACTIVE_STATUSES).exists():
            raise ExportAlreadyRunning()
        job = ReportJob.objects.create(report=locked, format=format, created_by=user)

    from .tasks import generate_export

    def enqueue() -> None:
        try:
            generate_export.delay(str(job.id))
        except Exception as error:  # noqa: BLE001 - report the queue failure clearly
            logger.exception("Could not enqueue report export %s", job.id)
            ReportJob.objects.filter(pk=job.id, status=ExportStatus.QUEUED).update(
                status=ExportStatus.FAILED,
                error_message="The export queue is unavailable.",
                finished_at=timezone.now(),
            )
            if getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False):
                raise ExportUnavailable() from error

    # The worker must not look for the job before the transaction that created
    # it has committed; eager test runs complete it inline instead.
    if getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False):
        enqueue()
    else:
        transaction.on_commit(enqueue)

    return job


def execute_export(job_id: str) -> str:
    """Generate one queued export and store its file and audit fields."""
    try:
        job = ReportJob.objects.select_related(
            "report__organisation",
            "report__dataset",
            "report__created_by",
        ).get(pk=job_id)
    except ReportJob.DoesNotExist:
        return "missing"
    if job.status != ExportStatus.QUEUED:
        return job.status

    job.status = ExportStatus.RUNNING
    job.started_at = timezone.now()
    job.save(update_fields=["status", "started_at"])

    try:
        payload = report_payload(job.report)
        if job.format == ExportFormat.CSV:
            content = render_csv(payload)
        else:
            content = render_pdf(payload)

        safe_name = slugify(job.report.name)[:60] or "report"
        filename = f"{safe_name}-{date.today().isoformat()}.{job.format}"
        job.file.save(filename, ContentFile(content), save=False)
        job.filename = filename
        job.row_count = sum(len(section["rows"]) for section in payload["sections"])
        job.size_bytes = len(content)
        job.status = ExportStatus.SUCCEEDED
        job.error_message = ""
        job.finished_at = timezone.now()
        job.save(
            update_fields=[
                "file",
                "filename",
                "row_count",
                "size_bytes",
                "status",
                "error_message",
                "finished_at",
            ]
        )
    except Exception as error:  # noqa: BLE001 - the job records its failure
        logger.exception("Report export %s failed", job_id)
        if job.file:
            job.file.delete(save=False)
        job.file = ""
        job.status = ExportStatus.FAILED
        job.error_message = str(error)[:2000]
        job.finished_at = timezone.now()
        job.save(update_fields=["file", "status", "error_message", "finished_at"])

    return job.status

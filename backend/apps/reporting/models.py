"""Saved report definitions and generated export artefacts.

A saved report stores the metric family and filters, not a frozen set of
numbers: opening or exporting it recomputes from the shared metric services so
the report never drifts from the dashboards. Export jobs keep their generated
file and audit fields; the file is removed when the job or its report is
deleted.
"""

import uuid

from django.conf import settings
from django.db import models
from django.db.models.signals import post_delete
from django.dispatch import receiver


class ReportKind(models.TextChoices):
    SALES = "sales", "Sales performance"
    CUSTOMERS = "customers", "Customer performance"
    PRODUCTS = "products", "Product performance"


class ExportFormat(models.TextChoices):
    CSV = "csv", "CSV"
    PDF = "pdf", "PDF"


class ExportStatus(models.TextChoices):
    QUEUED = "queued", "Queued"
    RUNNING = "running", "Running"
    SUCCEEDED = "succeeded", "Succeeded"
    FAILED = "failed", "Failed"


class SavedReport(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(
        "organisations.Organisation",
        on_delete=models.CASCADE,
        related_name="saved_reports",
    )
    # A null dataset means every processed dataset in the organisation. A
    # report tied to one dataset is removed with it; an all-data report stays.
    dataset = models.ForeignKey(
        "datasets.Dataset",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="saved_reports",
    )
    name = models.CharField(max_length=200)
    kind = models.CharField(max_length=16, choices=ReportKind.choices)
    date_from = models.DateField(null=True, blank=True)
    date_to = models.DateField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "saved_reports"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["organisation", "-created_at"])]

    def __str__(self) -> str:
        return f"{self.name} ({self.kind})"


def report_export_path(instance: "ReportJob", filename: str) -> str:
    extension = filename.rsplit(".", 1)[-1].lower() or "bin"
    return (
        f"reports/{instance.report.organisation_id}/{instance.report_id}/"
        f"{uuid.uuid4().hex}.{extension}"
    )


class ReportJob(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    report = models.ForeignKey(
        SavedReport,
        on_delete=models.CASCADE,
        related_name="jobs",
    )
    format = models.CharField(max_length=8, choices=ExportFormat.choices)
    status = models.CharField(
        max_length=16, choices=ExportStatus.choices, default=ExportStatus.QUEUED
    )
    file = models.FileField(upload_to=report_export_path, max_length=255, blank=True)
    filename = models.CharField(max_length=255, blank=True)
    row_count = models.PositiveIntegerField(default=0)
    size_bytes = models.PositiveBigIntegerField(default=0)
    error_message = models.TextField(blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "report_jobs"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["report", "-created_at"])]

    def __str__(self) -> str:
        return f"{self.report_id} {self.format} {self.status}"


@receiver(post_delete, sender=ReportJob)
def _delete_export_file(sender, instance: ReportJob, **kwargs) -> None:  # type: ignore[no-untyped-def]
    """Remove the stored export when a job or its report is deleted."""
    if instance.file:
        instance.file.delete(save=False)

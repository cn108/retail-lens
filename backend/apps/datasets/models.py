"""Dataset metadata, import attempts and source column mappings.

The uploaded file is preserved verbatim; ``DatasetColumn`` records what the
file contains and which canonical transaction field each column maps to. The
organisation scope is carried by the dataset and enforced by its services.
"""

import uuid

from django.conf import settings
from django.db import models

from apps.ingestion.canonical import CANONICAL_FIELDS

CANONICAL_CHOICES = [(field.key, field.label) for field in CANONICAL_FIELDS]

INFERRED_TYPES = [
    ("text", "Text"),
    ("integer", "Whole number"),
    ("decimal", "Decimal number"),
    ("date", "Date"),
    ("boolean", "Boolean"),
]


class DatasetStatus(models.TextChoices):
    DRAFT = "draft", "Awaiting mapping"
    MAPPED = "mapped", "Ready for processing"
    PROCESSING = "processing", "Processing"
    READY = "ready", "Processed"
    FAILED = "failed", "Processing failed"


class ImportStatus(models.TextChoices):
    INSPECTED = "inspected", "Inspected"
    FAILED = "failed", "Failed"


def dataset_upload_path(instance: "DatasetImport", filename: str) -> str:
    return (
        f"datasets/{instance.dataset.organisation_id}/{instance.dataset_id}/{uuid.uuid4().hex}.csv"
    )


class Dataset(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(
        "organisations.Organisation", on_delete=models.CASCADE, related_name="datasets"
    )
    name = models.CharField(max_length=255)
    status = models.CharField(
        max_length=16, choices=DatasetStatus.choices, default=DatasetStatus.DRAFT
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    current_import = models.ForeignKey(
        "DatasetImport",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "datasets"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.name


class DatasetImport(models.Model):
    """One uploaded file and the result of inspecting it."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    dataset = models.ForeignKey(Dataset, on_delete=models.CASCADE, related_name="imports")
    file = models.FileField(upload_to=dataset_upload_path, max_length=255)
    original_filename = models.CharField(max_length=255)
    content_type = models.CharField(max_length=120, blank=True)
    size_bytes = models.PositiveBigIntegerField()
    checksum_sha256 = models.CharField(max_length=64, db_index=True)
    encoding = models.CharField(max_length=32)
    delimiter = models.CharField(max_length=1)
    row_count = models.PositiveIntegerField()
    column_count = models.PositiveSmallIntegerField()
    warnings = models.JSONField(default=list, blank=True)
    status = models.CharField(
        max_length=16, choices=ImportStatus.choices, default=ImportStatus.INSPECTED
    )
    error_message = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "dataset_imports"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.original_filename} ({self.dataset_id})"


class DatasetColumn(models.Model):
    """A source column and the canonical field the user mapped it to."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    import_record = models.ForeignKey(
        DatasetImport, on_delete=models.CASCADE, related_name="columns"
    )
    position = models.PositiveSmallIntegerField()
    source_name = models.CharField(max_length=255)
    inferred_type = models.CharField(max_length=16, choices=INFERRED_TYPES)
    canonical_field = models.CharField(max_length=64, choices=CANONICAL_CHOICES, blank=True)
    null_count = models.PositiveIntegerField(default=0)
    sample_values = models.JSONField(default=list, blank=True)

    class Meta:
        db_table = "dataset_columns"
        ordering = ["position"]
        constraints = [
            models.UniqueConstraint(
                fields=["import_record", "position"],
                name="unique_dataset_column_position",
            ),
            models.UniqueConstraint(
                fields=["import_record", "source_name"],
                name="unique_dataset_column_name",
            ),
        ]

    def __str__(self) -> str:
        return self.source_name

"""Dataset services: upload inspection, mapping validation and deletion.

Views stay thin; these functions own the rules and are the only place a
dataset's files or columns are written.
"""

import hashlib
from pathlib import Path

from django.conf import settings
from django.db import transaction
from rest_framework.exceptions import APIException, ValidationError

from apps.ingestion.canonical import BY_KEY, REQUIRED_KEYS, accepts_type
from apps.ingestion.inspection import (
    INFERENCE_ROWS,
    CsvInspectionError,
    InspectionResult,
    inspect_csv,
)
from apps.ingestion.models import FactReturn, FactSales

from .models import Dataset, DatasetColumn, DatasetImport, DatasetStatus


class DatasetAlreadyImported(APIException):
    status_code = 409
    default_detail = "This file has already been imported."
    default_code = "already_imported"

    def __init__(self, dataset: Dataset) -> None:
        super().__init__(
            f"This file is already in the dataset '{dataset.name}'. "
            "Open that dataset instead of uploading it again."
        )
        self.dataset_id = dataset.id


def _checksum(uploaded_file) -> str:  # type: ignore[no-untyped-def]
    digest = hashlib.sha256()
    uploaded_file.seek(0)
    for chunk in uploaded_file.chunks():
        digest.update(chunk)
    uploaded_file.seek(0)
    return digest.hexdigest()


def _validate_upload(uploaded_file) -> None:  # type: ignore[no-untyped-def]
    if Path(uploaded_file.name).suffix.lower() != ".csv":
        raise ValidationError({"file": "Upload a comma- or delimiter-separated .csv file."})
    if uploaded_file.size == 0:
        raise ValidationError({"file": "The file is empty."})
    if uploaded_file.size > settings.MAX_UPLOAD_BYTES:
        limit_mib = settings.MAX_UPLOAD_BYTES / (1024 * 1024)
        raise ValidationError({"file": f"The file is larger than {limit_mib:.0f} MiB."})


def _dataset_name(name: str, filename: str) -> str:
    candidate = name.strip() or Path(filename).stem.strip() or "Dataset"
    return candidate[:255]


def create_dataset(
    *,
    membership,  # type: ignore[no-untyped-def]
    uploaded_file,  # type: ignore[no-untyped-def]
    name: str = "",
    delimiter: str = "auto",
) -> Dataset:
    """Inspect and store one uploaded CSV, leaving it awaiting mapping."""
    _validate_upload(uploaded_file)
    checksum = _checksum(uploaded_file)

    existing = (
        DatasetImport.objects.filter(
            dataset__organisation=membership.organisation, checksum_sha256=checksum
        )
        .select_related("dataset")
        .first()
    )
    if existing is not None:
        raise DatasetAlreadyImported(existing.dataset)

    try:
        inspection = inspect_csv(uploaded_file, delimiter=delimiter)
    except CsvInspectionError as error:
        raise ValidationError({"file": str(error)}) from error

    with transaction.atomic():
        dataset = Dataset.objects.create(
            organisation=membership.organisation,
            name=_dataset_name(name, uploaded_file.name),
            created_by=membership.user,
        )
        import_record = DatasetImport.objects.create(
            dataset=dataset,
            file=uploaded_file,
            original_filename=Path(uploaded_file.name).name[:255],
            content_type=getattr(uploaded_file, "content_type", "") or "",
            size_bytes=uploaded_file.size,
            checksum_sha256=checksum,
            encoding=inspection.encoding,
            delimiter=inspection.delimiter,
            row_count=inspection.row_count,
            column_count=len(inspection.columns),
            warnings=inspection.warnings,
            created_by=membership.user,
        )
        DatasetColumn.objects.bulk_create(
            [
                DatasetColumn(
                    import_record=import_record,
                    position=column.position,
                    source_name=column.source_name,
                    inferred_type=column.inferred_type,
                    null_count=column.null_count,
                    sample_values=column.sample_values,
                )
                for column in inspection.columns
            ]
        )
        dataset.current_import = import_record
        dataset.save(update_fields=["current_import", "updated_at"])

    return dataset


def apply_mapping(*, dataset: Dataset, mapping: dict[str, str | None]) -> Dataset:
    """Replace the mapping of the dataset's current import.

    Every column is re-evaluated: omitted columns are unmapped, unknown ids or
    fields are rejected, a field may be used only once, all required fields
    must be present and each canonical field must accept the column's type.
    """
    import_record = dataset.current_import
    if import_record is None:
        raise ValidationError({"mapping": "This dataset has no inspected import."})

    columns = list(import_record.columns.all())
    by_id = {str(column.id): column for column in columns}

    unknown_columns = sorted(set(mapping) - set(by_id))
    if unknown_columns:
        raise ValidationError({"mapping": f"Unknown column(s): {', '.join(unknown_columns)}."})

    assignments: dict[str, str] = {}
    used: dict[str, str] = {}
    for column in columns:
        raw = mapping.get(str(column.id)) or ""
        field_key = raw.strip() if isinstance(raw, str) else ""
        if not field_key:
            assignments[str(column.id)] = ""
            continue
        if field_key not in BY_KEY:
            raise ValidationError({"mapping": f"'{field_key}' is not a known field."})
        if field_key in used:
            field = BY_KEY[field_key]
            raise ValidationError(
                {
                    "mapping": f"{field.label} is mapped to more than one column "
                    f"('{used[field_key]}' and '{column.source_name}')."
                }
            )
        empty_column = (
            import_record.row_count <= INFERENCE_ROWS
            and column.null_count >= import_record.row_count
        )
        if not accepts_type(field_key, column.inferred_type) and not empty_column:
            field = BY_KEY[field_key]
            raise ValidationError(
                {
                    "mapping": (
                        f"{field.label} needs a {' or '.join(field.accepts)} column, but "
                        f"'{column.source_name}' was detected as {column.inferred_type}."
                    )
                }
            )
        used[field_key] = column.source_name
        assignments[str(column.id)] = field_key

    missing = [BY_KEY[key].label for key in REQUIRED_KEYS if key not in used]
    if missing:
        raise ValidationError({"mapping": f"Map the required field(s): {', '.join(missing)}."})

    with transaction.atomic():
        for column in columns:
            column.canonical_field = assignments[str(column.id)]
        DatasetColumn.objects.bulk_update(columns, ["canonical_field"])
        dataset.status = DatasetStatus.MAPPED
        dataset.save(update_fields=["status", "updated_at"])

    return dataset


def delete_dataset(dataset: Dataset) -> None:
    files = [import_record.file for import_record in dataset.imports.all() if import_record.file]
    with transaction.atomic():
        # Facts protect their dimensions; remove the dataset's facts before
        # letting the dataset cascade delete those dimensions.
        FactSales.objects.filter(dataset=dataset).delete()
        FactReturn.objects.filter(dataset=dataset).delete()
        dataset.delete()
    for file in files:
        file.delete(save=False)


def inspection_summary(inspection: InspectionResult) -> dict:
    """Expose an inspection in API shape (used by tests and future tasks)."""
    return {
        "encoding": inspection.encoding,
        "delimiter": inspection.delimiter,
        "row_count": inspection.row_count,
        "warnings": inspection.warnings,
        "columns": [
            {
                "source_name": column.source_name,
                "position": column.position,
                "inferred_type": column.inferred_type,
                "null_count": column.null_count,
                "sample_values": column.sample_values,
            }
            for column in inspection.columns
        ],
    }

from datetime import datetime

from rest_framework import serializers

from apps.ingestion.canonical import (
    CANONICAL_FIELDS,
    REQUIRED_KEYS,
    suggest_canonical_field,
)
from apps.ingestion.services import processing_summary

from .models import Dataset, DatasetColumn


class DatasetColumnSerializer(serializers.ModelSerializer):
    suggested_field = serializers.SerializerMethodField()

    class Meta:
        model = DatasetColumn
        fields = [
            "id",
            "position",
            "source_name",
            "inferred_type",
            "canonical_field",
            "null_count",
            "sample_values",
            "suggested_field",
        ]

    def get_suggested_field(self, obj: DatasetColumn) -> str:
        return suggest_canonical_field(obj.source_name)


class DatasetSummarySerializer(serializers.ModelSerializer):
    row_count = serializers.SerializerMethodField()
    column_count = serializers.SerializerMethodField()
    filename = serializers.SerializerMethodField()
    created_by = serializers.SerializerMethodField()
    last_processed_at = serializers.SerializerMethodField()
    last_run_status = serializers.SerializerMethodField()
    rows_rejected = serializers.SerializerMethodField()
    quality_issue_count = serializers.SerializerMethodField()

    class Meta:
        model = Dataset
        fields = [
            "id",
            "name",
            "status",
            "row_count",
            "column_count",
            "filename",
            "created_by",
            "created_at",
            "updated_at",
            "last_processed_at",
            "last_run_status",
            "rows_rejected",
            "quality_issue_count",
        ]

    def _latest_run(self, obj: Dataset):
        """Return the newest processing run once per serialized dataset."""
        if not hasattr(obj, "_summary_latest_run"):
            obj._summary_latest_run = obj.processing_runs.first()
        return obj._summary_latest_run

    def get_row_count(self, obj: Dataset) -> int:
        return obj.current_import.row_count if obj.current_import else 0

    def get_column_count(self, obj: Dataset) -> int:
        return obj.current_import.column_count if obj.current_import else 0

    def get_filename(self, obj: Dataset) -> str | None:
        return obj.current_import.original_filename if obj.current_import else None

    def get_created_by(self, obj: Dataset) -> str | None:
        return obj.created_by.email if obj.created_by else None

    def get_last_processed_at(self, obj: Dataset) -> datetime | None:
        run = self._latest_run(obj)
        return run.finished_at if run else None

    def get_last_run_status(self, obj: Dataset) -> str | None:
        run = self._latest_run(obj)
        return run.status if run else None

    def get_rows_rejected(self, obj: Dataset) -> int:
        run = self._latest_run(obj)
        return run.rows_rejected if run else 0

    def get_quality_issue_count(self, obj: Dataset) -> int:
        return obj.quality_issues.count()


class DatasetDetailSerializer(DatasetSummarySerializer):
    columns = serializers.SerializerMethodField()
    encoding = serializers.SerializerMethodField()
    delimiter = serializers.SerializerMethodField()
    warnings = serializers.SerializerMethodField()
    imported_at = serializers.SerializerMethodField()
    mapping_complete = serializers.SerializerMethodField()
    processing = serializers.SerializerMethodField()

    class Meta(DatasetSummarySerializer.Meta):
        fields = [
            *DatasetSummarySerializer.Meta.fields,
            "encoding",
            "delimiter",
            "warnings",
            "imported_at",
            "mapping_complete",
            "processing",
            "columns",
        ]

    def get_columns(self, obj: Dataset) -> list[dict]:
        if obj.current_import is None:
            return []
        return DatasetColumnSerializer(obj.current_import.columns.all(), many=True).data

    def get_encoding(self, obj: Dataset) -> str | None:
        return obj.current_import.encoding if obj.current_import else None

    def get_delimiter(self, obj: Dataset) -> str | None:
        return obj.current_import.delimiter if obj.current_import else None

    def get_warnings(self, obj: Dataset) -> list[str]:
        return list(obj.current_import.warnings) if obj.current_import else []

    def get_imported_at(self, obj: Dataset) -> datetime | None:
        return obj.current_import.created_at if obj.current_import else None

    def get_mapping_complete(self, obj: Dataset) -> bool:
        if obj.current_import is None:
            return False
        mapped = set(
            obj.current_import.columns.exclude(canonical_field="").values_list(
                "canonical_field", flat=True
            )
        )
        return set(REQUIRED_KEYS).issubset(mapped)

    def get_processing(self, obj: Dataset) -> dict:
        return processing_summary(obj)


class DatasetUploadSerializer(serializers.Serializer):
    file = serializers.FileField()
    name = serializers.CharField(required=False, allow_blank=True, max_length=255)
    delimiter = serializers.ChoiceField(
        choices=["auto", ",", ";", "\t", "|"], required=False, default="auto"
    )


class DatasetMappingSerializer(serializers.Serializer):
    mapping = serializers.DictField(
        child=serializers.CharField(allow_blank=True, allow_null=True),
        allow_empty=True,
    )


class CanonicalFieldSerializer(serializers.Serializer):
    key = serializers.CharField()
    label = serializers.CharField()
    description = serializers.CharField()
    accepts = serializers.ListField(child=serializers.CharField())
    required = serializers.BooleanField()


def canonical_field_payload() -> dict:
    return {
        "fields": CanonicalFieldSerializer(CANONICAL_FIELDS, many=True).data,
        "required": list(REQUIRED_KEYS),
    }


class CanonicalFieldListSerializer(serializers.Serializer):
    """The canonical warehouse fields and the ones a dataset must map."""

    fields = CanonicalFieldSerializer(many=True)
    required = serializers.ListField(child=serializers.CharField())


class ProcessingRunSerializer(serializers.Serializer):
    """One processing attempt and its row counts."""

    id = serializers.CharField()
    status = serializers.CharField()
    started_at = serializers.DateTimeField(allow_null=True)
    finished_at = serializers.DateTimeField(allow_null=True)
    rows_read = serializers.IntegerField(allow_null=True)
    rows_loaded = serializers.IntegerField(allow_null=True)
    rows_rejected = serializers.IntegerField(allow_null=True)
    summary = serializers.DictField()
    error_message = serializers.CharField(allow_null=True)
    created_at = serializers.DateTimeField()


class QualityIssueSerializer(serializers.Serializer):
    """One rejected row and the reason it was rejected."""

    id = serializers.CharField()
    row_number = serializers.IntegerField(allow_null=True)
    code = serializers.CharField()
    message = serializers.CharField()
    source_column = serializers.CharField(allow_null=True)
    raw_value = serializers.CharField(allow_null=True)


class QualityReasonSerializer(serializers.Serializer):
    """How often one rejection code occurred."""

    code = serializers.CharField()
    count = serializers.IntegerField()


class QualityDatasetSerializer(serializers.Serializer):
    """Rejected rows and their reasons for one dataset."""

    dataset_id = serializers.CharField()
    name = serializers.CharField()
    status = serializers.CharField()
    rows_read = serializers.IntegerField()
    rows_rejected = serializers.IntegerField()
    issues = serializers.IntegerField()
    reasons = QualityReasonSerializer(many=True)
    last_run_at = serializers.DateTimeField(allow_null=True)


class QualitySummarySerializer(serializers.Serializer):
    """Organisation-wide rejected rows, worst dataset first."""

    dataset_count = serializers.IntegerField()
    rows_rejected = serializers.IntegerField()
    open_issues = serializers.IntegerField()
    reasons = QualityReasonSerializer(many=True)
    datasets = QualityDatasetSerializer(many=True)

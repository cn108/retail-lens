from rest_framework import serializers

from config.schema import date_field

from .models import ExportFormat, ReportKind


class SavedReportCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200)
    kind = serializers.ChoiceField(choices=ReportKind.choices)
    dataset = serializers.UUIDField(required=False, allow_null=True, default=None)
    date_from = serializers.DateField(required=False, allow_null=True, default=None)
    date_to = serializers.DateField(required=False, allow_null=True, default=None)

    def validate_name(self, value: str) -> str:
        name = value.strip()
        if not name:
            raise serializers.ValidationError("Give the report a name.")
        return name

    def validate(self, attrs: dict) -> dict:
        date_from = attrs.get("date_from")
        date_to = attrs.get("date_to")
        if date_from and date_to and date_from > date_to:
            raise serializers.ValidationError(
                {"date_from": "The start date must not be after the end date."}
            )
        return attrs


class SavedReportUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200, required=False)
    kind = serializers.ChoiceField(choices=ReportKind.choices, required=False)
    dataset = serializers.UUIDField(required=False, allow_null=True)
    date_from = serializers.DateField(required=False, allow_null=True)
    date_to = serializers.DateField(required=False, allow_null=True)

    def validate_name(self, value: str) -> str:
        name = value.strip()
        if not name:
            raise serializers.ValidationError("Give the report a name.")
        return name


class ReportExportCreateSerializer(serializers.Serializer):
    format = serializers.ChoiceField(choices=ExportFormat.choices)


class ReportDatasetSerializer(serializers.Serializer):
    """The dataset a report is scoped to, when it has one."""

    id = serializers.CharField()
    name = serializers.CharField()


class SavedReportSummarySerializer(serializers.Serializer):
    """A saved report and the scope it was saved with."""

    id = serializers.CharField()
    name = serializers.CharField()
    kind = serializers.ChoiceField(choices=ReportKind.choices)
    kind_label = serializers.CharField()
    dataset = ReportDatasetSerializer(allow_null=True)
    date_from = date_field()
    date_to = date_field()
    created_by = serializers.CharField(allow_null=True)
    created_at = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()


class ReportCardSerializer(serializers.Serializer):
    """One headline figure with its display format."""

    label = serializers.CharField()
    value = serializers.JSONField(allow_null=True)
    format = serializers.CharField()
    note = serializers.CharField()


class ReportColumnSerializer(serializers.Serializer):
    """A column header the section's rows are keyed by."""

    key = serializers.CharField()
    label = serializers.CharField()
    format = serializers.CharField()


class ReportSectionSerializer(serializers.Serializer):
    """A titled table whose rows follow the section's columns."""

    key = serializers.CharField()
    title = serializers.CharField()
    description = serializers.CharField()
    columns = ReportColumnSerializer(many=True)
    rows = serializers.ListField(child=serializers.DictField())


class ReportPeriodSerializer(serializers.Serializer):
    date_from = date_field()
    date_to = date_field()


class ReportDefinitionSerializer(serializers.Serializer):
    """The published definition of one measure used by the report."""

    metric = serializers.CharField()
    definition = serializers.CharField()
    grain = serializers.CharField()
    exclusions = serializers.CharField()


class SavedReportSerializer(SavedReportSummarySerializer):
    """A saved report computed for its scope, ready to render or export."""

    generated_at = serializers.CharField()
    organisation_name = serializers.CharField()
    currency = serializers.CharField()
    has_data = serializers.BooleanField()
    period = ReportPeriodSerializer()
    comparison = ReportPeriodSerializer()
    summary = ReportCardSerializer(many=True)
    sections = ReportSectionSerializer(many=True)
    notes = serializers.ListField(child=serializers.CharField())
    definitions = ReportDefinitionSerializer(many=True)


class ReportExportSerializer(serializers.Serializer):
    """One export job for a saved report."""

    id = serializers.CharField()
    report_id = serializers.CharField()
    report_name = serializers.CharField()
    format = serializers.ChoiceField(choices=ExportFormat.choices)
    status = serializers.CharField()
    filename = serializers.CharField(allow_null=True)
    row_count = serializers.IntegerField(allow_null=True)
    size_bytes = serializers.IntegerField(allow_null=True)
    error_message = serializers.CharField(allow_null=True)
    created_at = serializers.DateTimeField()
    started_at = serializers.DateTimeField(allow_null=True)
    finished_at = serializers.DateTimeField(allow_null=True)
    download_url = serializers.CharField(allow_null=True)

from rest_framework import serializers

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

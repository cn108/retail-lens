"""Request and response schemas for the forecasting endpoints.

The run payloads are assembled by ``forecasting.services`` from a run, its
points and its anomalies; these serializers describe them for the OpenAPI schema
while the service stays responsible for the values.
"""

from rest_framework import serializers

from config.schema import date_field, money_field


class ForecastRunCreateSerializer(serializers.Serializer):
    dataset = serializers.UUIDField(required=False, allow_null=True, default=None)
    horizon = serializers.IntegerField(min_value=1, max_value=12, default=3)


class ForecastDatasetSerializer(serializers.Serializer):
    """The dataset a run was trained on, when it was scoped to one."""

    id = serializers.CharField()
    name = serializers.CharField()


class ForecastRunSerializer(serializers.Serializer):
    """One forecast run and the backtest metrics behind it."""

    id = serializers.CharField()
    status = serializers.CharField()
    granularity = serializers.CharField()
    horizon = serializers.IntegerField()
    dataset = ForecastDatasetSerializer(allow_null=True)
    model_name = serializers.CharField(allow_null=True)
    model_version = serializers.CharField(allow_null=True)
    training_start = date_field()
    training_end = date_field()
    metrics = serializers.JSONField(allow_null=True)
    anomaly_method = serializers.CharField(allow_null=True)
    anomaly_count = serializers.IntegerField()
    error_message = serializers.CharField(allow_null=True)
    created_at = serializers.DateTimeField()
    started_at = serializers.DateTimeField(allow_null=True)
    finished_at = serializers.DateTimeField(allow_null=True)


class ForecastPointSerializer(serializers.Serializer):
    """One predicted month with its interval."""

    target_date = date_field()
    predicted_amount = money_field()
    lower_bound = money_field()
    upper_bound = money_field()


class ForecastAnomalySerializer(serializers.Serializer):
    """An observed month that fell outside the expected range."""

    id = serializers.CharField()
    observed_date = date_field()
    observed_amount = money_field()
    expected_amount = money_field()
    deviation_amount = money_field()
    score = serializers.CharField()
    direction = serializers.CharField()
    note = serializers.CharField(allow_blank=True)
    acknowledged_at = serializers.DateTimeField(allow_null=True)


class ForecastRunDetailSerializer(ForecastRunSerializer):
    """A run with its training history, predictions and anomalies."""

    history = serializers.JSONField(allow_null=True)
    points = ForecastPointSerializer(many=True)
    anomalies = ForecastAnomalySerializer(many=True)


class AnomalyTriageSerializer(serializers.Serializer):
    """The body accepted when annotating or acknowledging an anomaly."""

    note = serializers.CharField(max_length=255, required=False, allow_blank=True)
    acknowledged = serializers.BooleanField(required=False)


class AnomalyTriageResultSerializer(serializers.Serializer):
    id = serializers.CharField()
    note = serializers.CharField(allow_blank=True)
    acknowledged_at = serializers.DateTimeField(allow_null=True)

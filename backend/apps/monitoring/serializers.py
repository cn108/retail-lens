"""Request and response schemas for the monitoring endpoints.

The payloads are built by ``monitoring.services`` so that the alert and board
views, which validate their bodies by hand, still publish one schema per
operation. The write serializers document the accepted fields; the views keep
their validation because thresholds, recipients and widget lists are clamped
rather than rejected outright.
"""

from rest_framework import serializers

from apps.reporting.models import ExportFormat

from .models import AlertComparator, AlertMetric, ScheduleFrequency, TargetMetric


class MetricChoiceSerializer(serializers.Serializer):
    """A metric a rule or target can be defined on."""

    value = serializers.CharField()
    label = serializers.CharField()


class AlertEventSerializer(serializers.Serializer):
    """One time an alert rule crossed its threshold."""

    id = serializers.CharField()
    value = serializers.CharField()
    threshold = serializers.CharField()
    message = serializers.CharField()
    triggered_at = serializers.DateTimeField()
    acknowledged_at = serializers.DateTimeField(allow_null=True)


class AlertRuleSerializer(serializers.Serializer):
    """One alert rule with its five most recent events."""

    id = serializers.CharField()
    name = serializers.CharField()
    metric = serializers.CharField()
    metric_label = serializers.CharField()
    comparator = serializers.CharField()
    threshold = serializers.CharField()
    window_days = serializers.IntegerField()
    dataset = serializers.CharField(allow_null=True)
    enabled = serializers.BooleanField()
    last_checked_at = serializers.DateTimeField(allow_null=True)
    last_value = serializers.CharField(allow_null=True)
    last_state = serializers.CharField()
    events = AlertEventSerializer(many=True)


class AlertListSerializer(serializers.Serializer):
    metrics = MetricChoiceSerializer(many=True)
    rules = AlertRuleSerializer(many=True)


class AlertEvaluateSerializer(serializers.Serializer):
    """The result of evaluating every enabled rule."""

    created_events = serializers.IntegerField()
    metrics = MetricChoiceSerializer(many=True)
    rules = AlertRuleSerializer(many=True)


class AlertEventAcknowledgedSerializer(serializers.Serializer):
    id = serializers.CharField()
    acknowledged_at = serializers.DateTimeField()


class AlertWriteSerializer(serializers.Serializer):
    """The body accepted when creating an alert rule."""

    name = serializers.CharField(max_length=160)
    metric = serializers.ChoiceField(choices=AlertMetric.choices)
    comparator = serializers.ChoiceField(
        choices=AlertComparator.choices, required=False, default=AlertComparator.BELOW
    )
    threshold = serializers.DecimalField(max_digits=18, decimal_places=2, min_value=0)
    window_days = serializers.IntegerField(required=False, min_value=1, max_value=365, default=30)
    dataset = serializers.UUIDField(required=False, allow_null=True)
    enabled = serializers.BooleanField(required=False, default=True)


class AlertUpdateSerializer(AlertWriteSerializer):
    """The subset of an alert rule that PATCH accepts."""

    name = serializers.CharField(max_length=160, required=False)
    metric = serializers.ChoiceField(choices=AlertMetric.choices, required=False)
    threshold = serializers.DecimalField(
        max_digits=18, decimal_places=2, min_value=0, required=False
    )


class TargetProgressSerializer(serializers.Serializer):
    """Actual versus target for the target's own period, to today."""

    id = serializers.CharField()
    name = serializers.CharField()
    metric = serializers.CharField()
    metric_label = serializers.CharField()
    target = serializers.CharField()
    actual = serializers.CharField()
    attainment_percent = serializers.CharField(allow_null=True)
    expected_percent = serializers.CharField()
    pace = serializers.CharField()
    period_start = serializers.DateField()
    period_end = serializers.DateField()
    days_elapsed = serializers.IntegerField()
    days_total = serializers.IntegerField()
    dataset = serializers.CharField(allow_null=True)


class TargetListSerializer(serializers.Serializer):
    targets = TargetProgressSerializer(many=True)


class TargetWriteSerializer(serializers.Serializer):
    """The body accepted when creating a target."""

    name = serializers.CharField(max_length=160)
    metric = serializers.ChoiceField(choices=TargetMetric.choices)
    amount = serializers.DecimalField(max_digits=18, decimal_places=2, min_value=0)
    period_start = serializers.DateField()
    period_end = serializers.DateField()
    dataset = serializers.UUIDField(required=False, allow_null=True)


class ScheduleSerializer(serializers.Serializer):
    """A recurring export of one saved report."""

    id = serializers.CharField()
    report = serializers.CharField()
    report_name = serializers.CharField()
    frequency = serializers.CharField()
    format = serializers.CharField()
    recipients = serializers.ListField(child=serializers.CharField())
    enabled = serializers.BooleanField()
    next_run_at = serializers.DateTimeField(allow_null=True)
    last_run_at = serializers.DateTimeField(allow_null=True)
    last_status = serializers.CharField(allow_null=True)
    last_error = serializers.CharField(allow_null=True)


class ScheduleListSerializer(serializers.Serializer):
    schedules = ScheduleSerializer(many=True)


class ScheduleWriteSerializer(serializers.Serializer):
    """The body accepted when creating a report schedule."""

    report = serializers.UUIDField()
    frequency = serializers.ChoiceField(
        choices=ScheduleFrequency.choices, required=False, default=ScheduleFrequency.WEEKLY
    )
    format = serializers.ChoiceField(
        choices=ExportFormat.choices, required=False, default=ExportFormat.CSV
    )
    recipients = serializers.ListField(child=serializers.CharField(), min_length=1)
    enabled = serializers.BooleanField(required=False, default=True)


class ScheduleUpdateSerializer(ScheduleWriteSerializer):
    """The subset of a schedule that PATCH accepts."""

    report = serializers.UUIDField(required=False)
    recipients = serializers.ListField(child=serializers.CharField(), required=False)


class BoardSerializer(serializers.Serializer):
    """A saved dashboard layout."""

    id = serializers.CharField()
    name = serializers.CharField()
    description = serializers.CharField(allow_blank=True)
    widgets = serializers.ListField(child=serializers.DictField())
    created_at = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()
    created_by = serializers.CharField(allow_null=True)


class BoardListSerializer(serializers.Serializer):
    boards = BoardSerializer(many=True)


class BoardWriteSerializer(serializers.Serializer):
    """The body accepted when creating a board."""

    name = serializers.CharField(max_length=160)
    description = serializers.CharField(max_length=255, required=False, allow_blank=True)
    widgets = serializers.ListField(
        child=serializers.DictField(),
        min_length=1,
        help_text=(
            "Up to twelve widgets. Supported types: kpi, trend, geography, returns, "
            "basket, top_products, targets, alerts."
        ),
    )


class BoardUpdateSerializer(BoardWriteSerializer):
    """The subset of a board that PATCH accepts."""

    name = serializers.CharField(max_length=160, required=False)
    widgets = serializers.ListField(child=serializers.DictField(), required=False)

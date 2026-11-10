"""Threshold alerts, targets, scheduled report delivery and saved boards.

Alerts and targets store a metric name and a window, never a cached number:
values are recomputed from the same analytics services the dashboards use, so a
breach always matches what an analyst can see on the page.
"""

import uuid

from django.conf import settings
from django.db import models


class AlertMetric(models.TextChoices):
    NET_SALES = "net_sales", "Net sales"
    ORDERS = "orders", "Orders"
    AVERAGE_ORDER_VALUE = "average_order_value", "Average order value"
    CUSTOMERS = "customers", "Unique customers"
    RETURN_RATE = "return_rate", "Return rate (%)"
    DISCOUNT_RATE = "discount_rate", "Discount rate (%)"


class AlertComparator(models.TextChoices):
    BELOW = "below", "Falls below"
    ABOVE = "above", "Rises above"


class AlertState(models.TextChoices):
    OK = "ok", "Within threshold"
    BREACHED = "breached", "Breached"
    UNKNOWN = "unknown", "Not evaluated yet"


class AlertRule(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(
        "organisations.Organisation", on_delete=models.CASCADE, related_name="alert_rules"
    )
    dataset = models.ForeignKey(
        "datasets.Dataset",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="alert_rules",
    )
    name = models.CharField(max_length=160)
    metric = models.CharField(max_length=32, choices=AlertMetric.choices)
    comparator = models.CharField(
        max_length=8, choices=AlertComparator.choices, default=AlertComparator.BELOW
    )
    threshold = models.DecimalField(max_digits=16, decimal_places=4)
    window_days = models.PositiveIntegerField(default=30)
    enabled = models.BooleanField(default=True)
    last_checked_at = models.DateTimeField(null=True, blank=True)
    last_value = models.DecimalField(max_digits=18, decimal_places=4, null=True, blank=True)
    last_state = models.CharField(
        max_length=12, choices=AlertState.choices, default=AlertState.UNKNOWN
    )
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
        db_table = "alert_rules"
        ordering = ["name"]

    def __str__(self) -> str:
        return f"{self.name} ({self.metric} {self.comparator} {self.threshold})"


class AlertEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    rule = models.ForeignKey(AlertRule, on_delete=models.CASCADE, related_name="events")
    value = models.DecimalField(max_digits=18, decimal_places=4)
    threshold = models.DecimalField(max_digits=16, decimal_places=4)
    message = models.CharField(max_length=255, blank=True)
    triggered_at = models.DateTimeField(auto_now_add=True)
    acknowledged_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "alert_events"
        ordering = ["-triggered_at"]
        indexes = [models.Index(fields=["rule", "-triggered_at"])]

    def __str__(self) -> str:
        return f"{self.rule_id} @ {self.triggered_at:%Y-%m-%d %H:%M}"


class TargetMetric(models.TextChoices):
    NET_SALES = "net_sales", "Net sales"
    ORDERS = "orders", "Orders"
    AVERAGE_ORDER_VALUE = "average_order_value", "Average order value"


class Target(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(
        "organisations.Organisation", on_delete=models.CASCADE, related_name="targets"
    )
    dataset = models.ForeignKey(
        "datasets.Dataset",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="targets",
    )
    name = models.CharField(max_length=160)
    metric = models.CharField(max_length=32, choices=TargetMetric.choices)
    amount = models.DecimalField(max_digits=16, decimal_places=4)
    period_start = models.DateField()
    period_end = models.DateField()
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
        db_table = "targets"
        ordering = ["-period_start", "name"]

    def __str__(self) -> str:
        return f"{self.name} ({self.period_start} – {self.period_end})"


class ScheduleFrequency(models.TextChoices):
    DAILY = "daily", "Every day"
    WEEKLY = "weekly", "Every week"
    MONTHLY = "monthly", "Every month"


class ReportSchedule(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(
        "organisations.Organisation", on_delete=models.CASCADE, related_name="report_schedules"
    )
    report = models.ForeignKey(
        "reporting.SavedReport", on_delete=models.CASCADE, related_name="schedules"
    )
    frequency = models.CharField(
        max_length=8, choices=ScheduleFrequency.choices, default=ScheduleFrequency.WEEKLY
    )
    format = models.CharField(
        max_length=4,
        choices=[("csv", "CSV"), ("pdf", "PDF")],
        default="csv",
    )
    recipients = models.JSONField(default=list, blank=True)
    enabled = models.BooleanField(default=True)
    next_run_at = models.DateTimeField(null=True, blank=True)
    last_run_at = models.DateTimeField(null=True, blank=True)
    last_status = models.CharField(max_length=16, blank=True)
    last_error = models.CharField(max_length=255, blank=True)
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
        db_table = "report_schedules"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.report_id} ({self.frequency})"


class Board(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(
        "organisations.Organisation", on_delete=models.CASCADE, related_name="boards"
    )
    name = models.CharField(max_length=160)
    description = models.CharField(max_length=255, blank=True)
    # Widgets are configuration only: {type, title, options}. The browser fetches
    # each widget's data from the shared analytics endpoints.
    widgets = models.JSONField(default=list, blank=True)
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
        db_table = "boards"
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name

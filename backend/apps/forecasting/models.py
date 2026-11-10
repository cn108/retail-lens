"""Forecast runs, monthly predictions and detected anomalies.

A run is the job resource exposed by the API. Its training snapshot is stored
on the run so results remain reproducible even after the warehouse changes,
and a dataset deletion keeps the run audit while clearing the optional link.
"""

import uuid

from django.db import models


class ForecastStatus(models.TextChoices):
    QUEUED = "queued", "Queued"
    RUNNING = "running", "Running"
    SUCCEEDED = "succeeded", "Succeeded"
    FAILED = "failed", "Failed"


class ForecastRun(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(
        "organisations.Organisation",
        on_delete=models.CASCADE,
        related_name="forecast_runs",
    )
    dataset = models.ForeignKey(
        "datasets.Dataset",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="forecast_runs",
    )
    status = models.CharField(
        max_length=16, choices=ForecastStatus.choices, default=ForecastStatus.QUEUED
    )
    granularity = models.CharField(max_length=16, default="month")
    horizon = models.PositiveSmallIntegerField()
    model_name = models.CharField(max_length=64)
    model_version = models.CharField(max_length=64)
    training_start = models.DateField(null=True, blank=True)
    training_end = models.DateField(null=True, blank=True)
    history = models.JSONField(default=list, blank=True)
    metrics = models.JSONField(default=dict, blank=True)
    anomaly_method = models.CharField(max_length=128, blank=True)
    anomaly_count = models.PositiveIntegerField(default=0)
    error_message = models.TextField(blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        "accounts.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "forecast_runs"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["organisation", "-created_at"]),
            models.Index(fields=["dataset", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.organisation_id} {self.status} {self.granularity}"


class ForecastPoint(models.Model):
    id = models.BigAutoField(primary_key=True)
    run = models.ForeignKey(ForecastRun, on_delete=models.CASCADE, related_name="points")
    target_date = models.DateField()
    predicted_amount = models.DecimalField(max_digits=14, decimal_places=4)
    lower_bound = models.DecimalField(max_digits=14, decimal_places=4)
    upper_bound = models.DecimalField(max_digits=14, decimal_places=4)

    class Meta:
        db_table = "forecast_points"
        ordering = ["target_date"]
        constraints = [
            models.UniqueConstraint(fields=["run", "target_date"], name="unique_forecast_point")
        ]

    def __str__(self) -> str:
        return f"{self.run_id} {self.target_date}"


class ForecastAnomaly(models.Model):
    id = models.BigAutoField(primary_key=True)
    run = models.ForeignKey(ForecastRun, on_delete=models.CASCADE, related_name="anomalies")
    observed_date = models.DateField()
    observed_amount = models.DecimalField(max_digits=14, decimal_places=4)
    expected_amount = models.DecimalField(max_digits=14, decimal_places=4)
    deviation_amount = models.DecimalField(max_digits=14, decimal_places=4)
    score = models.DecimalField(max_digits=12, decimal_places=3)
    direction = models.CharField(max_length=8)
    # Triage notes are analyst annotations on an observed anomaly, not model
    # output: they explain an outlier without altering the stored forecast.
    note = models.CharField(max_length=255, blank=True)
    acknowledged_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "forecast_anomalies"
        ordering = ["observed_date"]
        constraints = [
            models.UniqueConstraint(fields=["run", "observed_date"], name="unique_forecast_anomaly")
        ]

    def __str__(self) -> str:
        return f"{self.run_id} {self.observed_date}"

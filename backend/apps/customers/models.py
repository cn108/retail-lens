"""Saved customer segment definitions.

A segment is a reusable rule set evaluated against the same RFM selection the
Customers page already uses. Rules are stored as data so a saved segment never
becomes a second implementation of the metric: the rules narrow scored rows.
"""

import uuid

from django.conf import settings
from django.db import models


class CustomerSegment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(
        "organisations.Organisation",
        on_delete=models.CASCADE,
        related_name="customer_segments",
    )
    # A null dataset means every processed dataset in the organisation.
    dataset = models.ForeignKey(
        "datasets.Dataset",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="customer_segments",
    )
    name = models.CharField(max_length=120)
    description = models.CharField(max_length=255, blank=True)
    # Supported keys: recency_days_max, recency_days_min, orders_min,
    # net_sales_min, rfm_segment, rfm_score_min.
    rules = models.JSONField(default=dict, blank=True)
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
        db_table = "customer_segments"
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["organisation", "name"], name="unique_segment_name_per_organisation"
            )
        ]

    def __str__(self) -> str:
        return self.name

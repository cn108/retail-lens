"""Organisations, membership and roles.

Every user-owned row is scoped to an organisation. Memberships are the single
source of truth for who may read or change an organisation's data, and the
role on a membership decides which actions are allowed. Enforcement lives in
querysets and services (see services.py), never in the UI.
"""

import uuid

from django.conf import settings
from django.db import models
from django.utils.text import slugify


class Role(models.TextChoices):
    OWNER = "owner", "Owner"
    ADMIN = "admin", "Admin"
    ANALYST = "analyst", "Analyst"
    VIEWER = "viewer", "Viewer"


# Capabilities are ordered: a role may do everything a lower-ranked role may do.
ROLE_RANK = {
    Role.VIEWER: 10,
    Role.ANALYST: 20,
    Role.ADMIN: 30,
    Role.OWNER: 40,
}


class Organisation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=120, unique=True, blank=True)
    currency = models.CharField(
        max_length=3,
        default="GBP",
        help_text="ISO 4217 code used for every monetary measure in this organisation.",
    )
    timezone = models.CharField(
        max_length=64,
        default="Europe/London",
        help_text="IANA time zone used to present dates and times.",
    )
    retention_days = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Days uploaded source rows are kept. Empty means keep indefinitely.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "organisations"
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name

    def save(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        if not self.slug:
            self.slug = self._unique_slug(self.name)
        super().save(*args, **kwargs)

    def _unique_slug(self, value: str) -> str:
        base = slugify(value)[:100] or "organisation"
        slug = base
        suffix = 2
        while Organisation.objects.filter(slug=slug).exclude(pk=self.pk).exists():
            slug = f"{base}-{suffix}"
            suffix += 1
        return slug


class Membership(models.Model):
    """A user's membership of one organisation, carrying their role."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(
        Organisation, on_delete=models.CASCADE, related_name="memberships"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships"
    )
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.VIEWER)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "organisation_members"
        ordering = ["organisation__name", "user__email"]
        constraints = [
            models.UniqueConstraint(
                fields=["organisation", "user"], name="unique_organisation_member"
            )
        ]

    def __str__(self) -> str:
        return f"{self.user} in {self.organisation} ({self.role})"

    def has_role(self, minimum: Role | str) -> bool:
        return ROLE_RANK[Role(self.role)] >= ROLE_RANK[Role(minimum)]

    @property
    def can_manage_members(self) -> bool:
        return self.has_role(Role.ADMIN)

    @property
    def can_edit_settings(self) -> bool:
        return self.has_role(Role.ADMIN)

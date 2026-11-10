"""Custom user model.

Email is the login identifier from the start: changing the user model after
the first migration is painful, so the decision is made in M1 even though the
authentication endpoints arrive in M2.
"""

import uuid

from django.conf import settings
from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models


class UserManager(BaseUserManager):
    """Manager that treats email as the unique identifier."""

    use_in_migrations = True

    def _create_user(self, email: str, password: str | None, **extra):  # type: ignore[no-untyped-def]
        if not email:
            raise ValueError("An email address is required.")
        email = self.normalize_email(email).lower()
        user = self.model(email=email, **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email: str, password: str | None = None, **extra):  # type: ignore[no-untyped-def]
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra)

    def create_superuser(self, email: str, password: str | None = None, **extra):  # type: ignore[no-untyped-def]
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        if extra.get("is_staff") is not True:
            raise ValueError("Superusers must have is_staff=True.")
        if extra.get("is_superuser") is not True:
            raise ValueError("Superusers must have is_superuser=True.")
        return self._create_user(email, password, **extra)


class User(AbstractUser):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    username = None
    email = models.EmailField("email address", unique=True)
    display_name = models.CharField(max_length=150, blank=True)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []

    class Meta:
        db_table = "users"
        ordering = ["email"]

    def __str__(self) -> str:
        return self.email


class UserPreference(models.Model):
    """Per-user settings, including the organisation the user opens by default."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="preferences"
    )
    default_organisation = models.ForeignKey(
        "organisations.Organisation",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "user_preferences"

    def __str__(self) -> str:
        return f"Preferences for {self.user}"

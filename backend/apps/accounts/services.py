"""User-level services.

Other apps use these functions instead of importing ``accounts`` models
directly, which keeps the application boundary in docs/SYSTEM_DESIGN.md real.
"""

from .models import UserPreference


def preferences_for(user) -> UserPreference:  # type: ignore[no-untyped-def]
    preferences, _ = UserPreference.objects.get_or_create(user=user)
    return preferences


def default_organisation_id(user):  # type: ignore[no-untyped-def]
    preferences = UserPreference.objects.filter(user=user).only("default_organisation_id").first()
    return preferences.default_organisation_id if preferences else None


def set_default_organisation(user, organisation) -> None:  # type: ignore[no-untyped-def]
    """Accept either an Organisation instance or its primary key."""
    preferences = preferences_for(user)
    preferences.default_organisation_id = getattr(organisation, "pk", organisation)
    preferences.save(update_fields=["default_organisation", "updated_at"])


def set_default_organisation_if_unset(user, organisation) -> None:  # type: ignore[no-untyped-def]
    preferences = preferences_for(user)
    if preferences.default_organisation_id is None:
        set_default_organisation(user, organisation)


def clear_default_organisation(user, organisation_id) -> None:  # type: ignore[no-untyped-def]
    """Forget a preferred organisation after the user leaves it."""
    preferences = UserPreference.objects.filter(
        user=user, default_organisation_id=organisation_id
    ).first()
    if preferences is not None:
        preferences.default_organisation = None
        preferences.save(update_fields=["default_organisation", "updated_at"])

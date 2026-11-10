"""Tenancy rules shared by every endpoint that touches organisation data.

Views resolve the caller's membership through these functions rather than
trusting an organisation id from the request, so cross-organisation access is
denied in one place.
"""

import uuid

from django.contrib.auth import get_user_model
from django.db import transaction
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from .models import Membership, Organisation, Role


def create_organisation(
    *,
    name: str,
    owner,  # type: ignore[no-untyped-def]
    currency: str = "GBP",
    timezone: str = "Europe/London",
) -> Organisation:
    """Create an organisation and make ``owner`` its first owner."""
    with transaction.atomic():
        organisation = Organisation.objects.create(name=name, currency=currency, timezone=timezone)
        Membership.objects.create(organisation=organisation, user=owner, role=Role.OWNER)
    return organisation


def memberships_for(user):  # type: ignore[no-untyped-def]
    return (
        Membership.objects.filter(user=user)
        .select_related("organisation")
        .order_by("organisation__name")
    )


def membership_for(user, organisation_id: uuid.UUID | str) -> Membership | None:
    return (
        Membership.objects.filter(user=user, organisation_id=organisation_id)
        .select_related("organisation")
        .first()
    )


def active_membership_for(user, organisation_id: str | None = None) -> Membership | None:
    """Resolve the organisation a request operates on.

    An explicit selection (``X-Organisation-Id``) must be one of the caller's
    memberships; otherwise their preferred organisation is used, falling back
    to their first membership. A caller with no memberships gets ``None``.
    """
    memberships = memberships_for(user)
    if organisation_id:
        membership = memberships.filter(organisation_id=organisation_id).first()
        if membership is None:
            raise NotFound("Organisation not found.")
        return membership

    from apps.accounts.services import default_organisation_id

    preferred = default_organisation_id(user)
    if preferred:
        membership = memberships.filter(organisation_id=preferred).first()
        if membership is not None:
            return membership
    return memberships.first()


def require_role(membership: Membership, minimum: Role) -> None:
    if not membership.has_role(minimum):
        raise PermissionDenied("Your role does not allow this action.")


def member_count(organisation: Organisation) -> int:
    return organisation.memberships.count()


def add_member(
    *, organisation: Organisation, email: str, role: str, actor: Membership
) -> Membership:
    """Add an existing account to the organisation.

    Invitations to people without an account are deliberately out of scope for
    this milestone: adding an unknown email would create a membership that no
    one can accept.
    """
    require_role(actor, Role.ADMIN)
    if role == Role.OWNER and actor.role != Role.OWNER:
        raise PermissionDenied("Only an owner can grant the owner role.")

    user = get_user_model().objects.filter(email=email.strip().lower()).first()
    if user is None:
        raise ValidationError({"email": "No account uses that email address."})
    if Membership.objects.filter(organisation=organisation, user=user).exists():
        raise ValidationError({"email": "That person is already a member."})

    return Membership.objects.create(organisation=organisation, user=user, role=role)


def change_role(*, membership: Membership, role: str, actor: Membership) -> Membership:
    require_role(actor, Role.ADMIN)
    if actor.role != Role.OWNER and membership.role == Role.OWNER:
        raise PermissionDenied("Only an owner can change an owner's role.")
    if role == Role.OWNER and actor.role != Role.OWNER:
        raise PermissionDenied("Only an owner can grant the owner role.")
    if (
        membership.role == Role.OWNER
        and role != Role.OWNER
        and _owner_count(membership.organisation) == 1
    ):
        raise ValidationError({"role": "An organisation must keep at least one owner."})

    membership.role = role
    membership.save(update_fields=["role"])
    return membership


def remove_member(*, membership: Membership, actor: Membership) -> None:
    require_role(actor, Role.ADMIN)
    if membership.role == Role.OWNER and _owner_count(membership.organisation) == 1:
        raise ValidationError("An organisation must keep at least one owner.")
    if actor.role != Role.OWNER and membership.role == Role.OWNER:
        raise PermissionDenied("Only an owner can remove an owner.")

    user = membership.user
    organisation_id = membership.organisation_id
    membership.delete()

    from apps.accounts.services import clear_default_organisation

    clear_default_organisation(user, organisation_id)


def _owner_count(organisation: Organisation) -> int:
    return organisation.memberships.filter(role=Role.OWNER).count()

import pytest
from django.urls import reverse

from apps.accounts.services import default_organisation_id
from apps.organisations.models import Membership, Role


@pytest.mark.django_db
def test_organisations_endpoint_lists_only_the_callers_memberships(auth_client, organisation):
    response = auth_client.get(reverse("organisation-list"))

    assert response.status_code == 200
    assert [item["name"] for item in response.json()] == ["Acme Retail"]
    assert response.json()[0]["role"] == Role.OWNER


@pytest.mark.django_db
def test_outsider_cannot_read_or_select_a_foreign_organisation(api_for, other_user, organisation):
    client = api_for(other_user)

    assert client.get(reverse("organisation-current")).status_code == 404
    assert client.get(reverse("organisation-members")).status_code == 404

    selected = client.get(
        reverse("organisation-current"),
        headers={"X-Organisation-Id": str(organisation.id)},
    )
    assert selected.status_code == 404


@pytest.mark.django_db
def test_outsider_cannot_edit_a_foreign_organisation(api_for, other_user, organisation):
    client = api_for(other_user)

    response = client.patch(
        reverse("organisation-current"),
        {"currency": "USD"},
        format="json",
        headers={"X-Organisation-Id": str(organisation.id)},
    )

    assert response.status_code == 404
    organisation.refresh_from_db()
    assert organisation.currency == "GBP"


@pytest.mark.django_db
def test_viewer_can_read_but_not_change_the_organisation(api_for, member, organisation):
    client = api_for(member.user)

    assert client.get(reverse("organisation-current")).status_code == 200

    response = client.patch(reverse("organisation-current"), {"name": "Renamed"}, format="json")
    assert response.status_code == 403
    organisation.refresh_from_db()
    assert organisation.name == "Acme Retail"


@pytest.mark.django_db
def test_admin_can_change_settings_but_not_grant_ownership(api_for, member, other_user):
    member.role = Role.ADMIN
    member.save(update_fields=["role"])
    client = api_for(member.user)

    response = client.patch(
        reverse("organisation-current"),
        {"currency": "usd", "timezone": "Europe/Berlin", "retention_days": 90},
        format="json",
    )
    assert response.status_code == 200
    assert response.json()["currency"] == "USD"

    member.role = Role.ADMIN
    member.save(update_fields=["role"])
    promoted = client.post(
        reverse("organisation-members"),
        {"email": "owner@example.com", "role": Role.OWNER},
        format="json",
    )
    assert promoted.status_code == 403


@pytest.mark.django_db
def test_analyst_cannot_manage_members(api_for, member):
    member.role = Role.ANALYST
    member.save(update_fields=["role"])
    client = api_for(member.user)

    response = client.get(reverse("organisation-members"))
    assert response.status_code == 200

    response = client.patch(
        reverse("organisation-member", args=[member.id]),
        {"role": Role.VIEWER},
        format="json",
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_owner_cannot_demote_or_remove_the_last_owner(auth_client, user, organisation):
    membership = Membership.objects.get(organisation=organisation, user=user)

    demote = auth_client.patch(
        reverse("organisation-member", args=[membership.id]),
        {"role": Role.ADMIN},
        format="json",
    )
    assert demote.status_code == 400
    assert "owner" in demote.json()["error"]["fields"]["role"][0].lower()

    remove = auth_client.delete(reverse("organisation-member", args=[membership.id]))
    assert remove.status_code == 400
    assert Membership.objects.filter(id=membership.id).exists()


@pytest.mark.django_db
def test_owner_can_add_change_and_remove_a_member(auth_client, other_user, organisation):
    added = auth_client.post(
        reverse("organisation-members"),
        {"email": other_user.email, "role": Role.ANALYST},
        format="json",
    )
    assert added.status_code == 201
    membership_id = added.json()["id"]

    promoted = auth_client.patch(
        reverse("organisation-member", args=[membership_id]),
        {"role": Role.ADMIN},
        format="json",
    )
    assert promoted.status_code == 200
    assert promoted.json()["role"] == Role.ADMIN

    removed = auth_client.delete(reverse("organisation-member", args=[membership_id]))
    assert removed.status_code == 204
    assert not Membership.objects.filter(id=membership_id).exists()


@pytest.mark.django_db
def test_removing_a_member_revokes_access_and_clears_their_preference(
    auth_client, api_for, other_user, organisation
):
    auth_client.post(
        reverse("organisation-members"),
        {"email": other_user.email, "role": Role.VIEWER},
        format="json",
    )
    member_client = api_for(other_user)
    member_client.patch(
        reverse("auth-preferences"),
        {"default_organisation": str(organisation.id)},
        format="json",
    )
    assert default_organisation_id(other_user) == organisation.id

    membership = Membership.objects.get(user=other_user)
    auth_client.delete(reverse("organisation-member", args=[membership.id]))

    assert member_client.get(reverse("organisation-current")).status_code == 404
    assert default_organisation_id(other_user) is None

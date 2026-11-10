import pytest
from django.urls import reverse

from apps.accounts.services import default_organisation_id
from apps.organisations.models import Membership, Role


@pytest.mark.django_db
def test_create_organisation_makes_the_caller_an_owner(auth_client, user):
    response = auth_client.post(
        reverse("organisation-list"),
        {"name": "Second Store", "currency": "EUR"},
        format="json",
    )

    assert response.status_code == 201
    body = response.json()
    assert body["role"] == Role.OWNER
    assert body["slug"] == "second-store"
    assert Membership.objects.filter(
        organisation_id=body["id"], user=user, role=Role.OWNER
    ).exists()


@pytest.mark.django_db
def test_collection_accepts_a_post_without_a_trailing_slash(auth_client):
    """APPEND_SLASH cannot redirect a POST, so the bare URL must be routed."""
    response = auth_client.post("/api/v1/organisations", {"name": "No Slash"}, format="json")

    assert response.status_code == 201
    assert response.json()["slug"] == "no-slash"


@pytest.mark.django_db
def test_first_organisation_becomes_the_default(auth_client, user):
    response = auth_client.post(reverse("organisation-list"), {"name": "First"}, format="json")

    assert str(default_organisation_id(user)) == response.json()["id"]


@pytest.mark.django_db
@pytest.mark.parametrize(
    "payload",
    [
        {"currency": "POUNDS"},
        {"timezone": "Mars/Olympus"},
        {"retention_days": 0},
    ],
)
def test_organisation_settings_are_validated(auth_client, organisation, payload):
    response = auth_client.patch(reverse("organisation-current"), payload, format="json")

    assert response.status_code == 400


@pytest.mark.django_db
def test_member_list_includes_emails_and_roles(auth_client, member):
    response = auth_client.get(reverse("organisation-members"))

    assert response.status_code == 200
    roles = {item["email"]: item["role"] for item in response.json()}
    assert roles == {
        "owner@example.com": Role.OWNER,
        "outsider@example.com": Role.VIEWER,
    }


@pytest.mark.django_db
def test_adding_an_unknown_email_is_rejected(auth_client, organisation):
    response = auth_client.post(
        reverse("organisation-members"),
        {"email": "nobody@example.com", "role": Role.VIEWER},
        format="json",
    )

    assert response.status_code == 400
    assert response.json()["error"]["fields"]["email"]


@pytest.mark.django_db
def test_adding_an_existing_member_is_rejected(auth_client, user, organisation):
    response = auth_client.post(
        reverse("organisation-members"),
        {"email": user.email, "role": Role.VIEWER},
        format="json",
    )

    assert response.status_code == 400
    assert response.json()["error"]["fields"]["email"]


@pytest.mark.django_db
def test_owner_can_grant_ownership(auth_client, organisation, other_user):
    response = auth_client.post(
        reverse("organisation-members"),
        {"email": other_user.email, "role": Role.OWNER},
        format="json",
    )

    assert response.status_code == 201
    assert response.json()["role"] == Role.OWNER

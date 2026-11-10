import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.services import default_organisation_id
from apps.organisations.models import Membership, Role


@pytest.mark.django_db
def test_register_creates_a_workspace_and_signs_in(api_client):
    response = api_client.post(
        reverse("auth-register"),
        {
            "email": "New.User@Example.com",
            "password": "a-long-enough-pass-42",
            "display_name": "Nia New",
            "organisation_name": "Northwind",
        },
        format="json",
    )

    assert response.status_code == 201
    assert response.json()["email"] == "new.user@example.com"
    user = get_user_model().objects.get(email="new.user@example.com")
    membership = Membership.objects.get(user=user)
    assert membership.organisation.name == "Northwind"
    assert membership.role == Role.OWNER
    assert str(default_organisation_id(user)) == str(membership.organisation_id)

    # The registration response also established a session.
    assert api_client.get(reverse("auth-me")).status_code == 200


@pytest.mark.django_db
def test_register_defaults_the_workspace_name(api_client):
    response = api_client.post(
        reverse("auth-register"),
        {"email": "solo@example.com", "password": "a-long-enough-pass-42"},
        format="json",
    )

    assert response.status_code == 201
    membership = Membership.objects.get(user__email="solo@example.com")
    assert membership.organisation.name == "solo's workspace"


@pytest.mark.django_db
def test_register_rejects_duplicate_email(api_client, user):
    response = api_client.post(
        reverse("auth-register"),
        {"email": user.email, "password": "a-long-enough-pass-42"},
        format="json",
    )

    assert response.status_code == 400
    assert response.json()["error"]["fields"]["email"]


@pytest.mark.django_db
def test_register_rejects_a_weak_password(api_client):
    response = api_client.post(
        reverse("auth-register"),
        {"email": "weak@example.com", "password": "123"},
        format="json",
    )

    assert response.status_code == 400
    assert "password" in response.json()["error"]["fields"]


@pytest.mark.django_db
def test_login_rejects_a_wrong_password(api_client, user):
    response = api_client.post(
        reverse("auth-login"),
        {"email": user.email, "password": "not-the-password"},
        format="json",
    )

    assert response.status_code == 401
    assert "incorrect" in response.json()["error"]["message"].lower()


@pytest.mark.django_db
def test_login_then_logout_controls_the_session(api_client, user):
    login = api_client.post(
        reverse("auth-login"),
        {"email": user.email.upper(), "password": "s3cret-pass-123"},
        format="json",
    )
    assert login.status_code == 200
    assert api_client.get(reverse("auth-me")).status_code == 200

    logout = api_client.post(reverse("auth-logout"))
    assert logout.status_code == 204
    assert api_client.get(reverse("auth-me")).status_code == 401


@pytest.mark.django_db
def test_anonymous_requests_are_rejected(api_client):
    response = api_client.get(reverse("auth-me"))

    assert response.status_code == 401
    assert response.json()["error"]["status"] == 401


@pytest.mark.django_db
def test_profile_update_changes_display_name(auth_client, user):
    response = auth_client.patch(
        reverse("auth-me"), {"display_name": "  Olive Renamed  "}, format="json"
    )

    assert response.status_code == 200
    user.refresh_from_db()
    assert user.display_name == "Olive Renamed"


@pytest.mark.django_db
def test_password_change_requires_the_current_password(auth_client, user):
    response = auth_client.post(
        reverse("auth-password"),
        {"current_password": "wrong", "new_password": "another-long-pass-9"},
        format="json",
    )
    assert response.status_code == 400

    response = auth_client.post(
        reverse("auth-password"),
        {"current_password": "s3cret-pass-123", "new_password": "another-long-pass-9"},
        format="json",
    )
    assert response.status_code == 204

    user.refresh_from_db()
    assert user.check_password("another-long-pass-9")
    # The session survives the password change.
    assert auth_client.get(reverse("auth-me")).status_code == 200


@pytest.mark.django_db
def test_preferences_reject_an_organisation_the_user_does_not_belong_to(
    api_client, user, other_user
):
    from apps.organisations.services import create_organisation

    foreign = create_organisation(name="Foreign", owner=other_user)
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.patch(
        reverse("auth-preferences"),
        {"default_organisation": str(foreign.id)},
        format="json",
    )

    assert response.status_code == 400
    assert default_organisation_id(user) is None

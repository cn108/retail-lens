import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.organisations.models import Membership, Role
from apps.organisations.services import create_organisation


@pytest.fixture(autouse=True)
def _eager_celery(settings):
    """Run queued processing inline so the pipeline is exercised end to end."""
    settings.CELERY_TASK_ALWAYS_EAGER = True
    settings.CELERY_TASK_EAGER_PROPAGATES = False


@pytest.fixture(autouse=True)
def _isolated_media(settings, tmp_path):
    """Keep uploaded test files out of the repository's media directory."""
    settings.MEDIA_ROOT = tmp_path / "media"
    return settings.MEDIA_ROOT


@pytest.fixture
def user(db):
    return get_user_model().objects.create_user(
        email="owner@example.com",
        password="s3cret-pass-123",
        display_name="Olive Owner",
    )


@pytest.fixture
def other_user(db):
    return get_user_model().objects.create_user(
        email="outsider@example.com",
        password="s3cret-pass-123",
        display_name="Otto Outsider",
    )


@pytest.fixture
def organisation(db, user):
    return create_organisation(name="Acme Retail", owner=user)


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def api_for():
    """Build an authenticated API client for any user."""

    def _make(target):
        client = APIClient()
        client.force_authenticate(user=target)
        return client

    return _make


@pytest.fixture
def auth_client(api_for, user):
    return api_for(user)


@pytest.fixture
def member(db, organisation, other_user):
    """A viewer in the owner's organisation."""
    return Membership.objects.create(organisation=organisation, user=other_user, role=Role.VIEWER)

import pytest
from django.urls import reverse


@pytest.mark.django_db
def test_health_reports_database_and_broker(client):
    response = client.get(reverse("health"))
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["checks"] == {"database": "ok", "broker": "ok"}


def test_health_is_public(client):
    """The readiness probe must not require credentials."""
    response = client.get(reverse("health"))
    assert response.status_code in (200, 503)
    assert "error" not in response.json()

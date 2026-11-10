import pytest
from django.contrib.auth import get_user_model


@pytest.mark.django_db
def test_create_user_uses_email_as_identifier():
    user = get_user_model().objects.create_user(email="Analyst@Example.com", password="s3cret-pass")
    assert user.email == "analyst@example.com"
    assert user.username is None or not hasattr(user, "username")
    assert user.check_password("s3cret-pass")
    assert user.is_staff is False


@pytest.mark.django_db
def test_email_is_required():
    with pytest.raises(ValueError):
        get_user_model().objects.create_user(email="", password="x")


@pytest.mark.django_db
def test_create_superuser_sets_flags():
    admin = get_user_model().objects.create_superuser(email="admin@example.com", password="x")
    assert admin.is_staff and admin.is_superuser

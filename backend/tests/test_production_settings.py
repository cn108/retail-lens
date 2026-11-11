"""Production settings must refuse the secret key published in this repository."""

import os
import subprocess
import sys
from pathlib import Path

import pytest
from django.core.exceptions import ImproperlyConfigured

from config.settings.base import INSECURE_SECRET_KEY, require_distinct_secret_key

BACKEND_DIR = Path(__file__).resolve().parents[1]


def test_development_key_is_refused():
    with pytest.raises(ImproperlyConfigured, match="DJANGO_SECRET_KEY"):
        require_distinct_secret_key(INSECURE_SECRET_KEY)


def test_a_real_key_is_accepted():
    require_distinct_secret_key("b8f1c0d6a2e94f3c8a5d7b1e0c9f4a2d")


def _boot(secret_key: str | None) -> subprocess.CompletedProcess:
    """Start Django with production settings, as a deploy would."""
    environment = {key: value for key, value in os.environ.items() if key != "DJANGO_SECRET_KEY"}
    environment["DJANGO_SETTINGS_MODULE"] = "config.settings.prod"
    if secret_key is not None:
        environment["DJANGO_SECRET_KEY"] = secret_key
    return subprocess.run(
        [sys.executable, "manage.py", "check"],
        cwd=BACKEND_DIR,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )


def test_production_refuses_to_start_without_a_secret_key():
    result = _boot(None)
    assert result.returncode != 0
    assert "DJANGO_SECRET_KEY" in result.stderr


def test_production_starts_with_its_own_secret_key():
    result = _boot("b8f1c0d6a2e94f3c8a5d7b1e0c9f4a2d")
    assert result.returncode == 0, result.stderr

"""Local development settings: verbose errors, permissive hosts, no HTTPS."""

from .base import *  # noqa: F403
from .base import env, env_bool, env_list

DEBUG = env_bool("DJANGO_DEBUG", True)
ALLOWED_HOSTS = ["*"]
CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOWED_ORIGINS = env_list(
    "CORS_ALLOWED_ORIGINS", "http://localhost:4200,http://127.0.0.1:4200"
)
EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
LOG_LEVEL = env("LOG_LEVEL", "DEBUG")

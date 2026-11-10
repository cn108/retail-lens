"""Base settings shared by every environment.

Configuration is read from environment variables only; nothing secret is
committed. See .env.example at the repository root for the full list.
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent


def env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name)
    return value if value not in (None, "") else default


def env_bool(name: str, default: bool = False) -> bool:
    return str(env(name, str(default))).strip().lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in str(env(name, default)).split(",") if item.strip()]


SECRET_KEY = env("DJANGO_SECRET_KEY", "insecure-development-key-change-me")
DEBUG = env_bool("DJANGO_DEBUG", False)
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "drf_spectacular",
    # Domain applications. Each owns one bounded responsibility (see
    # docs/SYSTEM_DESIGN.md); no application imports another's models
    # directly except through documented service functions.
    "apps.accounts",
    "apps.organisations",
    "apps.datasets",
    "apps.ingestion",
    "apps.analytics",
    "apps.customers",
    "apps.forecasting",
    "apps.reporting",
    "apps.monitoring",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env("POSTGRES_DB", "retaillens"),
        "USER": env("POSTGRES_USER", "retaillens"),
        "PASSWORD": env("POSTGRES_PASSWORD", "retaillens"),
        "HOST": env("POSTGRES_HOST", "localhost"),
        "PORT": env("POSTGRES_PORT", "5432"),
        "CONN_MAX_AGE": int(env("POSTGRES_CONN_MAX_AGE", "60")),
    }
}

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-gb"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Uploaded source files live outside static assets and are never served
# directly: the API is the only way to reach a dataset.
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

REST_FRAMEWORK = {
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_AUTHENTICATION_CLASSES": ["config.authentication.SessionAuthentication401"],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
    "EXCEPTION_HANDLER": "config.errors.api_exception_handler",
}

SPECTACULAR_SETTINGS = {
    "TITLE": "RetailLens API",
    "DESCRIPTION": "Retail business intelligence and analytics API.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

# CORS is only needed when the Angular dev server calls the API without its
# development proxy; in production the frontend is served from the same origin.
CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", "http://localhost:4200")
CORS_ALLOW_CREDENTIALS = True

# Session authentication is the browser's credential. The Angular dev server
# proxies /api to Django, so these origins only matter if the proxy is bypassed.
CSRF_TRUSTED_ORIGINS = env_list(
    "CSRF_TRUSTED_ORIGINS", "http://localhost:4200,http://127.0.0.1:4200"
)
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = env("SESSION_COOKIE_SAMESITE", "Lax")
SESSION_COOKIE_AGE = int(env("SESSION_COOKIE_AGE", str(60 * 60 * 24 * 14)))

CELERY_BROKER_URL = env("CELERY_BROKER_URL", "redis://localhost:6379/0")
CELERY_RESULT_BACKEND = env("CELERY_RESULT_BACKEND", "redis://localhost:6379/1")
CELERY_TASK_TRACK_STARTED = True
CELERY_TASK_TIME_LIMIT = int(env("CELERY_TASK_TIME_LIMIT", "3600"))
CELERY_TASK_SOFT_TIME_LIMIT = int(env("CELERY_TASK_SOFT_TIME_LIMIT", "3300"))
CELERY_TASK_ACKS_LATE = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 1

# Periodic work: threshold alerts are swept hourly and due report schedules are
# dispatched every fifteen minutes. Both tasks are idempotent, so overlapping
# runs cannot create duplicate output.
CELERY_BEAT_SCHEDULE = {
    "check-alerts": {
        "task": "monitoring.check_alerts",
        "schedule": 60 * 60,
    },
    "dispatch-report-schedules": {
        "task": "monitoring.dispatch_schedules",
        "schedule": 15 * 60,
    },
}

# Scheduled report delivery. The console backend keeps local development free of
# credentials; set EMAIL_BACKEND and the SMTP values to deliver real mail.
EMAIL_BACKEND = env("EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = env("EMAIL_HOST", "localhost")
EMAIL_PORT = int(env("EMAIL_PORT", "587"))
EMAIL_HOST_USER = env("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", True)
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", "RetailLens <reports@retaillens.local>")

# Upload limits are enforced in the dataset service as well; this is the hard
# ceiling the web process will accept.
MAX_UPLOAD_BYTES = int(env("MAX_UPLOAD_BYTES", str(50 * 1024 * 1024)))
DATA_UPLOAD_MAX_MEMORY_SIZE = MAX_UPLOAD_BYTES
FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "standard": {
            "format": "%(asctime)s %(levelname)s %(name)s %(message)s",
        }
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "standard"},
    },
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", "INFO")},
}

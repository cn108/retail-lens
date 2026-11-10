"""Liveness/readiness endpoint used by Docker, CI and the load balancer.

Reports the real state of the dependencies this service needs, so a green
check means the API can actually serve requests, not merely that the process
is alive.
"""

import logging

import redis
from django.conf import settings
from django.db import connection
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

logger = logging.getLogger(__name__)


def _check_database() -> str:
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        return "ok"
    except Exception:  # noqa: BLE001 - the reason is logged, never returned
        logger.exception("Health check: database unreachable")
        return "error"


def _check_broker() -> str:
    try:
        client = redis.Redis.from_url(settings.CELERY_BROKER_URL, socket_connect_timeout=2)
        client.ping()
        return "ok"
    except Exception:  # noqa: BLE001
        logger.exception("Health check: broker unreachable")
        return "error"


@extend_schema(responses={200: None, 503: None}, auth=[])
@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def health(request):  # type: ignore[no-untyped-def]
    checks = {"database": _check_database(), "broker": _check_broker()}
    healthy = all(value == "ok" for value in checks.values())
    return Response(
        {"status": "ok" if healthy else "degraded", "checks": checks},
        status=status.HTTP_200_OK if healthy else status.HTTP_503_SERVICE_UNAVAILABLE,
    )

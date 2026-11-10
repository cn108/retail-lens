"""Consistent API error envelope for every DRF exception."""

import logging

from rest_framework.views import exception_handler

logger = logging.getLogger(__name__)


def _field_errors(detail):  # type: ignore[no-untyped-def]
    """Give every field a list of messages, matching serializer errors."""
    if isinstance(detail, dict):
        return {key: _field_errors(value) for key, value in detail.items()}
    if isinstance(detail, list):
        return [str(item) for item in detail]
    return [str(detail)]


def api_exception_handler(exc, context):  # type: ignore[no-untyped-def]
    response = exception_handler(exc, context)
    if response is None:
        logger.exception("Unhandled API exception")
        return None
    detail = response.data
    message = detail.get("detail") if isinstance(detail, dict) else None
    response.data = {
        "error": {
            "status": response.status_code,
            "message": str(message) if message else "Request could not be completed.",
            "fields": _field_errors(detail) if isinstance(detail, dict) and not message else None,
        }
    }
    return response

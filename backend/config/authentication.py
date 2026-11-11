"""Session authentication that distinguishes "signed out" from "not allowed".

DRF only answers 401 when an authenticator advertises a challenge. Without
one, a browser receives 403 both for an expired session and for a genuine
permission failure, which the Angular client cannot tell apart. Advertising
the session challenge keeps the two cases separate.
"""

from django.conf import settings
from drf_spectacular.extensions import OpenApiAuthenticationExtension
from rest_framework.authentication import SessionAuthentication


class SessionAuthentication401(SessionAuthentication):
    def authenticate_header(self, request):  # type: ignore[no-untyped-def]
        return "Session"


class SessionAuthentication401Scheme(OpenApiAuthenticationExtension):
    """Document the session cookie, which drf-spectacular cannot infer itself.

    Without this the schema generator reports an unresolved authenticator for
    every view and omits the security scheme the browser actually uses.
    """

    target_class = "config.authentication.SessionAuthentication401"
    name = "sessionCookie"

    def get_security_definition(self, auto_schema):  # type: ignore[no-untyped-def]
        return {
            "type": "apiKey",
            "in": "cookie",
            "name": settings.SESSION_COOKIE_NAME,
            "description": (
                "Session cookie set by /api/v1/auth/login. Unsafe methods also "
                "require the CSRF token from /api/v1/auth/csrf."
            ),
        }

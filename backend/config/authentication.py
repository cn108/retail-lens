"""Session authentication that distinguishes "signed out" from "not allowed".

DRF only answers 401 when an authenticator advertises a challenge. Without
one, a browser receives 403 both for an expired session and for a genuine
permission failure, which the Angular client cannot tell apart. Advertising
the session challenge keeps the two cases separate.
"""

from rest_framework.authentication import SessionAuthentication


class SessionAuthentication401(SessionAuthentication):
    def authenticate_header(self, request):  # type: ignore[no-untyped-def]
        return "Session"

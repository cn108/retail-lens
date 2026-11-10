from django.contrib.auth import (
    login as django_login,
)
from django.contrib.auth import (
    logout as django_logout,
)
from django.contrib.auth import (
    update_session_auth_hash,
)
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import (
    LoginSerializer,
    MeSerializer,
    PasswordChangeSerializer,
    PreferencesSerializer,
    ProfileSerializer,
    RegisterSerializer,
)
from .services import set_default_organisation


@extend_schema(responses={200: None}, auth=[])
@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def csrf_token(request):  # type: ignore[no-untyped-def]
    """Issue the CSRF cookie the browser must echo on unsafe requests."""
    return Response({"csrfToken": get_token(request)})


@method_decorator(csrf_protect, name="dispatch")
class RegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):  # type: ignore[no-untyped-def]
        serializer = RegisterSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        django_login(request, user)
        return Response(MeSerializer(user).data, status=status.HTTP_201_CREATED)


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):  # type: ignore[no-untyped-def]
        serializer = LoginSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        django_login(request, user)
        return Response(MeSerializer(user).data)


class LogoutView(APIView):
    def post(self, request):  # type: ignore[no-untyped-def]
        django_logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    def get(self, request):  # type: ignore[no-untyped-def]
        return Response(MeSerializer(request.user).data)

    def patch(self, request):  # type: ignore[no-untyped-def]
        serializer = ProfileSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(MeSerializer(request.user).data)


class PasswordChangeView(APIView):
    def post(self, request):  # type: ignore[no-untyped-def]
        serializer = PasswordChangeSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        request.user.set_password(serializer.validated_data["new_password"])
        request.user.save(update_fields=["password"])
        update_session_auth_hash(request, request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class PreferencesView(APIView):
    def patch(self, request):  # type: ignore[no-untyped-def]
        serializer = PreferencesSerializer(
            data=request.data, partial=True, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        if "default_organisation" in serializer.validated_data:
            set_default_organisation(
                request.user, serializer.validated_data["default_organisation"]
            )
        return Response(MeSerializer(request.user).data)

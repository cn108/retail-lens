from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed

from apps.organisations.serializers import MembershipSummarySerializer
from apps.organisations.services import (
    create_organisation,
    membership_for,
    memberships_for,
)

from .models import User
from .services import default_organisation_id, preferences_for, set_default_organisation


class MeSerializer(serializers.ModelSerializer):
    """The signed-in user's profile, memberships and preferences."""

    preferences = serializers.SerializerMethodField()
    organisations = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "email", "display_name", "date_joined", "preferences", "organisations"]

    def get_preferences(self, obj: User) -> dict:
        return {"default_organisation": default_organisation_id(obj)}

    def get_organisations(self, obj: User) -> list[dict]:
        return MembershipSummarySerializer(memberships_for(obj), many=True).data


class CsrfTokenSerializer(serializers.Serializer):
    """The token the browser must echo in the X-CSRFToken header."""

    csrfToken = serializers.CharField()


class ProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["display_name"]

    def validate_display_name(self, value: str) -> str:
        return value.strip()


def _default_organisation_name(display_name: str, email: str) -> str:
    label = display_name.strip() or email.split("@", 1)[0]
    return f"{label}'s workspace"


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    display_name = serializers.CharField(required=False, allow_blank=True, max_length=150)
    organisation_name = serializers.CharField(required=False, allow_blank=True, max_length=200)

    def validate_email(self, value: str) -> str:
        email = value.strip().lower()
        if get_user_model().objects.filter(email=email).exists():
            raise serializers.ValidationError("That email address is already registered.")
        return email

    def validate_password(self, value: str) -> str:
        validate_password(value)
        return value

    def create(self, validated_data: dict) -> User:
        display_name = validated_data.get("display_name", "").strip()
        organisation_name = validated_data.get(
            "organisation_name", ""
        ).strip() or _default_organisation_name(display_name, validated_data["email"])
        with transaction.atomic():
            user = User.objects.create_user(
                email=validated_data["email"],
                password=validated_data["password"],
                display_name=display_name,
            )
            organisation = create_organisation(name=organisation_name, owner=user)
            preferences_for(user)
            set_default_organisation(user, organisation)
        return user


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, attrs: dict) -> dict:
        user = authenticate(
            request=self.context.get("request"),
            username=attrs["email"].strip().lower(),
            password=attrs["password"],
        )
        if user is None or not user.is_active:
            raise AuthenticationFailed("Email or password is incorrect.")
        attrs["user"] = user
        return attrs


class PasswordChangeSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True, trim_whitespace=False)
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_current_password(self, value: str) -> str:
        user = self.context["request"].user
        if not user.check_password(value):
            raise serializers.ValidationError("The current password is incorrect.")
        return value

    def validate_new_password(self, value: str) -> str:
        user = self.context["request"].user
        validate_password(value, user)
        return value


class PreferencesSerializer(serializers.Serializer):
    default_organisation = serializers.UUIDField(allow_null=True, required=False)

    def validate_default_organisation(self, value):
        if value is None:
            return None
        membership = membership_for(self.context["request"].user, value)
        if membership is None:
            raise serializers.ValidationError("You are not a member of that organisation.")
        return membership.organisation_id

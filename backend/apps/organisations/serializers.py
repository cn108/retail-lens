import re
from zoneinfo import available_timezones

from rest_framework import serializers

from .models import Membership, Organisation, Role

CURRENCY_PATTERN = re.compile(r"^[A-Z]{3}$")


class MembershipSummarySerializer(serializers.ModelSerializer):
    """A flat view of one organisation from the caller's perspective."""

    id = serializers.UUIDField(source="organisation.id", read_only=True)
    name = serializers.CharField(source="organisation.name", read_only=True)
    slug = serializers.CharField(source="organisation.slug", read_only=True)
    currency = serializers.CharField(source="organisation.currency", read_only=True)

    class Meta:
        model = Membership
        fields = ["id", "name", "slug", "currency", "role"]


class OrganisationSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()
    member_count = serializers.SerializerMethodField()

    class Meta:
        model = Organisation
        fields = [
            "id",
            "name",
            "slug",
            "currency",
            "timezone",
            "retention_days",
            "role",
            "member_count",
            "created_at",
        ]

    def get_role(self, obj: Organisation) -> str | None:
        membership = self.context.get("membership")
        return membership.role if membership else None

    def get_member_count(self, obj: Organisation) -> int:
        return obj.memberships.count()


class OrganisationSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = Organisation
        fields = ["name", "currency", "timezone", "retention_days"]

    def validate_name(self, value: str) -> str:
        name = value.strip()
        if not name:
            raise serializers.ValidationError("An organisation needs a name.")
        return name

    def validate_currency(self, value: str) -> str:
        code = value.strip().upper()
        if not CURRENCY_PATTERN.match(code):
            raise serializers.ValidationError("Use a three-letter ISO 4217 code.")
        return code

    def validate_timezone(self, value: str) -> str:
        if value not in available_timezones():
            raise serializers.ValidationError("Use a valid IANA time zone name.")
        return value

    def validate_retention_days(self, value: int | None) -> int | None:
        if value is not None and value < 1:
            raise serializers.ValidationError("Retention must be at least one day.")
        return value


class MemberSerializer(serializers.ModelSerializer):
    user_id = serializers.UUIDField(source="user.id", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    display_name = serializers.CharField(source="user.display_name", read_only=True)

    class Meta:
        model = Membership
        fields = ["id", "user_id", "email", "display_name", "role", "created_at"]


class AddMemberSerializer(serializers.Serializer):
    email = serializers.EmailField()
    role = serializers.ChoiceField(choices=Role.choices, default=Role.VIEWER)


class RoleSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=Role.choices)

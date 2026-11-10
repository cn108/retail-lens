from rest_framework import serializers


class ForecastRunCreateSerializer(serializers.Serializer):
    dataset = serializers.UUIDField(required=False, allow_null=True, default=None)
    horizon = serializers.IntegerField(min_value=1, max_value=12, default=3)

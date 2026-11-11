import uuid

from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.organisations.models import Membership, Role
from apps.organisations.services import active_membership_for, require_role
from config.schema import DATASET, ORGANISATION_HEADER, limit_parameter

from .models import ForecastAnomaly, ForecastRun
from .serializers import (
    AnomalyTriageResultSerializer,
    AnomalyTriageSerializer,
    ForecastRunCreateSerializer,
    ForecastRunDetailSerializer,
    ForecastRunSerializer,
)
from .services import dataset_for, run_payload, runs_payload, start_forecast


def _membership(request) -> Membership:  # type: ignore[no-untyped-def]
    membership = active_membership_for(request.user, request.headers.get("X-Organisation-Id"))
    if membership is None:
        raise NotFound("You do not belong to any organisation.")
    return membership


def _dataset_param(request):  # type: ignore[no-untyped-def]
    raw = request.query_params.get("dataset")
    if not raw:
        return None
    try:
        value = uuid.UUID(raw)
    except ValueError as error:
        raise ValidationError({"dataset": "Use a dataset UUID."}) from error
    return dataset_for(_membership(request).organisation, value)


@extend_schema_view(
    get=extend_schema(
        operation_id="v1_forecasting_runs_list",
        parameters=[ORGANISATION_HEADER, DATASET, limit_parameter(20, 100, "runs")],
        responses=ForecastRunSerializer(many=True),
    ),
    post=extend_schema(
        request=ForecastRunCreateSerializer,
        responses={202: ForecastRunSerializer},
    ),
)
class ForecastRunListCreateView(APIView):
    def get(self, request):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        dataset = _dataset_param(request)
        try:
            limit = min(max(int(request.query_params.get("limit", "20")), 1), 100)
        except ValueError:
            limit = 20
        return Response(runs_payload(membership.organisation, dataset=dataset, limit=limit))

    def post(self, request):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        require_role(membership, Role.ANALYST)
        serializer = ForecastRunCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        dataset = dataset_for(membership.organisation, serializer.validated_data["dataset"])
        run = start_forecast(
            organisation=membership.organisation,
            dataset_id=dataset.id if dataset else None,
            horizon=serializer.validated_data["horizon"],
            user=request.user,
        )
        # Eager test configuration completes the run before returning.
        run.refresh_from_db()
        return Response(run_payload(run), status=status.HTTP_202_ACCEPTED)


@extend_schema(parameters=[ORGANISATION_HEADER], responses=ForecastRunDetailSerializer)
class ForecastRunDetailView(APIView):
    def get(self, request, run_id):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        run = get_object_or_404(
            ForecastRun.objects.select_related("dataset"),
            id=run_id,
            organisation=membership.organisation,
        )
        return Response(run_payload(run, detail=True))


@extend_schema(
    request=AnomalyTriageSerializer,
    responses=AnomalyTriageResultSerializer,
)
class ForecastAnomalyTriageView(APIView):
    """Annotate or acknowledge one observed anomaly on a run."""

    def patch(self, request, run_id, anomaly_id):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        require_role(membership, Role.ANALYST)
        anomaly = ForecastAnomaly.objects.filter(
            id=anomaly_id, run_id=run_id, run__organisation=membership.organisation
        ).first()
        if anomaly is None:
            raise NotFound("Anomaly not found.")

        payload = request.data or {}
        if "note" in payload:
            anomaly.note = str(payload.get("note") or "")[:255]
        if payload.get("acknowledged") is True:
            anomaly.acknowledged_at = timezone.now()
        elif payload.get("acknowledged") is False:
            anomaly.acknowledged_at = None
        anomaly.save(update_fields=["note", "acknowledged_at"])
        return Response(
            {
                "id": str(anomaly.id),
                "note": anomaly.note,
                "acknowledged_at": (
                    anomaly.acknowledged_at.isoformat() if anomaly.acknowledged_at else None
                ),
            }
        )

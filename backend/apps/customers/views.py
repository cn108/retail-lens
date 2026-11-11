import uuid
from datetime import date

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.organisations.models import Membership
from apps.organisations.services import active_membership_for
from config.schema import (
    DATE_FROM,
    DATE_TO,
    OFFSET,
    ORGANISATION_HEADER,
    SCOPE_PARAMETERS,
    SEARCH,
    limit_parameter,
)

from .extended import customer_detail, segment_members, validate_rules
from .models import CustomerSegment
from .serializers import (
    CustomerDetailSerializer,
    CustomerRetentionSerializer,
    CustomerRfmSerializer,
    CustomerSummarySerializer,
    SegmentListSerializer,
    SegmentMembersSerializer,
    SegmentSerializer,
    SegmentUpdateSerializer,
    SegmentWriteSerializer,
)
from .services import customer_retention, customer_rfm, customer_summary

WRITE_ROLES = {"owner", "admin", "analyst"}

SORT = OpenApiParameter(
    "sort",
    OpenApiTypes.STR,
    OpenApiParameter.QUERY,
    required=False,
    enum=["net", "orders", "recency", "last", "customer"],
    description="Order of the scored customers. Defaults to net.",
)
SEGMENT_FILTER = OpenApiParameter(
    "segment",
    OpenApiTypes.STR,
    OpenApiParameter.QUERY,
    required=False,
    description="Restrict the result to one RFM segment key.",
)


def _membership(request) -> Membership:  # type: ignore[no-untyped-def]
    membership = active_membership_for(request.user, request.headers.get("X-Organisation-Id"))
    if membership is None:
        raise NotFound("You do not belong to any organisation.")
    return membership


def _date_param(request, name: str) -> date | None:  # type: ignore[no-untyped-def]
    raw = request.query_params.get(name)
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError as error:
        raise ValidationError({name: "Use an ISO date (YYYY-MM-DD)."}) from error


def _dataset_param(request) -> uuid.UUID | None:  # type: ignore[no-untyped-def]
    raw = request.query_params.get("dataset")
    if not raw:
        return None
    try:
        return uuid.UUID(raw)
    except ValueError as error:
        raise ValidationError({"dataset": "Use a dataset UUID."}) from error


def _int_param(request, name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        return min(max(int(request.query_params.get(name, str(default))), minimum), maximum)
    except (TypeError, ValueError):
        return default


def _scope(request) -> dict:
    return {
        "dataset_id": _dataset_param(request),
        "date_from": _date_param(request, "date_from"),
        "date_to": _date_param(request, "date_to"),
    }


def _require_writer(membership: Membership) -> None:
    if membership.role not in WRITE_ROLES:
        raise PermissionDenied("Your role can read segments but not change them.")


def _serialize(segment: CustomerSegment) -> dict:
    return {
        "id": str(segment.id),
        "name": segment.name,
        "description": segment.description,
        "dataset": str(segment.dataset_id) if segment.dataset_id else None,
        "rules": segment.rules or {},
        "created_at": segment.created_at.isoformat(),
        "updated_at": segment.updated_at.isoformat(),
    }


@extend_schema(parameters=SCOPE_PARAMETERS, responses=CustomerSummarySerializer)
class CustomerSummaryView(APIView):
    def get(self, request):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        return Response(customer_summary(organisation=membership.organisation, **_scope(request)))


@extend_schema(
    parameters=[
        *SCOPE_PARAMETERS,
        SEARCH,
        SEGMENT_FILTER,
        SORT,
        limit_parameter(50, 500, "customers"),
        OFFSET,
    ],
    responses=CustomerRfmSerializer,
)
class CustomerRfmView(APIView):
    def get(self, request):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        sort = request.query_params.get("sort", "net")
        if sort not in {"net", "orders", "recency", "last", "customer"}:
            raise ValidationError({"sort": "Use net, orders, recency, last or customer."})
        return Response(
            customer_rfm(
                organisation=membership.organisation,
                limit=_int_param(request, "limit", 50, 1, 500),
                offset=_int_param(request, "offset", 0, 0, 1_000_000),
                search=(request.query_params.get("search") or "").strip()[:200] or None,
                segment=(request.query_params.get("segment") or "").strip() or None,
                sort=sort,
                **_scope(request),
            )
        )


@extend_schema(parameters=SCOPE_PARAMETERS, responses=CustomerRetentionSerializer)
class CustomerRetentionView(APIView):
    def get(self, request):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        return Response(customer_retention(organisation=membership.organisation, **_scope(request)))


@extend_schema(
    parameters=[ORGANISATION_HEADER, DATE_FROM, DATE_TO],
    responses=CustomerDetailSerializer,
)
class CustomerDetailView(APIView):
    def get(self, request, customer_id: int):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        return Response(
            customer_detail(
                organisation=membership.organisation,
                customer_id=customer_id,
                date_from=_date_param(request, "date_from"),
                date_to=_date_param(request, "date_to"),
            )
        )


@extend_schema_view(
    get=extend_schema(
        operation_id="v1_customers_segments_list",
        parameters=[ORGANISATION_HEADER],
        responses=SegmentListSerializer,
    ),
    post=extend_schema(request=SegmentWriteSerializer, responses={201: SegmentSerializer}),
)
class SegmentListCreateView(APIView):
    def get(self, request):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        segments = CustomerSegment.objects.filter(organisation=membership.organisation)
        return Response({"segments": [_serialize(segment) for segment in segments]})

    def post(self, request):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        _require_writer(membership)
        payload = request.data or {}
        name = str(payload.get("name") or "").strip()
        if not name:
            raise ValidationError({"name": "Give the segment a name."})
        if CustomerSegment.objects.filter(
            organisation=membership.organisation, name__iexact=name
        ).exists():
            raise ValidationError({"name": "A segment with that name already exists."})

        dataset_id = payload.get("dataset") or None
        dataset = None
        if dataset_id:
            from apps.datasets.models import Dataset

            dataset = Dataset.objects.filter(
                id=dataset_id, organisation=membership.organisation
            ).first()
            if dataset is None:
                raise ValidationError({"dataset": "Dataset not found."})

        segment = CustomerSegment.objects.create(
            organisation=membership.organisation,
            name=name[:120],
            description=str(payload.get("description") or "")[:255],
            dataset=dataset,
            rules=validate_rules(payload.get("rules") or {}),
            created_by=request.user,
        )
        return Response(_serialize(segment), status=201)


@extend_schema_view(
    get=extend_schema(responses=SegmentSerializer),
    patch=extend_schema(request=SegmentUpdateSerializer, responses=SegmentSerializer),
    delete=extend_schema(responses={204: None}),
)
class SegmentDetailView(APIView):
    def _segment(self, request, segment_id: uuid.UUID) -> CustomerSegment:  # type: ignore[no-untyped-def]
        membership = _membership(request)
        segment = CustomerSegment.objects.filter(
            id=segment_id, organisation=membership.organisation
        ).first()
        if segment is None:
            raise NotFound("Segment not found.")
        return segment

    def get(self, request, segment_id: uuid.UUID):  # type: ignore[no-untyped-def]
        segment = self._segment(request, segment_id)
        return Response(_serialize(segment))

    def patch(self, request, segment_id: uuid.UUID):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        _require_writer(membership)
        segment = self._segment(request, segment_id)
        payload = request.data or {}
        if "name" in payload:
            name = str(payload.get("name") or "").strip()
            if not name:
                raise ValidationError({"name": "Give the segment a name."})
            if (
                CustomerSegment.objects.filter(
                    organisation=membership.organisation, name__iexact=name
                )
                .exclude(id=segment.id)
                .exists()
            ):
                raise ValidationError({"name": "A segment with that name already exists."})
            segment.name = name[:120]
        if "description" in payload:
            segment.description = str(payload.get("description") or "")[:255]
        if "rules" in payload:
            segment.rules = validate_rules(payload.get("rules") or {})
        segment.save()
        return Response(_serialize(segment))

    def delete(self, request, segment_id: uuid.UUID):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        _require_writer(membership)
        segment = self._segment(request, segment_id)
        segment.delete()
        return Response(status=204)


@extend_schema(
    parameters=[
        ORGANISATION_HEADER,
        DATE_FROM,
        DATE_TO,
        limit_parameter(50, 500, "customers"),
    ],
    responses=SegmentMembersSerializer,
)
class SegmentMembersView(APIView):
    def get(self, request, segment_id: uuid.UUID):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        segment = CustomerSegment.objects.filter(
            id=segment_id, organisation=membership.organisation
        ).first()
        if segment is None:
            raise NotFound("Segment not found.")
        return Response(
            segment_members(
                organisation=membership.organisation,
                segment=segment,
                date_from=_date_param(request, "date_from"),
                date_to=_date_param(request, "date_to"),
                limit=_int_param(request, "limit", 50, 1, 500),
            )
        )

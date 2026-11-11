import uuid
from datetime import date

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.organisations.models import Membership
from apps.organisations.services import active_membership_for
from config.schema import (
    GRANULARITY,
    PERIOD_PARAMETERS,
    SCOPE_PARAMETERS,
    SEARCH,
    limit_parameter,
)

from .extended import (
    basket_analysis,
    geography_performance,
    product_detail,
    returns_analysis,
)
from .serializers import (
    BasketAnalysisSerializer,
    GeographySummarySerializer,
    ProductDetailSerializer,
    ProductSummarySerializer,
    ReturnsAnalysisSerializer,
    SalesSummarySerializer,
    SalesTrendSerializer,
)
from .services import product_performance, sales_summary, sales_trend

MIN_INVOICES = OpenApiParameter(
    "min_invoices",
    OpenApiTypes.INT,
    OpenApiParameter.QUERY,
    required=False,
    description=(
        "Ignore product pairs that appear on fewer than this many invoices. Defaults to 1."
    ),
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


def _comparison(request) -> dict:
    """Shared comparison query parameters for every period-aware endpoint."""
    return {
        "compare": request.query_params.get("compare") or "previous",
        "compare_from": _date_param(request, "compare_from"),
        "compare_to": _date_param(request, "compare_to"),
    }


def _scope(request) -> dict:
    return {
        "dataset_id": _dataset_param(request),
        "date_from": _date_param(request, "date_from"),
        "date_to": _date_param(request, "date_to"),
    }


@extend_schema(parameters=PERIOD_PARAMETERS, responses=SalesSummarySerializer)
class SalesSummaryView(APIView):
    def get(self, request):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        return Response(
            sales_summary(
                organisation=membership.organisation, **_scope(request), **_comparison(request)
            )
        )


@extend_schema(
    parameters=[*PERIOD_PARAMETERS, GRANULARITY],
    responses=SalesTrendSerializer,
)
class SalesTrendView(APIView):
    def get(self, request):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        return Response(
            sales_trend(
                organisation=membership.organisation,
                granularity=request.query_params.get("granularity", "month"),
                **_scope(request),
                **_comparison(request),
            )
        )


@extend_schema(
    parameters=[*PERIOD_PARAMETERS, SEARCH, limit_parameter(50, 500, "products")],
    responses=ProductSummarySerializer,
)
class ProductPerformanceView(APIView):
    def get(self, request):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        return Response(
            product_performance(
                organisation=membership.organisation,
                limit=_int_param(request, "limit", 50, 1, 500),
                search=(request.query_params.get("search") or "").strip()[:200] or None,
                **_scope(request),
                **_comparison(request),
            )
        )


@extend_schema(parameters=PERIOD_PARAMETERS, responses=ProductDetailSerializer)
class ProductDetailView(APIView):
    def get(self, request, product_id: int):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        return Response(
            product_detail(
                organisation=membership.organisation,
                product_id=product_id,
                date_from=_date_param(request, "date_from"),
                date_to=_date_param(request, "date_to"),
                **_comparison(request),
            )
        )


@extend_schema(
    parameters=[*PERIOD_PARAMETERS, limit_parameter(100, 250, "countries")],
    responses=GeographySummarySerializer,
)
class GeographyPerformanceView(APIView):
    def get(self, request):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        return Response(
            geography_performance(
                organisation=membership.organisation,
                limit=_int_param(request, "limit", 100, 1, 250),
                **_scope(request),
                **_comparison(request),
            )
        )


@extend_schema(
    parameters=[*SCOPE_PARAMETERS, limit_parameter(25, 200, "products or countries")],
    responses=ReturnsAnalysisSerializer,
)
class ReturnsAnalysisView(APIView):
    def get(self, request):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        return Response(
            returns_analysis(
                organisation=membership.organisation,
                limit=_int_param(request, "limit", 25, 1, 200),
                **_scope(request),
            )
        )


@extend_schema(
    parameters=[
        *SCOPE_PARAMETERS,
        limit_parameter(25, 200, "pairs"),
        MIN_INVOICES,
    ],
    responses=BasketAnalysisSerializer,
)
class BasketAnalysisView(APIView):
    def get(self, request):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        return Response(
            basket_analysis(
                organisation=membership.organisation,
                limit=_int_param(request, "limit", 25, 1, 200),
                min_invoices=_int_param(request, "min_invoices", 1, 1, 1000),
                **_scope(request),
            )
        )

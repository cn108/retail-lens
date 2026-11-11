"""Shared OpenAPI declarations for the API's query-driven endpoints.

Analytics, customer, dataset and monitoring endpoints all scope their results the
same way: the acting organisation arrives in a header, an optional dataset and
inclusive date range narrow the facts, and period-over-period measures take a
comparison window. Declaring those parameters once keeps the generated schema
consistent instead of repeating the same twenty definitions per module.

The field helpers exist because the services emit money and rates as decimal
strings, not numbers; describing them as strings with a decimal format is what
the API actually returns.
"""

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter
from rest_framework import serializers

ORGANISATION_HEADER = OpenApiParameter(
    "X-Organisation-Id",
    OpenApiTypes.UUID,
    OpenApiParameter.HEADER,
    required=False,
    description="Organisation to act in. Defaults to the caller's default membership.",
)
DATASET = OpenApiParameter(
    "dataset",
    OpenApiTypes.UUID,
    OpenApiParameter.QUERY,
    required=False,
    description="Restrict the result to one dataset.",
)
DATE_FROM = OpenApiParameter(
    "date_from",
    OpenApiTypes.DATE,
    OpenApiParameter.QUERY,
    required=False,
    description="Inclusive first day of the reporting period (YYYY-MM-DD).",
)
DATE_TO = OpenApiParameter(
    "date_to",
    OpenApiTypes.DATE,
    OpenApiParameter.QUERY,
    required=False,
    description="Inclusive last day of the reporting period (YYYY-MM-DD).",
)
COMPARE = OpenApiParameter(
    "compare",
    OpenApiTypes.STR,
    OpenApiParameter.QUERY,
    required=False,
    enum=["previous", "year", "custom"],
    description=(
        "Baseline window for period-over-period measures: the preceding window of "
        "equal length, the same dates one year earlier, or the custom dates below."
    ),
)
COMPARE_FROM = OpenApiParameter(
    "compare_from",
    OpenApiTypes.DATE,
    OpenApiParameter.QUERY,
    required=False,
    description="Inclusive start of the baseline window when compare is custom.",
)
COMPARE_TO = OpenApiParameter(
    "compare_to",
    OpenApiTypes.DATE,
    OpenApiParameter.QUERY,
    required=False,
    description="Inclusive end of the baseline window when compare is custom.",
)
GRANULARITY = OpenApiParameter(
    "granularity",
    OpenApiTypes.STR,
    OpenApiParameter.QUERY,
    required=False,
    enum=["day", "week", "month"],
    description="Bucket size of the returned series. Defaults to month.",
)


SEARCH = OpenApiParameter(
    "search",
    OpenApiTypes.STR,
    OpenApiParameter.QUERY,
    required=False,
    description="Case-insensitive filter on a product code or customer identifier.",
)
OFFSET = OpenApiParameter(
    "offset",
    OpenApiTypes.INT,
    OpenApiParameter.QUERY,
    required=False,
    description="Number of rows to skip. Defaults to 0.",
)


def limit_parameter(default: int, maximum: int, subject: str = "rows") -> OpenApiParameter:
    """A ``limit`` query parameter clamped to the view's documented range."""
    return OpenApiParameter(
        "limit",
        OpenApiTypes.INT,
        OpenApiParameter.QUERY,
        required=False,
        description=f"Maximum number of {subject} to return (1-{maximum}). Defaults to {default}.",
    )


SCOPE_PARAMETERS = [ORGANISATION_HEADER, DATASET, DATE_FROM, DATE_TO]
COMPARISON_PARAMETERS = [COMPARE, COMPARE_FROM, COMPARE_TO]
PERIOD_PARAMETERS = [*SCOPE_PARAMETERS, *COMPARISON_PARAMETERS]


def remove_empty_paths(result, generator, request, public):  # type: ignore[no-untyped-def]
    """Drop path entries that no longer hold any operation.

    The bare collection routes (``/api/v1/datasets`` and friends) exist only so
    a creation POST is not lost to ``APPEND_SLASH``; their views are excluded
    from the schema because the trailing-slash route documents the same
    operations. Exclusion leaves the path key behind with nothing in it, so the
    published document would carry an empty path object.
    """
    for path in [path for path, item in result.get("paths", {}).items() if not item]:
        del result["paths"][path]
    return result


def money_field(**kwargs) -> serializers.DecimalField:
    """A monetary amount, emitted as a decimal string."""
    return serializers.DecimalField(max_digits=18, decimal_places=2, **kwargs)


def rate_field(**kwargs) -> serializers.DecimalField:
    """A percentage, emitted as a decimal string that may be null."""
    return serializers.DecimalField(
        max_digits=9, decimal_places=2, **{"allow_null": True, **kwargs}
    )


def date_field(**kwargs) -> serializers.DateField:
    """An ISO date that may be null when the period is unresolved."""
    return serializers.DateField(**{"allow_null": True, **kwargs})

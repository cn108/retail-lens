"""Sales metrics computed from the M4 warehouse facts.

Every function takes an organisation and an optional dataset filter; no
request objects enter this module, so the API, notebooks and reports share one
definition. Money is returned as fixed-point strings (4 dp) and percentages as
2 dp strings.

Identity is dataset-scoped, matching the warehouse: customer and product ids
are unique within a dataset, and an invoice number is only unique within the
dataset that contains it. Aggregating several datasets therefore counts each
dataset's invoice/customer separately.
"""

from __future__ import annotations

import calendar
import uuid
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Count, Max, Min, QuerySet, Sum
from rest_framework.exceptions import NotFound, ValidationError

from apps.datasets.models import Dataset
from apps.ingestion.models import DimProduct, FactReturn, FactSales

MONEY = Decimal("0.0001")
PERCENT = Decimal("0.01")
ZERO = Decimal("0")
GRANULARITIES = {"day", "week", "month"}
COMPARISONS = {"previous", "year", "custom"}


@dataclass(frozen=True)
class Facts:
    sales: QuerySet
    returns: QuerySet


def facts_for(organisation, dataset_id: uuid.UUID | None) -> Facts:
    if (
        dataset_id is not None
        and not Dataset.objects.filter(id=dataset_id, organisation=organisation).exists()
    ):
        raise NotFound("Dataset not found.")

    sales = FactSales.objects.filter(dataset__organisation=organisation)
    returns = FactReturn.objects.filter(dataset__organisation=organisation)
    if dataset_id is not None:
        sales = sales.filter(dataset_id=dataset_id)
        returns = returns.filter(dataset_id=dataset_id)
    return Facts(sales=sales, returns=returns)


def money(value: Decimal | None) -> str:
    return str((value or ZERO).quantize(MONEY, rounding=ROUND_HALF_UP))


def percent(value: Decimal) -> str:
    return str(value.quantize(PERCENT, rounding=ROUND_HALF_UP))


def _data_bounds(facts: Facts) -> tuple[date | None, date | None]:
    sales = facts.sales.aggregate(first=Min("date_key__date"), last=Max("date_key__date"))
    returns = facts.returns.aggregate(first=Min("date_key__date"), last=Max("date_key__date"))
    firsts = [value for value in (sales["first"], returns["first"]) if value]
    lasts = [value for value in (sales["last"], returns["last"]) if value]
    if not firsts or not lasts:
        return None, None
    return min(firsts), max(lasts)


def resolve_period(
    facts: Facts, date_from: date | None, date_to: date | None
) -> tuple[date | None, date | None]:
    if date_from is None and date_to is None:
        return _data_bounds(facts)

    if date_from is None:
        date_from = _data_bounds(facts)[0] or date_to
    if date_to is None:
        date_to = _data_bounds(facts)[1] or date_from
    if date_from is None or date_to is None:
        return None, None
    if date_from > date_to:
        raise ValidationError({"date_from": "The start date must not be after the end date."})
    return date_from, date_to


def resolve_comparison(
    start: date,
    end: date,
    *,
    compare: str = "previous",
    compare_from: date | None = None,
    compare_to: date | None = None,
) -> tuple[str, date, date]:
    """Resolve the baseline window used for period-over-period measures.

        ``previous`` is the immediately preceding window of equal length (the
    default), ``year`` shifts the same calendar dates back one year, and
        ``custom`` uses the supplied inclusive dates. The returned label is the
        resolved comparison mode.
    """
    if compare not in COMPARISONS:
        raise ValidationError({"compare": "Use previous, year or custom."})

    if compare == "year":
        try:
            previous_start = start.replace(year=start.year - 1)
        except ValueError:  # 29 February in a non-leap year.
            previous_start = start.replace(year=start.year - 1, day=28)
        try:
            previous_end = end.replace(year=end.year - 1)
        except ValueError:
            previous_end = end.replace(year=end.year - 1, day=28)
        return "year", previous_start, previous_end

    if compare == "custom":
        if compare_from is None or compare_to is None:
            raise ValidationError(
                {"compare_from": "Give both comparison dates for a custom baseline."}
            )
        if compare_from > compare_to:
            raise ValidationError(
                {"compare_from": "The comparison start must not be after its end."}
            )
        return "custom", compare_from, compare_to

    period_days = (end - start).days + 1
    previous_end = start - timedelta(days=1)
    return "previous", previous_end - timedelta(days=period_days - 1), previous_end


def _totals(sales: QuerySet, returns: QuerySet) -> dict:
    sales_totals = sales.aggregate(gross=Sum("gross_line_amount"), net=Sum("net_line_amount"))
    returns_net = returns.aggregate(net=Sum("net_line_amount"))["net"]

    gross = sales_totals["gross"] or ZERO
    net = (sales_totals["net"] or ZERO) + (returns_net or ZERO)
    has_data = sales_totals["net"] is not None or returns_net is not None
    return {
        "has_data": has_data,
        "gross": gross,
        "net": net,
        "orders": sales.values("dataset_id", "source_invoice_id").distinct().count(),
        "customers": (
            sales.filter(customer_key__isnull=False)
            .values("dataset_id", "customer_key")
            .distinct()
            .count()
        ),
    }


def _empty_summary() -> dict:
    return {
        "has_data": False,
        "date_from": None,
        "date_to": None,
        "comparison_date_from": None,
        "comparison_date_to": None,
        "gross_sales": money(None),
        "net_sales": money(None),
        "eligible_orders": 0,
        "average_order_value": None,
        "unique_customers": 0,
        "sales_growth_percent": None,
        "previous_net_sales": money(None),
        "datasets": [],
    }


def sales_summary(
    *,
    organisation,
    dataset_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    compare: str = "previous",
    compare_from: date | None = None,
    compare_to: date | None = None,
) -> dict:
    """KPIs for one organisation's sales, with a chosen baseline period."""
    facts = facts_for(organisation, dataset_id)
    start, end = resolve_period(facts, date_from, date_to)
    if start is None or end is None:
        return _empty_summary()

    current_sales = facts.sales.filter(date_key__date__range=(start, end))
    current_returns = facts.returns.filter(date_key__date__range=(start, end))
    current = _totals(current_sales, current_returns)

    mode, previous_start, previous_end = resolve_comparison(
        start,
        end,
        compare=compare,
        compare_from=compare_from,
        compare_to=compare_to,
    )
    previous = _totals(
        facts.sales.filter(date_key__date__range=(previous_start, previous_end)),
        facts.returns.filter(date_key__date__range=(previous_start, previous_end)),
    )

    growth = None
    if current["has_data"] and previous["net"] > ZERO:
        growth = percent((current["net"] - previous["net"]) / previous["net"] * 100)

    dataset_ids = set(current_sales.values_list("dataset_id", flat=True).distinct()) | set(
        current_returns.values_list("dataset_id", flat=True).distinct()
    )
    datasets = [
        {"id": str(item["id"]), "name": item["name"]}
        for item in Dataset.objects.filter(id__in=dataset_ids).order_by("name").values("id", "name")
    ]

    return {
        "has_data": current["has_data"],
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "compare": mode,
        "comparison_date_from": previous_start.isoformat(),
        "comparison_date_to": previous_end.isoformat(),
        "gross_sales": money(current["gross"]),
        "net_sales": money(current["net"]),
        "eligible_orders": current["orders"],
        "average_order_value": (
            money(current["net"] / current["orders"]) if current["orders"] else None
        ),
        "unique_customers": current["customers"],
        "sales_growth_percent": growth,
        "previous_net_sales": money(previous["net"]),
        "datasets": datasets,
    }


def _bucket_key(row: dict, granularity: str) -> tuple:
    if granularity == "day":
        return (row["date_key__date"],)
    if granularity == "week":
        return (row["date_key__iso_year"], row["date_key__iso_week"])
    return (row["date_key__year"], row["date_key__month"])


def _bucket_bounds(key: tuple, granularity: str) -> tuple[date, date]:
    if granularity == "day":
        return key[0], key[0]
    if granularity == "week":
        start = date.fromisocalendar(key[0], key[1], 1)
        return start, start + timedelta(days=6)
    start = date(key[0], key[1], 1)
    return start, date(key[0], key[1], calendar.monthrange(key[0], key[1])[1])


def _bucket_label(start: date, granularity: str) -> str:
    if granularity == "day":
        return start.strftime("%d %b %Y")
    if granularity == "week":
        return f"Week of {start.strftime('%d %b %Y')}"
    return start.strftime("%b %Y")


def _trend_points(facts: Facts, start: date, end: date, granularity: str) -> list[dict]:
    fields = {
        "day": ("date_key__date",),
        "week": ("date_key__iso_year", "date_key__iso_week"),
        "month": ("date_key__year", "date_key__month"),
    }[granularity]

    sales = facts.sales.filter(date_key__date__range=(start, end))
    returns = facts.returns.filter(date_key__date__range=(start, end))

    buckets: dict[tuple, dict] = {}
    for row in sales.values(*fields, "dataset_id", "source_invoice_id").distinct():
        key = _bucket_key(row, granularity)
        buckets.setdefault(key, {"invoices": set(), "gross": ZERO, "net": ZERO})["invoices"].add(
            (row["dataset_id"], row["source_invoice_id"])
        )

    for row in sales.values(*fields).annotate(
        gross=Sum("gross_line_amount"), net=Sum("net_line_amount")
    ):
        bucket = buckets.setdefault(
            _bucket_key(row, granularity),
            {"invoices": set(), "gross": ZERO, "net": ZERO},
        )
        bucket["gross"] += row["gross"] or ZERO
        bucket["net"] += row["net"] or ZERO

    for row in returns.values(*fields).annotate(net=Sum("net_line_amount")):
        bucket = buckets.setdefault(
            _bucket_key(row, granularity),
            {"invoices": set(), "gross": ZERO, "net": ZERO},
        )
        bucket["net"] += row["net"] or ZERO

    points = []
    for key in sorted(buckets):
        bucket_start, bucket_end = _bucket_bounds(key, granularity)
        entry = buckets[key]
        points.append(
            {
                "period_start": bucket_start.isoformat(),
                "period_end": bucket_end.isoformat(),
                "label": _bucket_label(bucket_start, granularity),
                "gross_sales": money(entry["gross"]),
                "net_sales": money(entry["net"]),
                "orders": len(entry["invoices"]),
            }
        )

    return points


def sales_trend(
    *,
    organisation,
    dataset_id: uuid.UUID | None = None,
    granularity: str = "month",
    date_from: date | None = None,
    date_to: date | None = None,
    compare: str = "previous",
    compare_from: date | None = None,
    compare_to: date | None = None,
) -> dict:
    """Net sales and distinct orders per calendar day, ISO week or month.

    When a comparison baseline is requested the same series is returned for the
    baseline window, aligned by position so a chart can overlay the two.
    """
    if granularity not in GRANULARITIES:
        raise ValidationError({"granularity": "Use day, week or month."})

    facts = facts_for(organisation, dataset_id)
    start, end = resolve_period(facts, date_from, date_to)
    if start is None or end is None:
        return {
            "granularity": granularity,
            "has_data": False,
            "date_from": None,
            "date_to": None,
            "points": [],
            "compare": None,
            "comparison": None,
        }

    mode, previous_start, previous_end = resolve_comparison(
        start,
        end,
        compare=compare,
        compare_from=compare_from,
        compare_to=compare_to,
    )
    points = _trend_points(facts, start, end, granularity)
    previous_points = _trend_points(facts, previous_start, previous_end, granularity)

    return {
        "granularity": granularity,
        "has_data": bool(points),
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "compare": mode,
        "comparison": {
            "date_from": previous_start.isoformat(),
            "date_to": previous_end.isoformat(),
            "points": previous_points,
        },
        "points": points,
    }


PRODUCT_CHANGE_THRESHOLD = Decimal("20")


def _empty_product_performance(
    start: date | None,
    end: date | None,
    previous_start: date | None,
    previous_end: date | None,
) -> dict:
    return {
        "has_data": False,
        "date_from": start.isoformat() if start else None,
        "date_to": end.isoformat() if end else None,
        "comparison_date_from": previous_start.isoformat() if previous_start else None,
        "comparison_date_to": previous_end.isoformat() if previous_end else None,
        "net_sales": money(None),
        "product_count": 0,
        "top_product_share": None,
        "declining_products": 0,
        "rows": [],
    }


def product_performance(
    *,
    organisation,
    dataset_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = 50,
    search: str | None = None,
    compare: str = "previous",
    compare_from: date | None = None,
    compare_to: date | None = None,
) -> dict:
    """Product revenue, units, contribution and period-over-period direction.

    ``direction`` is a transparent heuristic, not a statistical test: a product
    is ``declining`` when its net sales fall by at least 20% against the
    preceding equal-length period, ``growing`` when they rise by at least 20%,
    ``new`` when it had positive net sales but none in the prior period, and
    ``returns`` when it had no prior sales and only negative net activity.
    """
    facts = facts_for(organisation, dataset_id)
    start, end = resolve_period(facts, date_from, date_to)
    if start is None or end is None:
        return _empty_product_performance(None, None, None, None)

    _, previous_start, previous_end = resolve_comparison(
        start,
        end,
        compare=compare,
        compare_from=compare_from,
        compare_to=compare_to,
    )

    rows: dict[int, dict] = {}
    for row in (
        facts.sales.filter(date_key__date__range=(start, end))
        .values("product_key_id", "dataset_id")
        .annotate(
            net=Sum("net_line_amount"),
            gross=Sum("gross_line_amount"),
            units=Sum("quantity"),
            orders=Count("source_invoice_id", distinct=True),
        )
    ):
        rows[row["product_key_id"]] = {
            "product_key": row["product_key_id"],
            "dataset_id": row["dataset_id"],
            "net": row["net"] or ZERO,
            "gross": row["gross"] or ZERO,
            "units": row["units"] or 0,
            "orders": row["orders"],
            "returned_units": 0,
            "return_lines": 0,
        }

    for row in (
        facts.returns.filter(date_key__date__range=(start, end))
        .values("product_key_id", "dataset_id")
        .annotate(
            net=Sum("net_line_amount"),
            units=Sum("quantity"),
            lines=Count("id"),
        )
    ):
        entry = rows.setdefault(
            row["product_key_id"],
            {
                "product_key": row["product_key_id"],
                "dataset_id": row["dataset_id"],
                "net": ZERO,
                "gross": ZERO,
                "units": 0,
                "orders": 0,
                "returned_units": 0,
                "return_lines": 0,
            },
        )
        entry["net"] += row["net"] or ZERO
        entry["units"] += row["units"] or 0
        entry["returned_units"] += -(row["units"] or 0)
        entry["return_lines"] += row["lines"]

    previous: dict[int, Decimal] = {}
    for queryset in (
        facts.sales.filter(date_key__date__range=(previous_start, previous_end)),
        facts.returns.filter(date_key__date__range=(previous_start, previous_end)),
    ):
        for row in queryset.values("product_key_id").annotate(net=Sum("net_line_amount")):
            previous[row["product_key_id"]] = previous.get(row["product_key_id"], ZERO) + (
                row["net"] or ZERO
            )

    dimensions = DimProduct.objects.filter(id__in=rows).select_related("dataset")
    for dimension in dimensions:
        entry = rows.get(dimension.id)
        if entry is not None:
            entry["source_product_code"] = dimension.source_product_code
            entry["description"] = dimension.description
            entry["dataset_name"] = dimension.dataset.name

    total_net = sum((entry["net"] for entry in rows.values()), ZERO)
    for entry in rows.values():
        prior = previous.get(entry["product_key"], ZERO)
        entry["previous_net"] = prior
        if prior <= ZERO:
            entry["change_percent"] = None
            if entry["net"] > ZERO:
                entry["direction"] = "new"
            elif entry["net"] < ZERO:
                entry["direction"] = "returns"
            else:
                entry["direction"] = "stable"
        else:
            change = (entry["net"] - prior) / prior * 100
            entry["change_percent"] = percent(change)
            if change <= -PRODUCT_CHANGE_THRESHOLD:
                entry["direction"] = "declining"
            elif change >= PRODUCT_CHANGE_THRESHOLD:
                entry["direction"] = "growing"
            else:
                entry["direction"] = "stable"
        entry["share"] = percent(entry["net"] / total_net * 100) if total_net > ZERO else None

    ordered = sorted(
        (entry for entry in rows.values() if "source_product_code" in entry),
        key=lambda entry: (-entry["net"], entry["source_product_code"].lower()),
    )
    declining = sum(1 for entry in ordered if entry["direction"] == "declining")
    top_net = max((entry["net"] for entry in ordered), default=ZERO)

    # Product summaries cover the full selection; search only narrows the rows
    # returned for a focused record in the command palette.
    needle = (search or "").strip().casefold()
    visible = (
        [
            entry
            for entry in ordered
            if needle in entry["source_product_code"].casefold()
            or needle in entry["description"].casefold()
        ]
        if needle
        else ordered
    )

    return {
        "has_data": bool(ordered),
        "compare": compare,
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "comparison_date_from": previous_start.isoformat(),
        "comparison_date_to": previous_end.isoformat(),
        "net_sales": money(total_net),
        "product_count": len(ordered),
        "top_product_share": (percent(top_net / total_net * 100) if total_net > ZERO else None),
        "declining_products": declining,
        "rows": [
            {
                "product_id": str(entry["product_key"]),
                "source_product_code": entry["source_product_code"],
                "description": entry["description"],
                "dataset_id": str(entry["dataset_id"]),
                "dataset_name": entry["dataset_name"],
                "net_sales": money(entry["net"]),
                "gross_sales": money(entry["gross"]),
                "share": entry["share"],
                "units": entry["units"],
                "orders": entry["orders"],
                "returned_units": entry["returned_units"],
                "return_lines": entry["return_lines"],
                "previous_net_sales": money(entry["previous_net"]),
                "change_percent": entry["change_percent"],
                "direction": entry["direction"],
            }
            for entry in visible[:limit]
        ],
    }

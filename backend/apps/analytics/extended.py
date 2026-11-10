"""Analytical services added after M9: geography, returns, baskets and product drill-down.

These build on the shared warehouse helpers in ``services`` so the API, reports
and notebooks keep one definition of a period, a comparison and a money value.
Every function returns JSON-ready primitives and never touches request objects.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Count, Max, Sum
from rest_framework.exceptions import NotFound

from apps.ingestion.models import DimCustomer, DimGeography, DimProduct

from .services import (
    PRODUCT_CHANGE_THRESHOLD,
    ZERO,
    facts_for,
    money,
    percent,
    resolve_comparison,
    resolve_period,
)

TWO_PLACES = Decimal("0.01")


# --------------------------------------------------------------------------- #
# Geography
# --------------------------------------------------------------------------- #


def _empty_geography(compare: str | None = None) -> dict:
    return {
        "has_data": False,
        "compare": compare,
        "date_from": None,
        "date_to": None,
        "comparison_date_from": None,
        "comparison_date_to": None,
        "net_sales": money(None),
        "country_count": 0,
        "top_country_share": None,
        "rows": [],
    }


def geography_performance(
    *,
    organisation,
    dataset_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    compare: str = "previous",
    compare_from: date | None = None,
    compare_to: date | None = None,
    limit: int = 100,
) -> dict:
    """Net sales, orders and returns per country for the selected period.

    Country labels come from the mapped geography column. Lines without a
    country are grouped under "Unassigned" rather than dropped, so the country
    rows always reconcile with the sales summary.
    """
    facts = facts_for(organisation, dataset_id)
    start, end = resolve_period(facts, date_from, date_to)
    if start is None or end is None:
        return _empty_geography(compare)

    mode, previous_start, previous_end = resolve_comparison(
        start,
        end,
        compare=compare,
        compare_from=compare_from,
        compare_to=compare_to,
    )

    rows: dict[int | None, dict] = {}

    def entry_for(key: int | None) -> dict:
        return rows.setdefault(
            key,
            {
                "net": ZERO,
                "gross": ZERO,
                "discount": ZERO,
                "units": 0,
                "orders": 0,
                "customers": set(),
                "returned_units": 0,
                "return_lines": 0,
                "return_value": ZERO,
            },
        )

    sales = facts.sales.filter(date_key__date__range=(start, end))
    returns = facts.returns.filter(date_key__date__range=(start, end))

    for row in sales.values("geography_key_id", "dataset_id").annotate(
        net=Sum("net_line_amount"),
        gross=Sum("gross_line_amount"),
        discount=Sum("discount_amount"),
        units=Sum("quantity"),
        orders=Count("source_invoice_id", distinct=True),
    ):
        entry = entry_for(row["geography_key_id"])
        entry["net"] += row["net"] or ZERO
        entry["gross"] += row["gross"] or ZERO
        entry["discount"] += row["discount"] or ZERO
        entry["units"] += row["units"] or 0
        entry["orders"] += row["orders"]

    for row in (
        sales.filter(customer_key__isnull=False)
        .values("geography_key_id", "dataset_id", "customer_key_id")
        .distinct()
    ):
        entry_for(row["geography_key_id"])["customers"].add(
            (row["dataset_id"], row["customer_key_id"])
        )

    for row in returns.values("geography_key_id").annotate(
        net=Sum("net_line_amount"), units=Sum("quantity"), lines=Count("id")
    ):
        entry = entry_for(row["geography_key_id"])
        entry["net"] += row["net"] or ZERO
        entry["returned_units"] += -(row["units"] or 0)
        entry["return_lines"] += row["lines"]
        entry["return_value"] += abs(row["net"] or ZERO)

    previous: dict[int | None, Decimal] = {}
    for queryset in (
        facts.sales.filter(date_key__date__range=(previous_start, previous_end)),
        facts.returns.filter(date_key__date__range=(previous_start, previous_end)),
    ):
        for row in queryset.values("geography_key_id").annotate(net=Sum("net_line_amount")):
            previous[row["geography_key_id"]] = previous.get(row["geography_key_id"], ZERO) + (
                row["net"] or ZERO
            )

    labels = {
        dimension.id: dimension.country
        for dimension in DimGeography.objects.filter(id__in=[key for key in rows if key])
    }
    total_net = sum((entry["net"] for entry in rows.values()), ZERO)

    output = []
    for key, entry in rows.items():
        prior = previous.get(key, ZERO)
        change = None
        direction = "stable"
        if prior > ZERO:
            change = percent((entry["net"] - prior) / prior * 100)
            if Decimal(change) <= -PRODUCT_CHANGE_THRESHOLD:
                direction = "declining"
            elif Decimal(change) >= PRODUCT_CHANGE_THRESHOLD:
                direction = "growing"
        elif entry["net"] > ZERO:
            direction = "new"
        elif entry["net"] < ZERO:
            direction = "returns"

        sold = entry["units"]
        output.append(
            {
                "country": labels.get(key) if key else "Unassigned",
                "net_sales": money(entry["net"]),
                "gross_sales": money(entry["gross"]),
                "discount_total": money(entry["discount"]),
                "share": (percent(entry["net"] / total_net * 100) if total_net > ZERO else None),
                "units": sold,
                "orders": entry["orders"],
                "customers": len(entry["customers"]),
                "returned_units": entry["returned_units"],
                "return_value": money(entry["return_value"]),
                "return_rate": (
                    percent(Decimal(entry["returned_units"]) / sold * 100) if sold > 0 else None
                ),
                "previous_net_sales": money(prior),
                "change_percent": change,
                "direction": direction,
            }
        )

    output.sort(key=lambda item: (-Decimal(item["net_sales"]), item["country"].lower()))
    top_net = Decimal(output[0]["net_sales"]) if output else ZERO

    return {
        "has_data": bool(output),
        "compare": mode,
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "comparison_date_from": previous_start.isoformat(),
        "comparison_date_to": previous_end.isoformat(),
        "net_sales": money(total_net),
        "country_count": len(output),
        "top_country_share": (percent(top_net / total_net * 100) if total_net > ZERO else None),
        "rows": output[:limit],
    }


# --------------------------------------------------------------------------- #
# Returns and discounts
# --------------------------------------------------------------------------- #


def _empty_returns() -> dict:
    return {
        "has_data": False,
        "date_from": None,
        "date_to": None,
        "sales_lines": 0,
        "return_lines": 0,
        "sold_units": 0,
        "returned_units": 0,
        "return_rate": None,
        "gross_sales": money(None),
        "discount_total": money(None),
        "discount_rate": None,
        "return_value": money(None),
        "net_sales": money(None),
        "bridge": [],
        "products": [],
        "countries": [],
    }


def returns_analysis(
    *,
    organisation,
    dataset_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = 25,
) -> dict:
    """Return rates, discount depth and the gross-to-net bridge.

    ``return_rate`` is returned units divided by sold units in the same
    selection. It is not a refund rate: a return does not have to reference the
    original sale, so the ratio is a volume indicator, not a financial one.
    """
    facts = facts_for(organisation, dataset_id)
    start, end = resolve_period(facts, date_from, date_to)
    if start is None or end is None:
        return _empty_returns()

    sales = facts.sales.filter(date_key__date__range=(start, end))
    returns = facts.returns.filter(date_key__date__range=(start, end))

    sales_totals = sales.aggregate(
        gross=Sum("gross_line_amount"),
        discount=Sum("discount_amount"),
        net=Sum("net_line_amount"),
        units=Sum("quantity"),
        lines=Count("id"),
    )
    return_totals = returns.aggregate(
        net=Sum("net_line_amount"),
        units=Sum("quantity"),
        lines=Count("id"),
    )

    gross = sales_totals["gross"] or ZERO
    discount = sales_totals["discount"] or ZERO
    returns_net = return_totals["net"] or ZERO
    sold_units = sales_totals["units"] or 0
    returned_units = -(return_totals["units"] or 0)
    return_value = abs(returns_net)
    net = (sales_totals["net"] or ZERO) + returns_net

    product_rows: dict[int, dict] = {}
    for row in sales.values("product_key_id", "dataset_id").annotate(
        net=Sum("net_line_amount"), units=Sum("quantity")
    ):
        product_rows[row["product_key_id"]] = {
            "product_key": row["product_key_id"],
            "dataset_id": row["dataset_id"],
            "net": row["net"] or ZERO,
            "units": row["units"] or 0,
            "return_units": 0,
            "return_lines": 0,
            "return_value": ZERO,
        }
    for row in returns.values("product_key_id", "dataset_id").annotate(
        net=Sum("net_line_amount"), units=Sum("quantity"), lines=Count("id")
    ):
        entry = product_rows.setdefault(
            row["product_key_id"],
            {
                "product_key": row["product_key_id"],
                "dataset_id": row["dataset_id"],
                "net": ZERO,
                "units": 0,
                "return_units": 0,
                "return_lines": 0,
                "return_value": ZERO,
            },
        )
        entry["return_units"] += -(row["units"] or 0)
        entry["return_lines"] += row["lines"]
        entry["return_value"] += abs(row["net"] or ZERO)
        entry["net"] += row["net"] or ZERO

    product_labels = {
        item.id: item
        for item in DimProduct.objects.filter(id__in=list(product_rows)).select_related("dataset")
    }
    products = []
    for key, entry in product_rows.items():
        if entry["return_units"] <= 0:
            continue
        dimension = product_labels.get(key)
        if dimension is None:
            continue
        sold = entry["units"]
        products.append(
            {
                "product_id": str(dimension.id),
                "source_product_code": dimension.source_product_code,
                "description": dimension.description,
                "dataset_id": str(dimension.dataset_id),
                "dataset_name": dimension.dataset.name,
                "returned_units": entry["return_units"],
                "return_lines": entry["return_lines"],
                "return_value": money(entry["return_value"]),
                "sold_units": sold,
                "return_rate": (
                    percent(Decimal(entry["return_units"]) / sold * 100) if sold > 0 else None
                ),
                "net_sales": money(entry["net"]),
            }
        )
    products.sort(key=lambda item: (-Decimal(item["return_value"]), -item["returned_units"]))

    country_rows: dict[int | None, dict] = {}

    def country_entry(key: int | None) -> dict:
        return country_rows.setdefault(key, {"units": 0, "returned": 0, "value": ZERO})

    for row in sales.values("geography_key_id").annotate(units=Sum("quantity")):
        country_entry(row["geography_key_id"])["units"] += row["units"] or 0
    for row in returns.values("geography_key_id").annotate(
        units=Sum("quantity"), net=Sum("net_line_amount")
    ):
        entry = country_entry(row["geography_key_id"])
        entry["returned"] += -(row["units"] or 0)
        entry["value"] += abs(row["net"] or ZERO)

    country_labels = {
        item.id: item.country
        for item in DimGeography.objects.filter(id__in=[key for key in country_rows if key])
    }
    countries = []
    for key, entry in country_rows.items():
        sold = entry["units"]
        countries.append(
            {
                "country": country_labels.get(key) if key else "Unassigned",
                "sold_units": sold,
                "returned_units": entry["returned"],
                "return_value": money(entry["value"]),
                "return_rate": (
                    percent(Decimal(entry["returned"]) / sold * 100) if sold > 0 else None
                ),
            }
        )
    countries.sort(key=lambda item: (-Decimal(item["return_value"]), item["country"].lower()))

    return {
        "has_data": bool(sales_totals["lines"] or return_totals["lines"]),
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "sales_lines": sales_totals["lines"] or 0,
        "return_lines": return_totals["lines"] or 0,
        "sold_units": sold_units,
        "returned_units": returned_units,
        "return_rate": (
            percent(Decimal(returned_units) / sold_units * 100) if sold_units > 0 else None
        ),
        "gross_sales": money(gross),
        "discount_total": money(discount),
        "discount_rate": (percent(discount / gross * 100) if gross > ZERO else None),
        "return_value": money(return_value),
        "net_sales": money(net),
        "bridge": [
            {"label": "Gross sales", "amount": money(gross)},
            {"label": "Discounts", "amount": money(-discount)},
            {"label": "Returns", "amount": money(returns_net)},
            {"label": "Net sales", "amount": money(net)},
        ],
        "products": products[:limit],
        "countries": countries[:limit],
    }


# --------------------------------------------------------------------------- #
# Market basket / cross-sell affinity
# --------------------------------------------------------------------------- #


def basket_analysis(
    *,
    organisation,
    dataset_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = 25,
    min_invoices: int = 1,
) -> dict:
    """Products bought on the same invoice, ranked by co-occurrence.

    ``support`` is the share of invoices containing both products, the two
    confidence values are conditional shares, and ``lift`` compares the observed
    co-occurrence with independence. Associations are descriptive, not causal.
    """
    facts = facts_for(organisation, dataset_id)
    start, end = resolve_period(facts, date_from, date_to)
    if start is None or end is None:
        return {"has_data": False, "date_from": None, "date_to": None, "invoices": 0, "pairs": []}

    baskets: dict[tuple, set[int]] = {}
    for row in (
        facts.sales.filter(date_key__date__range=(start, end))
        .values("dataset_id", "source_invoice_id", "product_key_id")
        .distinct()
    ):
        baskets.setdefault((row["dataset_id"], row["source_invoice_id"]), set()).add(
            row["product_key_id"]
        )

    product_invoices: dict[int, set[tuple]] = {}
    pair_counts: dict[tuple[int, int], int] = {}
    for key, products in baskets.items():
        for product in products:
            product_invoices.setdefault(product, set()).add(key)
        ordered = sorted(products)
        for index, first in enumerate(ordered):
            for second in ordered[index + 1 :]:
                pair_counts[(first, second)] = pair_counts.get((first, second), 0) + 1

    invoice_count = len(baskets)
    ranked = sorted(
        ((pair, count) for pair, count in pair_counts.items() if count >= min_invoices),
        key=lambda item: (-item[1], item[0]),
    )[:limit]

    labels = {
        item.id: item
        for item in DimProduct.objects.filter(
            id__in={product for pair, _ in ranked for product in pair}
        ).select_related("dataset")
    }

    pairs = []
    for (first, second), count in ranked:
        first_dimension = labels.get(first)
        second_dimension = labels.get(second)
        if first_dimension is None or second_dimension is None:
            continue
        count_first = len(product_invoices.get(first, set()))
        count_second = len(product_invoices.get(second, set()))
        support = count / invoice_count if invoice_count else 0
        confidence_a = count / count_first if count_first else 0
        confidence_b = count / count_second if count_second else 0
        lift = (
            (confidence_a / (count_second / invoice_count))
            if count_second and invoice_count
            else None
        )
        pairs.append(
            {
                "product_a": {
                    "product_id": str(first_dimension.id),
                    "source_product_code": first_dimension.source_product_code,
                    "description": first_dimension.description,
                },
                "product_b": {
                    "product_id": str(second_dimension.id),
                    "source_product_code": second_dimension.source_product_code,
                    "description": second_dimension.description,
                },
                "invoices": count,
                "support": percent(Decimal(support) * 100),
                "confidence_a_to_b": percent(Decimal(confidence_a) * 100),
                "confidence_b_to_a": percent(Decimal(confidence_b) * 100),
                "lift": (
                    str(Decimal(lift).quantize(TWO_PLACES, rounding=ROUND_HALF_UP))
                    if lift is not None
                    else None
                ),
            }
        )

    return {
        "has_data": bool(pairs),
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "invoices": invoice_count,
        "pairs": pairs,
    }


# --------------------------------------------------------------------------- #
# Product drill-down
# --------------------------------------------------------------------------- #

EMPTY_PRODUCT_DETAIL = {
    "has_data": False,
    "product": None,
    "compare": "previous",
    "date_from": None,
    "date_to": None,
    "comparison_date_from": None,
    "comparison_date_to": None,
    "net_sales": money(None),
    "gross_sales": money(None),
    "units": 0,
    "orders": 0,
    "returned_units": 0,
    "return_rate": None,
    "share": None,
    "previous_net_sales": money(None),
    "change_percent": None,
    "trend": [],
    "customers": [],
    "countries": [],
}


def product_detail(
    *,
    organisation,
    product_id: int,
    date_from: date | None = None,
    date_to: date | None = None,
    compare: str = "previous",
    compare_from: date | None = None,
    compare_to: date | None = None,
) -> dict:
    """One product's performance in the selected scope, with its buyers."""
    dimension = (
        DimProduct.objects.filter(id=product_id, dataset__organisation=organisation)
        .select_related("dataset")
        .first()
    )
    if dimension is None:
        raise NotFound("Product not found.")

    facts = facts_for(organisation, dimension.dataset_id)
    start, end = resolve_period(facts, date_from, date_to)
    if start is None or end is None:
        return dict(EMPTY_PRODUCT_DETAIL, product=_product_header(dimension))

    mode, previous_start, previous_end = resolve_comparison(
        start,
        end,
        compare=compare,
        compare_from=compare_from,
        compare_to=compare_to,
    )
    sales = facts.sales.filter(product_key=dimension, date_key__date__range=(start, end))
    returns = facts.returns.filter(product_key=dimension, date_key__date__range=(start, end))

    totals = sales.aggregate(
        net=Sum("net_line_amount"),
        gross=Sum("gross_line_amount"),
        units=Sum("quantity"),
        orders=Count("source_invoice_id", distinct=True),
    )
    return_totals = returns.aggregate(net=Sum("net_line_amount"), units=Sum("quantity"))
    net = (totals["net"] or ZERO) + (return_totals["net"] or ZERO)
    sold_units = totals["units"] or 0
    returned_units = -(return_totals["units"] or 0)

    scope_net = ZERO
    for queryset in (
        facts.sales.filter(date_key__date__range=(start, end)),
        facts.returns.filter(date_key__date__range=(start, end)),
    ):
        scope_net += queryset.aggregate(net=Sum("net_line_amount"))["net"] or ZERO

    previous_net = ZERO
    for queryset in (
        facts.sales.filter(
            product_key=dimension, date_key__date__range=(previous_start, previous_end)
        ),
        facts.returns.filter(
            product_key=dimension, date_key__date__range=(previous_start, previous_end)
        ),
    ):
        previous_net += queryset.aggregate(net=Sum("net_line_amount"))["net"] or ZERO

    change = percent((net - previous_net) / previous_net * 100) if previous_net > ZERO else None

    buckets: dict[tuple[int, int], dict] = {}
    for row in sales.values("date_key__year", "date_key__month").annotate(
        net=Sum("net_line_amount"),
        units=Sum("quantity"),
        orders=Count("source_invoice_id", distinct=True),
    ):
        buckets[(row["date_key__year"], row["date_key__month"])] = {
            "net": row["net"] or ZERO,
            "units": row["units"] or 0,
            "orders": row["orders"],
            "returns": ZERO,
        }
    for row in returns.values("date_key__year", "date_key__month").annotate(
        net=Sum("net_line_amount"), units=Sum("quantity")
    ):
        entry = buckets.setdefault(
            (row["date_key__year"], row["date_key__month"]),
            {"net": ZERO, "units": 0, "orders": 0, "returns": ZERO},
        )
        entry["net"] += row["net"] or ZERO
        entry["units"] += row["units"] or 0
        entry["returns"] += -(row["units"] or 0)

    trend = [
        {
            "month": f"{year:04d}-{month:02d}",
            "label": date(year, month, 1).strftime("%b %Y"),
            "net_sales": money(entry["net"]),
            "units": entry["units"],
            "orders": entry["orders"],
            "returned_units": entry["returns"],
        }
        for (year, month), entry in sorted(buckets.items())
    ]

    buyer_rows = list(
        sales.filter(customer_key__isnull=False)
        .values("customer_key_id", "dataset_id")
        .annotate(
            net=Sum("net_line_amount"),
            orders=Count("source_invoice_id", distinct=True),
            last=Max("date_key__date"),
        )
        .order_by("-net")[:10]
    )
    customer_labels = {
        item.id: item
        for item in DimCustomer.objects.filter(
            id__in=[row["customer_key_id"] for row in buyer_rows]
        )
    }
    customers = [
        {
            "customer_id": str(row["customer_key_id"]),
            "source_customer_id": customer_labels[row["customer_key_id"]].source_customer_id,
            "net_sales": money(row["net"]),
            "orders": row["orders"],
            "last_purchase": row["last"].isoformat(),
        }
        for row in buyer_rows
        if row["customer_key_id"] in customer_labels
    ]

    country_rows: dict[int | None, dict] = {}

    def country_entry(key: int | None) -> dict:
        return country_rows.setdefault(key, {"net": ZERO, "units": 0})

    for row in sales.values("geography_key_id").annotate(
        net=Sum("net_line_amount"), units=Sum("quantity")
    ):
        entry = country_entry(row["geography_key_id"])
        entry["net"] += row["net"] or ZERO
        entry["units"] += row["units"] or 0

    country_labels = {
        item.id: item.country
        for item in DimGeography.objects.filter(id__in=[key for key in country_rows if key])
    }
    countries = sorted(
        (
            {
                "country": country_labels.get(key) if key else "Unassigned",
                "net_sales": money(entry["net"]),
                "units": entry["units"],
            }
            for key, entry in country_rows.items()
        ),
        key=lambda item: -Decimal(item["net_sales"]),
    )[:10]

    return {
        "has_data": True,
        "compare": mode,
        "product": _product_header(dimension),
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "comparison_date_from": previous_start.isoformat(),
        "comparison_date_to": previous_end.isoformat(),
        "net_sales": money(net),
        "gross_sales": money(totals["gross"]),
        "units": sold_units,
        "orders": totals["orders"] or 0,
        "returned_units": returned_units,
        "return_rate": (
            percent(Decimal(returned_units) / sold_units * 100) if sold_units > 0 else None
        ),
        "share": (percent(net / scope_net * 100) if scope_net > ZERO else None),
        "previous_net_sales": money(previous_net),
        "change_percent": change,
        "trend": trend,
        "customers": customers,
        "countries": countries,
    }


def _product_header(dimension: DimProduct) -> dict:
    return {
        "product_id": str(dimension.id),
        "source_product_code": dimension.source_product_code,
        "description": dimension.description,
        "dataset_id": str(dimension.dataset_id),
        "dataset_name": dimension.dataset.name,
    }

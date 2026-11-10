"""Customer drill-down and saved segment evaluation.

The segment rules narrow the same RFM-scored selection the Customers page uses,
so a saved segment can never disagree with the table it was built from.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.db.models import Count, Max, Min, Sum
from rest_framework.exceptions import NotFound, ValidationError

from apps.analytics.services import facts_for, money, percent, resolve_period
from apps.ingestion.models import DimCustomer, DimProduct

from .models import CustomerSegment
from .services import SEGMENT_LABELS, _customer_rows, _scored_rows

ZERO = Decimal("0")
RULE_KEYS = {
    "recency_days_max",
    "recency_days_min",
    "orders_min",
    "net_sales_min",
    "rfm_segment",
    "rfm_score_min",
}


def validate_rules(rules: dict) -> dict:
    """Validate a rule set, returning the normalised rules."""
    if rules in (None, ""):
        return {}
    if not isinstance(rules, dict):
        raise ValidationError({"rules": "Rules must be an object."})

    unknown = set(rules) - RULE_KEYS
    if unknown:
        raise ValidationError({"rules": f"Unsupported rule keys: {', '.join(sorted(unknown))}."})

    cleaned: dict = {}
    for key in ("recency_days_max", "recency_days_min", "orders_min", "rfm_score_min"):
        if key in rules and rules[key] not in (None, ""):
            try:
                value = int(rules[key])
            except (TypeError, ValueError) as error:
                raise ValidationError({"rules": f"{key} must be a whole number."}) from error
            if value < 0:
                raise ValidationError({"rules": f"{key} cannot be negative."})
            cleaned[key] = value

    if "net_sales_min" in rules and rules["net_sales_min"] not in (None, ""):
        try:
            cleaned["net_sales_min"] = str(Decimal(str(rules["net_sales_min"])))
        except Exception as error:  # noqa: BLE001 - re-raised as a field error
            raise ValidationError({"rules": "net_sales_min must be a number."}) from error

    if "rfm_segment" in rules and rules["rfm_segment"]:
        if rules["rfm_segment"] not in SEGMENT_LABELS:
            raise ValidationError({"rules": "Choose a known RFM segment."})
        cleaned["rfm_segment"] = rules["rfm_segment"]

    return cleaned


def segment_matches(row: dict, rules: dict) -> bool:
    if "recency_days_max" in rules and row["recency_days"] > rules["recency_days_max"]:
        return False
    if "recency_days_min" in rules and row["recency_days"] < rules["recency_days_min"]:
        return False
    if "orders_min" in rules and row["orders"] < rules["orders_min"]:
        return False
    if "net_sales_min" in rules and row["net"] < Decimal(rules["net_sales_min"]):
        return False
    if "rfm_segment" in rules and row["segment"] != rules["rfm_segment"]:
        return False
    if "rfm_score_min" in rules and min(row["r"], row["f"], row["m"]) < rules["rfm_score_min"]:
        return False
    return True


def segment_members(
    *,
    organisation,
    segment: CustomerSegment,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = 50,
) -> dict:
    """Evaluate one saved segment against the current warehouse."""
    facts = facts_for(organisation, segment.dataset_id)
    start, end = resolve_period(facts, date_from, date_to)
    if start is None or end is None:
        return {"has_data": False, "customers": [], "total": 0, "net_sales": money(None)}

    rows = _customer_rows(facts, start, end)
    scored = _scored_rows(rows, end) if rows else []
    matched = [row for row in scored if segment_matches(row, segment.rules or {})]
    matched.sort(key=lambda row: (-row["net"], row["source_customer_id"].casefold()))
    total_net = sum((row["net"] for row in matched), ZERO)

    return {
        "has_data": bool(matched),
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "total": len(matched),
        "net_sales": money(total_net),
        "customers": [
            {
                "customer_id": str(row["customer_key"]),
                "source_customer_id": row["source_customer_id"],
                "dataset_id": str(row["dataset_id"]),
                "dataset_name": row["dataset_name"],
                "segment": row["segment"],
                "segment_label": SEGMENT_LABELS[row["segment"]],
                "recency_days": row["recency_days"],
                "orders": row["orders"],
                "net_sales": money(row["net"]),
                "last_purchase": row["last"].isoformat(),
            }
            for row in matched[:limit]
        ],
    }


def customer_detail(
    *,
    organisation,
    customer_id: int,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict:
    """One customer's order history, products and position in the selection."""
    dimension = (
        DimCustomer.objects.filter(id=customer_id, dataset__organisation=organisation)
        .select_related("dataset")
        .first()
    )
    if dimension is None:
        raise NotFound("Customer not found.")

    facts = facts_for(organisation, dimension.dataset_id)
    start, end = resolve_period(facts, date_from, date_to)
    empty = {
        "has_data": False,
        "customer": None,
        "date_from": None,
        "date_to": None,
        "orders": 0,
        "net_sales": money(None),
        "first_purchase": None,
        "last_purchase": None,
        "average_order_value": None,
        "share_of_net_sales": None,
        "segment": None,
        "segment_label": None,
        "recency_days": None,
        "r": None,
        "f": None,
        "m": None,
        "selection_average_net_sales": None,
        "timeline": [],
        "products": [],
    }
    if start is None or end is None:
        return empty

    sales = facts.sales.filter(customer_key=dimension, date_key__date__range=(start, end))
    returns = facts.returns.filter(customer_key=dimension, date_key__date__range=(start, end))
    if not sales.exists() and not returns.exists():
        return dict(
            empty, customer=_header(dimension), date_from=start.isoformat(), date_to=end.isoformat()
        )

    totals = sales.aggregate(
        net=Sum("net_line_amount"),
        orders=Count("source_invoice_id", distinct=True),
        first=Min("date_key__date"),
        last=Max("date_key__date"),
    )
    returns_net = returns.aggregate(net=Sum("net_line_amount"))["net"] or ZERO
    net = (totals["net"] or ZERO) + returns_net
    orders = totals["orders"] or 0

    rows = _customer_rows(facts, start, end)
    scored = _scored_rows(rows, end)
    me = next((row for row in scored if row["customer_key"] == dimension.id), None)
    selection_net = sum((row["net"] for row in scored), ZERO)
    selection_count = len(scored) or 1

    timeline_rows = (
        sales.values("source_invoice_id", "date_key__date")
        .annotate(
            net=Sum("net_line_amount"),
            lines=Count("id"),
            units=Sum("quantity"),
        )
        .order_by("-date_key__date", "-source_invoice_id")[:20]
    )
    timeline = [
        {
            "invoice": row["source_invoice_id"],
            "date": row["date_key__date"].isoformat(),
            "net_sales": money(row["net"]),
            "lines": row["lines"],
            "units": row["units"] or 0,
        }
        for row in timeline_rows
    ]

    product_rows = (
        sales.values("product_key_id", "dataset_id")
        .annotate(
            net=Sum("net_line_amount"),
            units=Sum("quantity"),
            orders=Count("source_invoice_id", distinct=True),
        )
        .order_by("-net")[:10]
    )
    labels = {
        item.id: item
        for item in DimProduct.objects.filter(
            id__in=[row["product_key_id"] for row in product_rows]
        )
    }
    products = [
        {
            "product_id": str(row["product_key_id"]),
            "source_product_code": labels[row["product_key_id"]].source_product_code,
            "description": labels[row["product_key_id"]].description,
            "net_sales": money(row["net"]),
            "units": row["units"] or 0,
            "orders": row["orders"],
        }
        for row in product_rows
        if row["product_key_id"] in labels
    ]

    return {
        "has_data": True,
        "customer": _header(dimension),
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "orders": orders,
        "net_sales": money(net),
        "first_purchase": totals["first"].isoformat() if totals["first"] else None,
        "last_purchase": totals["last"].isoformat() if totals["last"] else None,
        "average_order_value": (money(net / orders) if orders else None),
        "share_of_net_sales": (
            percent(net / selection_net * 100) if selection_net > ZERO else None
        ),
        "segment": me["segment"] if me else None,
        "segment_label": SEGMENT_LABELS[me["segment"]] if me else None,
        "recency_days": me["recency_days"] if me else None,
        "r": me["r"] if me else None,
        "f": me["f"] if me else None,
        "m": me["m"] if me else None,
        "selection_average_net_sales": money(selection_net / selection_count),
        "timeline": timeline,
        "products": products,
    }


def _header(dimension: DimCustomer) -> dict:
    return {
        "customer_id": str(dimension.id),
        "source_customer_id": dimension.source_customer_id,
        "dataset_id": str(dimension.dataset_id),
        "dataset_name": dimension.dataset.name,
    }

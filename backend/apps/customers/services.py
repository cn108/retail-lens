"""Customer analytics: RFM, repeat purchase, observed value and cohorts.

Every definition is recorded in docs/ANALYTICAL_METHODOLOGY.md. A customer is
a dataset-scoped ``dim_customer`` row, so the same source id in two datasets is
treated as two customers. Anonymous lines are excluded from customer measures.

RFM scores are percentile bands over the selected customers, not fixed pound
thresholds. With a single distinct value every customer receives the neutral
score 3. Segment rules are ordered and documented in the methodology.
"""

from collections import defaultdict
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Count, Max, Min, Sum

from apps.analytics.services import Facts, facts_for, money, percent, resolve_period
from apps.ingestion.models import DimCustomer

ZERO = Decimal("0")
TWO_PLACES = Decimal("0.01")
SEGMENTS = [
    ("champion", "Champion"),
    ("loyal", "Loyal"),
    ("potential", "Potential"),
    ("at_risk", "At risk"),
    ("hibernating", "Hibernating"),
    ("occasional", "Occasional"),
]
SEGMENT_LABELS = dict(SEGMENTS)


def _decimal_string(value: Decimal) -> str:
    return str(value.quantize(TWO_PLACES, rounding=ROUND_HALF_UP))


def _month_index(year: int, month: int) -> int:
    return year * 12 + (month - 1)


def _month_key(index: int) -> str:
    year, month = divmod(index, 12)
    return f"{year:04d}-{month + 1:02d}"


def _customer_rows(facts: Facts, start: date, end: date) -> list[dict]:
    sales = facts.sales.filter(date_key__date__range=(start, end), customer_key__isnull=False)
    returns = facts.returns.filter(date_key__date__range=(start, end), customer_key__isnull=False)

    rows: dict[int, dict] = {}
    for row in sales.values("customer_key_id", "dataset_id").annotate(
        last=Max("date_key__date"),
        orders=Count("source_invoice_id", distinct=True),
        net=Sum("net_line_amount"),
    ):
        rows[row["customer_key_id"]] = {
            "customer_key": row["customer_key_id"],
            "dataset_id": row["dataset_id"],
            "last": row["last"],
            "orders": row["orders"],
            "net": row["net"] or ZERO,
        }

    for row in returns.values("customer_key_id").annotate(net=Sum("net_line_amount")):
        entry = rows.get(row["customer_key_id"])
        if entry is not None:
            entry["net"] += row["net"] or ZERO

    dimensions = DimCustomer.objects.filter(id__in=rows).select_related("dataset")
    for dimension in dimensions:
        entry = rows.get(dimension.id)
        if entry is not None:
            entry["source_customer_id"] = dimension.source_customer_id
            entry["dataset_name"] = dimension.dataset.name

    return [row for row in rows.values() if "source_customer_id" in row]


def _score(values: dict[int, int | Decimal], *, higher_is_better: bool) -> dict[int, int]:
    unique = sorted(set(values.values()))
    if len(unique) == 1:
        return {key: 3 for key in values}

    last = len(unique) - 1
    positions = {value: index / last for index, value in enumerate(unique)}
    scores: dict[int, int] = {}
    for key, value in values.items():
        position = positions[value]
        if not higher_is_better:
            position = 1 - position
        scores[key] = max(1, min(5, 1 + int(position * 4 + 0.5)))
    return scores


def _segment(recency: int, frequency: int, monetary: int) -> str:
    if recency >= 4 and frequency >= 4 and monetary >= 4:
        return "champion"
    if frequency >= 4 and recency >= 3:
        return "loyal"
    if recency >= 4:
        return "potential"
    if recency <= 2 and (frequency >= 3 or monetary >= 3):
        return "at_risk"
    if recency <= 2:
        return "hibernating"
    return "occasional"


def _scored_rows(rows: list[dict], end: date) -> list[dict]:
    recency_days = {row["customer_key"]: (end - row["last"]).days for row in rows}
    frequency = {row["customer_key"]: row["orders"] for row in rows}
    monetary = {row["customer_key"]: row["net"] for row in rows}

    recency_scores = _score(recency_days, higher_is_better=False)
    frequency_scores = _score(frequency, higher_is_better=True)
    monetary_scores = _score(monetary, higher_is_better=True)

    for row in rows:
        key = row["customer_key"]
        row["recency_days"] = recency_days[key]
        row["r"] = recency_scores[key]
        row["f"] = frequency_scores[key]
        row["m"] = monetary_scores[key]
        row["segment"] = _segment(row["r"], row["f"], row["m"])
    return rows


def _segment_distribution(rows: list[dict], total_net: Decimal) -> list[dict]:
    counts = {key: 0 for key, _ in SEGMENTS}
    nets = {key: ZERO for key, _ in SEGMENTS}
    for row in rows:
        counts[row["segment"]] += 1
        nets[row["segment"]] += row["net"]

    return [
        {
            "key": key,
            "label": label,
            "customers": counts[key],
            "net_sales": money(nets[key]),
            "share": (percent(nets[key] / total_net * 100) if total_net > ZERO else None),
        }
        for key, label in SEGMENTS
    ]


RFM_SORTS = {"net", "orders", "recency", "last", "customer"}


def customer_rfm(
    *,
    organisation,
    dataset_id=None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = 50,
    offset: int = 0,
    search: str | None = None,
    segment: str | None = None,
    sort: str = "net",
) -> dict:
    facts = facts_for(organisation, dataset_id)
    start, end = resolve_period(facts, date_from, date_to)
    if start is None or end is None:
        return {
            "has_data": False,
            "date_from": None,
            "date_to": None,
            "as_of": None,
            "customers": [],
            "segments": [],
            "total": 0,
            "offset": 0,
            "sort": sort,
            "segment": segment,
        }

    rows = _customer_rows(facts, start, end)
    if not rows:
        return {
            "has_data": False,
            "date_from": start.isoformat(),
            "date_to": end.isoformat(),
            "as_of": end.isoformat(),
            "customers": [],
            "segments": [],
            "total": 0,
            "offset": 0,
            "sort": sort,
            "segment": segment,
        }

    scored = _scored_rows(rows, end)
    total_net = sum((row["net"] for row in scored), ZERO)
    scored.sort(
        key=lambda row: (row["net"], row["orders"], row["last"]),
        reverse=True,
    )
    segments = _segment_distribution(scored, total_net)

    # RFM scores and segments stay based on the full selection; the search only
    # narrows which rows are returned. That keeps a customer's score stable when
    # the palette opens one record by id.
    needle = (search or "").strip().casefold()
    visible = (
        [row for row in scored if needle in row["source_customer_id"].casefold()]
        if needle
        else scored
    )
    if segment:
        visible = [row for row in visible if row["segment"] == segment]

    ordering = {
        "net": (lambda row: -row["net"],),
        "orders": (lambda row: -row["orders"],),
        "recency": (lambda row: -row["recency_days"],),
        "last": (lambda row: -row["last"].toordinal(),),
        "customer": (lambda row: row["source_customer_id"].casefold(),),
    }
    chosen = ordering.get(sort, ordering["net"])
    visible.sort(key=lambda row: (*(fn(row) for fn in chosen), row["source_customer_id"]))
    total = len(visible)

    customers = [
        {
            "customer_id": str(row["customer_key"]),
            "source_customer_id": row["source_customer_id"],
            "dataset_id": str(row["dataset_id"]),
            "dataset_name": row["dataset_name"],
            "last_purchase": row["last"].isoformat(),
            "recency_days": row["recency_days"],
            "orders": row["orders"],
            "net_sales": money(row["net"]),
            "r": row["r"],
            "f": row["f"],
            "m": row["m"],
            "segment": row["segment"],
            "segment_label": SEGMENT_LABELS[row["segment"]],
        }
        for row in visible[offset : offset + limit]
    ]

    return {
        "has_data": True,
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "as_of": end.isoformat(),
        "customers": customers,
        "segments": segments,
        "total": total,
        "offset": offset,
        "sort": sort,
        "segment": segment,
    }


def customer_summary(
    *,
    organisation,
    dataset_id=None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict:
    facts = facts_for(organisation, dataset_id)
    start, end = resolve_period(facts, date_from, date_to)
    if start is None or end is None:
        return _empty_summary(None, None)

    rows = _customer_rows(facts, start, end)
    if not rows:
        return _empty_summary(start, end)

    total_net = sum((row["net"] for row in rows), ZERO)
    repeat = sum(1 for row in rows if row["orders"] >= 2)
    count = len(rows)
    cohorts, month_1 = _retention(facts, start, end)

    return {
        "has_data": True,
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "identifiable_customers": count,
        "repeat_customers": repeat,
        "repeat_purchase_rate": percent(Decimal(repeat) / count * 100),
        "average_orders": _decimal_string(Decimal(sum(row["orders"] for row in rows)) / count),
        "historical_value": money(total_net),
        "average_historical_value": money(total_net / count),
        "month_1_retention": month_1,
        "cohort_count": len(cohorts),
    }


def _empty_summary(start: date | None, end: date | None) -> dict:
    return {
        "has_data": False,
        "date_from": start.isoformat() if start else None,
        "date_to": end.isoformat() if end else None,
        "identifiable_customers": 0,
        "repeat_customers": 0,
        "repeat_purchase_rate": None,
        "average_orders": None,
        "historical_value": money(None),
        "average_historical_value": None,
        "month_1_retention": None,
        "cohort_count": 0,
    }


def _retention(facts: Facts, start: date, end: date) -> tuple[list[dict], str | None]:
    first_purchases = (
        facts.sales.filter(customer_key__isnull=False)
        .values("customer_key_id")
        .annotate(first=Min("date_key__date"))
    )

    cohorts: dict[int, list[int]] = defaultdict(list)
    for row in first_purchases:
        first = row["first"]
        if start <= first <= end:
            cohorts[_month_index(first.year, first.month)].append(row["customer_key_id"])

    if not cohorts:
        return [], None

    customer_ids = [customer for ids in cohorts.values() for customer in ids]
    activity_rows = (
        facts.sales.filter(customer_key_id__in=customer_ids, date_key__date__range=(start, end))
        .values_list("customer_key_id", "date_key__year", "date_key__month")
        .distinct()
    )

    active: dict[int, set[int]] = defaultdict(set)
    for customer_id, year, month in activity_rows:
        active[customer_id].add(_month_index(year, month))

    end_index = _month_index(end.year, end.month)
    cohorts_data: list[dict] = []
    for index in sorted(cohorts, reverse=True)[:12]:
        customers = cohorts[index]
        size = len(customers)
        months = []
        for offset in range(0, end_index - index + 1):
            target = index + offset
            retained = sum(1 for customer in customers if target in active[customer])
            months.append(
                {
                    "month_offset": offset,
                    "month": _month_key(target),
                    "customers": retained,
                    "rate": percent(Decimal(retained) / size * 100),
                }
            )
        cohorts_data.append(
            {
                "cohort": _month_key(index),
                "size": size,
                "months": months,
            }
        )

    eligible = [cohort for cohort in cohorts_data if len(cohort["months"]) > 1]
    if eligible:
        denominator = sum(cohort["size"] for cohort in eligible)
        numerator = sum(
            next(month["customers"] for month in cohort["months"] if month["month_offset"] == 1)
            for cohort in eligible
        )
        month_1 = percent(Decimal(numerator) / denominator * 100)
    else:
        month_1 = None

    return cohorts_data, month_1


def customer_retention(
    *,
    organisation,
    dataset_id=None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict:
    facts = facts_for(organisation, dataset_id)
    start, end = resolve_period(facts, date_from, date_to)
    if start is None or end is None:
        return {
            "has_data": False,
            "date_from": None,
            "date_to": None,
            "month_1_retention": None,
            "cohorts": [],
        }

    cohorts, month_1 = _retention(facts, start, end)
    return {
        "has_data": bool(cohorts),
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "month_1_retention": month_1,
        "cohorts": cohorts,
    }

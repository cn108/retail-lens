"""Deterministic synthetic retail transactions for demo workspaces.

The bundle ships a six-row sample CSV so upload, mapping and processing can be
tried in a minute, but a series that short cannot be forecast: a run needs
twelve monthly periods. This module builds a longer history — seasonal, slowly
growing, with two deliberate disruptions — so the analytics pages, the quality
report and the forecast can all be exercised without customer data.

Everything is derived from one seed, so the same arguments always produce the
same file. The rows are plain dictionaries; ``to_csv`` renders them in the
canonical source shape the upload endpoint expects.
"""

from __future__ import annotations

import csv
import io
import random
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

HEADERS = (
    "InvoiceNo",
    "LineNo",
    "InvoiceDate",
    "CustomerID",
    "StockCode",
    "Description",
    "Quantity",
    "UnitPrice",
    "Discount",
    "Country",
    "IsReturn",
)

# Demand shape: a quiet start to the year, a spring and autumn lift, and the
# November/December peak a retailer actually sees.
MONTH_SEASONALITY = {
    1: 0.84,
    2: 0.88,
    3: 0.95,
    4: 0.96,
    5: 1.02,
    6: 0.99,
    7: 1.01,
    8: 0.94,
    9: 1.03,
    10: 1.08,
    11: 1.32,
    12: 1.44,
}

# Weekend trade carries most of the volume in this kind of store.
WEEKDAY_SEASONALITY = {1: 0.92, 2: 0.95, 3: 0.98, 4: 1.04, 5: 1.14, 6: 1.28, 7: 1.06}

START_GROWTH = 0.82
END_GROWTH = 1.18

BASKET_SIZES = (1, 2, 3, 4, 5)
BASKET_WEIGHTS = (0.34, 0.31, 0.20, 0.10, 0.05)
QUANTITIES = (1, 2, 3, 4)
QUANTITY_WEIGHTS = (0.62, 0.24, 0.10, 0.04)
DISCOUNT_RATES = (Decimal("0.10"), Decimal("0.15"), Decimal("0.20"))
DISCOUNT_CHANCE = 0.12
ANONYMOUS_CHANCE = 0.04
RETURN_CHANCE = 0.03
RETURN_DELAY_DAYS = (2, 9)

CUSTOMER_COUNT = 320
CUSTOMER_COUNTRY_WEIGHTS = (
    ("United Kingdom", 0.62),
    ("Germany", 0.09),
    ("France", 0.08),
    ("Ireland", 0.06),
    ("Netherlands", 0.05),
    ("Spain", 0.05),
    ("Italy", 0.05),
)


@dataclass(frozen=True)
class Product:
    code: str
    description: str
    price: Decimal
    weight: float


CATALOGUE = (
    Product("SKU-100", "Canvas tote", Decimal("18.50"), 1.6),
    Product("SKU-101", "Leather wallet", Decimal("42.00"), 1.2),
    Product("SKU-102", "Wool scarf", Decimal("24.00"), 1.1),
    Product("SKU-103", "Travel mug", Decimal("16.00"), 1.4),
    Product("SKU-104", "Merino socks", Decimal("12.50"), 1.8),
    Product("SKU-105", "Cotton shirt", Decimal("38.00"), 1.3),
    Product("SKU-106", "Denim jacket", Decimal("89.00"), 0.5),
    Product("SKU-107", "Rain coat", Decimal("110.00"), 0.4),
    Product("SKU-108", "Knit beanie", Decimal("14.00"), 1.5),
    Product("SKU-109", "Leather belt", Decimal("29.00"), 1.0),
    Product("SKU-110", "Crossbody bag", Decimal("68.00"), 0.7),
    Product("SKU-111", "Silk tie", Decimal("34.00"), 0.6),
    Product("SKU-112", "Linen trousers", Decimal("74.00"), 0.4),
    Product("SKU-113", "Suede boots", Decimal("145.00"), 0.3),
    Product("SKU-114", "Running socks", Decimal("11.00"), 1.7),
    Product("SKU-115", "Baseball cap", Decimal("21.00"), 1.1),
    Product("SKU-116", "Quilted gilet", Decimal("98.00"), 0.4),
    Product("SKU-117", "Cashmere jumper", Decimal("165.00"), 0.2),
    Product("SKU-118", "Leather gloves", Decimal("46.00"), 0.6),
    Product("SKU-119", "Weekend holdall", Decimal("128.00"), 0.3),
    Product("SKU-120", "Umbrella", Decimal("26.00"), 0.9),
    Product("SKU-121", "Card holder", Decimal("22.00"), 1.2),
    Product("SKU-122", "Pyjama set", Decimal("52.00"), 0.7),
    Product("SKU-123", "Sun hat", Decimal("27.00"), 0.5),
)

# Two disruptions the forecast is expected to flag: a promotion month and a
# month lost to a stock-out. Each replaces a whole month's level with a multiple
# of the window's average day, because the detector scores monthly totals — a
# disruption straddling two months, or one scaled by calendar seasonality, is
# diluted back inside the fences. The position is a fraction of the window.
ANOMALY_SPECS = (
    ("promotion", 0.30, 2.1),
    ("stock-out", 0.55, 0.18),
)


@dataclass(frozen=True)
class AnomalyWindow:
    kind: str
    start: date
    end: date
    multiplier: float


@dataclass(frozen=True)
class SyntheticHistory:
    start: date
    end: date
    rows: list[dict]
    anomalies: list[AnomalyWindow]


@dataclass(frozen=True)
class Customer:
    code: str
    country: str
    weight: float


def add_months(value: date, months: int) -> date:
    """Shift a month-start date by whole months."""
    index = value.year * 12 + (value.month - 1) + months
    year, month = divmod(index, 12)
    return date(year, month + 1, 1)


def month_starts(start: date, months: int) -> list[date]:
    return [add_months(start, index) for index in range(months)]


def _customers(rng: random.Random) -> list[Customer]:
    countries = [country for country, _ in CUSTOMER_COUNTRY_WEIGHTS]
    weights = [weight for _, weight in CUSTOMER_COUNTRY_WEIGHTS]
    customers = []
    for index in range(CUSTOMER_COUNT):
        # A heavy tail gives a realistic mix of one-off and loyal shoppers.
        customers.append(
            Customer(
                code=f"C-{index + 1:04d}",
                country=rng.choices(countries, weights=weights, k=1)[0],
                weight=rng.paretovariate(1.4),
            )
        )
    return customers


def _anomaly_months(
    start: date, months: int
) -> tuple[dict[tuple[int, int], float], list[AnomalyWindow]]:
    levels: dict[tuple[int, int], float] = {}
    windows: list[AnomalyWindow] = []
    for kind, position, level in ANOMALY_SPECS:
        index = max(0, min(months - 1, int(months * position)))
        month_start = add_months(start, index)
        month_end = add_months(month_start, 1) - timedelta(days=1)
        levels[(month_start.year, month_start.month)] = level
        windows.append(AnomalyWindow(kind, month_start, month_end, level))
    return levels, windows


def _money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"))


def build_transactions(
    *, start: date, months: int, orders_per_day: int = 6, seed: int = 20240101
) -> SyntheticHistory:
    """Build ``months`` of daily transactions ending with the last full month.

    ``start`` must be the first day of the first month to generate. Volume
    follows a yearly pattern, a weekday pattern and a slow upward trend, with
    two disrupted months replacing the normal level.
    """
    if start.day != 1:
        raise ValueError("start must be the first day of a month")
    if months < 1:
        raise ValueError("months must be at least 1")

    end = add_months(start, months) - timedelta(days=1)
    total_days = (end - start).days + 1
    levels, windows = _anomaly_months(start, months)
    days = [start + timedelta(days=offset) for offset in range(total_days)]
    trend = {}
    for offset, day in enumerate(days):
        growth = START_GROWTH + (END_GROWTH - START_GROWTH) * offset / max(1, total_days - 1)
        trend[day] = growth * MONTH_SEASONALITY[day.month]
    average_trend = sum(trend.values()) / total_days

    rng = random.Random(seed)
    customers = _customers(rng)
    customer_codes = [customer.code for customer in customers]
    customer_weights = [customer.weight for customer in customers]
    countries = {customer.code: customer.country for customer in customers}
    product_codes = [product.code for product in CATALOGUE]
    product_weights = [product.weight for product in CATALOGUE]
    products = {product.code: product for product in CATALOGUE}

    rows: list[dict] = []
    invoice_sequence = 0
    credit_sequence = 0

    for day in days:
        level = levels.get((day.year, day.month))
        base = average_trend * level if level is not None else trend[day]
        factor = base * WEEKDAY_SEASONALITY[day.isoweekday()]
        orders = max(0, round(orders_per_day * factor * rng.uniform(0.9, 1.1)))

        for _ in range(orders):
            invoice_sequence += 1
            invoice_id = f"INV-{invoice_sequence:06d}"
            anonymous = rng.random() < ANONYMOUS_CHANCE
            customer_code = (
                "" if anonymous else rng.choices(customer_codes, weights=customer_weights, k=1)[0]
            )
            country = "" if anonymous else countries[customer_code]
            basket = rng.choices(BASKET_SIZES, weights=BASKET_WEIGHTS, k=1)[0]

            for line_number in range(1, basket + 1):
                product = products[rng.choices(product_codes, weights=product_weights, k=1)[0]]
                quantity = rng.choices(QUANTITIES, weights=QUANTITY_WEIGHTS, k=1)[0]
                gross = product.price * quantity
                discount = Decimal("0.00")
                if rng.random() < DISCOUNT_CHANCE:
                    discount = _money(gross * rng.choice(DISCOUNT_RATES))
                rows.append(
                    {
                        "invoice_id": invoice_id,
                        "line_id": str(line_number),
                        "invoice_date": day,
                        "customer_id": customer_code,
                        "product_code": product.code,
                        "description": product.description,
                        "quantity": quantity,
                        "unit_price": product.price,
                        "discount": discount,
                        "country": country,
                        "is_return": False,
                    }
                )

            if rng.random() < RETURN_CHANCE:
                credit_sequence += 1
                delay = rng.randint(*RETURN_DELAY_DAYS)
                product = products[rng.choices(product_codes, weights=product_weights, k=1)[0]]
                rows.append(
                    {
                        "invoice_id": f"CRN-{credit_sequence:06d}",
                        "line_id": "1",
                        "invoice_date": min(day + timedelta(days=delay), end),
                        "customer_id": customer_code,
                        "product_code": product.code,
                        "description": product.description,
                        "quantity": -rng.choices(QUANTITIES[:2], weights=(0.8, 0.2), k=1)[0],
                        "unit_price": product.price,
                        "discount": Decimal("0.00"),
                        "country": country,
                        "is_return": True,
                    }
                )

    rows.sort(key=lambda row: (row["invoice_date"], row["invoice_id"], row["line_id"]))
    return SyntheticHistory(start=start, end=end, rows=rows, anomalies=windows)


def to_csv(rows: list[dict]) -> str:
    """Render rows as the canonical source CSV, with ISO dates."""
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(HEADERS)
    for row in rows:
        writer.writerow(
            (
                row["invoice_id"],
                row["line_id"],
                row["invoice_date"].isoformat(),
                row["customer_id"],
                row["product_code"],
                row["description"],
                row["quantity"],
                f"{row['unit_price']:.2f}",
                f"{row['discount']:.2f}",
                row["country"],
                "true" if row["is_return"] else "false",
            )
        )
    return buffer.getvalue()

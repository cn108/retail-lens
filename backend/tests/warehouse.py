"""Warehouse fixture helpers for the M7 analytics tests."""

import uuid
from datetime import date
from decimal import Decimal

from apps.datasets.models import Dataset, DatasetImport, DatasetStatus
from apps.ingestion.models import (
    DimCustomer,
    DimDate,
    DimGeography,
    DimProduct,
    FactReturn,
    FactSales,
)


def warehouse(organisation, name="Sales"):
    dataset = Dataset.objects.create(
        organisation=organisation, name=name, status=DatasetStatus.READY
    )
    record = DatasetImport.objects.create(
        dataset=dataset,
        file=f"datasets/{uuid.uuid4().hex}.csv",
        original_filename="sales.csv",
        size_bytes=10,
        checksum_sha256=uuid.uuid4().hex + uuid.uuid4().hex,
        encoding="utf-8",
        delimiter=",",
        row_count=1,
        column_count=1,
    )
    dataset.current_import = record
    dataset.save(update_fields=["current_import"])
    return dataset


def dim_date(value: date) -> DimDate:
    iso = value.isocalendar()
    return DimDate.objects.get_or_create(
        date=value,
        defaults={
            "year": value.year,
            "quarter": (value.month - 1) // 3 + 1,
            "month": value.month,
            "day": value.day,
            "iso_year": iso.year,
            "iso_week": iso.week,
            "day_of_week": value.isoweekday(),
        },
    )[0]


def add_line(
    dataset,
    *,
    when: date,
    invoice: str,
    quantity: int,
    price: str = "10.00",
    customer: str | None = None,
    discount: str | None = None,
    net: str | None = None,
    product: str = "SKU-1",
    description: str = "",
    line: str | None = None,
    country: str | None = None,
):
    unit_price = Decimal(price)
    discount_amount = Decimal(discount) if discount is not None else None
    gross = unit_price * quantity
    if net is not None:
        net_amount = Decimal(net)
    elif discount_amount is None:
        net_amount = gross
    elif quantity > 0:
        net_amount = gross - discount_amount
    else:
        net_amount = gross + discount_amount

    customer_key = (
        DimCustomer.objects.get_or_create(dataset=dataset, source_customer_id=customer)[0]
        if customer
        else None
    )
    product_key, _ = DimProduct.objects.get_or_create(
        dataset=dataset,
        source_product_code=product,
        defaults={"description": description},
    )
    geography_key = (
        DimGeography.objects.get_or_create(dataset=dataset, country=country)[0] if country else None
    )
    model = FactReturn if quantity < 0 else FactSales
    return model.objects.create(
        dataset=dataset,
        import_record=dataset.current_import,
        date_key=dim_date(when),
        customer_key=customer_key,
        product_key=product_key,
        geography_key=geography_key,
        quantity=quantity,
        unit_price=unit_price,
        gross_line_amount=gross,
        discount_amount=discount_amount,
        net_line_amount=net_amount,
        source_invoice_id=invoice,
        source_line_identifier=line or uuid.uuid4().hex,
        source_row_number=1,
    )

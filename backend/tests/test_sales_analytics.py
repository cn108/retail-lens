import uuid
from datetime import date
from decimal import Decimal

import pytest
from django.urls import reverse

from apps.datasets.models import Dataset, DatasetImport, DatasetStatus
from apps.ingestion.models import (
    DimCustomer,
    DimDate,
    DimProduct,
    FactReturn,
    FactSales,
)
from apps.organisations.services import create_organisation


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
    line: str | None = None,
):
    """Create one fact line with the same arithmetic the ETL applies."""
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
    product_key = DimProduct.objects.get_or_create(dataset=dataset, source_product_code=product)[0]
    model = FactReturn if quantity < 0 else FactSales
    return model.objects.create(
        dataset=dataset,
        import_record=dataset.current_import,
        date_key=dim_date(when),
        customer_key=customer_key,
        product_key=product_key,
        quantity=quantity,
        unit_price=unit_price,
        gross_line_amount=gross,
        discount_amount=discount_amount,
        net_line_amount=net_amount,
        source_invoice_id=invoice,
        source_line_identifier=line or uuid.uuid4().hex,
        source_row_number=model.objects.count() + 1,
    )


def get_summary(client, **params):
    return client.get(reverse("sales-summary"), params)


def get_trend(client, **params):
    return client.get(reverse("sales-trend"), params)


@pytest.mark.django_db
def test_summary_computes_the_registered_metrics(auth_client, organisation):
    dataset = warehouse(organisation)
    # Prior, equal-length period: 5 Jan to 9 Jan.
    add_line(dataset, when=date(2024, 1, 6), invoice="INV-0", quantity=2, net="20.00")
    # Current period: 10 Jan to 14 Jan.
    add_line(
        dataset,
        when=date(2024, 1, 10),
        invoice="INV-1",
        quantity=2,
        customer="C-1",
        discount="2.00",
    )
    add_line(
        dataset,
        when=date(2024, 1, 11),
        invoice="INV-1",
        quantity=1,
        customer="C-1",
    )
    add_line(dataset, when=date(2024, 1, 12), invoice="INV-2", quantity=3, price="5.00")
    add_line(
        dataset,
        when=date(2024, 1, 13),
        invoice="INV-3",
        quantity=-1,
        customer="C-2",
        net="-10.00",
    )
    add_line(
        dataset,
        when=date(2024, 1, 14),
        invoice="INV-4",
        quantity=1,
        customer="C-1",
    )

    response = get_summary(auth_client, date_from="2024-01-10", date_to="2024-01-14")

    assert response.status_code == 200
    data = response.json()
    assert data["has_data"] is True
    assert data["date_from"] == "2024-01-10"
    assert data["date_to"] == "2024-01-14"
    assert data["comparison_date_from"] == "2024-01-05"
    assert data["comparison_date_to"] == "2024-01-09"
    assert data["gross_sales"] == "55.0000"
    assert data["net_sales"] == "43.0000"
    assert data["eligible_orders"] == 3
    assert data["average_order_value"] == "14.3333"
    # C-2 appears only on a return, so has no eligible purchase.
    assert data["unique_customers"] == 1
    assert data["previous_net_sales"] == "20.0000"
    assert data["sales_growth_percent"] == "115.00"
    assert data["datasets"] == [{"id": str(dataset.id), "name": "Sales"}]


@pytest.mark.django_db
def test_invoices_and_customers_are_counted_per_dataset(auth_client, organisation):
    first = warehouse(organisation, "First")
    second = warehouse(organisation, "Second")
    for dataset in (first, second):
        add_line(
            dataset,
            when=date(2024, 2, 1),
            invoice="INV-1",
            quantity=1,
            customer="C-1",
        )

    data = get_summary(auth_client).json()

    assert data["net_sales"] == "20.0000"
    assert data["eligible_orders"] == 2
    assert data["unique_customers"] == 2
    assert {item["name"] for item in data["datasets"]} == {"First", "Second"}


@pytest.mark.django_db
def test_summary_and_trend_are_organisation_scoped(auth_client, organisation, other_user):
    own = warehouse(organisation)
    add_line(own, when=date(2024, 3, 1), invoice="INV-1", quantity=1)
    other_org = create_organisation(name="Elsewhere", owner=other_user)
    foreign = warehouse(other_org)
    add_line(foreign, when=date(2024, 3, 1), invoice="INV-1", quantity=9, net="90.00")

    summary = get_summary(auth_client).json()
    trend = get_trend(auth_client).json()

    assert summary["net_sales"] == "10.0000"
    assert summary["datasets"] == [{"id": str(own.id), "name": "Sales"}]
    assert [point["net_sales"] for point in trend["points"]] == ["10.0000"]

    filtered = get_summary(auth_client, dataset=str(foreign.id))
    assert filtered.status_code == 404


@pytest.mark.django_db
def test_date_filters_bound_the_metrics(auth_client, organisation):
    dataset = warehouse(organisation)
    add_line(dataset, when=date(2023, 12, 31), invoice="INV-DEC", quantity=1)
    add_line(dataset, when=date(2024, 1, 1), invoice="INV-JAN", quantity=2)

    data = get_summary(auth_client, date_from="2024-01-01", date_to="2024-01-31").json()

    assert data["net_sales"] == "20.0000"
    assert data["eligible_orders"] == 1
    assert data["date_from"] == "2024-01-01"
    assert data["date_to"] == "2024-01-31"


@pytest.mark.django_db
def test_monthly_trend_includes_returns_in_their_period(auth_client, organisation):
    dataset = warehouse(organisation)
    add_line(dataset, when=date(2024, 1, 5), invoice="INV-1", quantity=2, net="20.00")
    add_line(
        dataset,
        when=date(2024, 1, 20),
        invoice="INV-1",
        quantity=-1,
        net="-5.00",
    )
    add_line(dataset, when=date(2024, 2, 3), invoice="INV-2", quantity=3, net="30.00")

    data = get_trend(auth_client, granularity="month").json()

    assert data["has_data"] is True
    assert data["granularity"] == "month"
    assert [point["label"] for point in data["points"]] == ["Jan 2024", "Feb 2024"]
    january = data["points"][0]
    assert january["period_start"] == "2024-01-01"
    assert january["period_end"] == "2024-01-31"
    assert january["gross_sales"] == "20.0000"
    assert january["net_sales"] == "15.0000"
    assert january["orders"] == 1
    assert data["points"][1]["net_sales"] == "30.0000"


@pytest.mark.django_db
def test_trend_supports_day_and_iso_week_buckets(auth_client, organisation):
    dataset = warehouse(organisation)
    add_line(dataset, when=date(2024, 1, 1), invoice="INV-1", quantity=1)
    add_line(dataset, when=date(2024, 1, 8), invoice="INV-2", quantity=1)
    add_line(dataset, when=date(2024, 1, 9), invoice="INV-2", quantity=-1, net="-5.00")

    weekly = get_trend(auth_client, granularity="week").json()
    daily = get_trend(auth_client, granularity="day").json()

    assert [point["label"] for point in weekly["points"]] == [
        "Week of 01 Jan 2024",
        "Week of 08 Jan 2024",
    ]
    assert weekly["points"][1]["net_sales"] == "5.0000"
    assert weekly["points"][1]["orders"] == 1
    assert len(daily["points"]) == 3
    assert daily["points"][-1]["net_sales"] == "-5.0000"


@pytest.mark.django_db
def test_no_warehouse_data_returns_an_explicit_empty_state(auth_client, organisation):
    summary = get_summary(auth_client)
    trend = get_trend(auth_client)

    assert summary.status_code == 200
    assert summary.json() == {
        "has_data": False,
        "date_from": None,
        "date_to": None,
        "comparison_date_from": None,
        "comparison_date_to": None,
        "gross_sales": "0.0000",
        "net_sales": "0.0000",
        "eligible_orders": 0,
        "average_order_value": None,
        "unique_customers": 0,
        "sales_growth_percent": None,
        "previous_net_sales": "0.0000",
        "datasets": [],
    }
    assert trend.json() == {
        "granularity": "month",
        "has_data": False,
        "date_from": None,
        "date_to": None,
        "points": [],
        "compare": None,
        "comparison": None,
    }


@pytest.mark.django_db
def test_growth_is_null_without_a_positive_prior_period(auth_client, organisation):
    dataset = warehouse(organisation)
    add_line(dataset, when=date(2024, 4, 10), invoice="INV-1", quantity=1)

    data = get_summary(auth_client, date_from="2024-04-10", date_to="2024-04-14").json()

    assert data["has_data"] is True
    assert data["previous_net_sales"] == "0.0000"
    assert data["sales_growth_percent"] is None


@pytest.mark.django_db
def test_returns_alone_are_counted_without_an_order(auth_client, organisation):
    dataset = warehouse(organisation)
    add_line(
        dataset,
        when=date(2024, 5, 2),
        invoice="INV-R",
        quantity=-2,
        net="-20.00",
    )

    data = get_summary(auth_client).json()

    assert data["has_data"] is True
    assert data["gross_sales"] == "0.0000"
    assert data["net_sales"] == "-20.0000"
    assert data["eligible_orders"] == 0
    assert data["average_order_value"] is None
    assert data["unique_customers"] == 0


@pytest.mark.django_db
def test_invalid_parameters_are_rejected(auth_client, organisation):
    reversed_range = get_summary(auth_client, date_from="2024-02-01", date_to="2024-01-01")
    assert reversed_range.status_code == 400
    assert "date_from" in reversed_range.json()["error"]["fields"]

    bad_date = get_summary(auth_client, date_from="01/02/2024")
    assert bad_date.status_code == 400

    bad_granularity = get_trend(auth_client, granularity="year")
    assert bad_granularity.status_code == 400
    assert "granularity" in bad_granularity.json()["error"]["fields"]

    bad_dataset = get_summary(auth_client, dataset="not-a-uuid")
    assert bad_dataset.status_code == 400
    assert "dataset" in bad_dataset.json()["error"]["fields"]


@pytest.mark.django_db
def test_viewers_can_read_analytics(api_for, member, organisation):
    dataset = warehouse(organisation)
    add_line(dataset, when=date(2024, 6, 1), invoice="INV-1", quantity=1)

    response = get_summary(api_for(member.user))

    assert response.status_code == 200
    assert response.json()["net_sales"] == "10.0000"


@pytest.mark.django_db
def test_anonymous_access_is_rejected(api_client):
    assert get_summary(api_client).status_code == 401
    assert get_trend(api_client).status_code == 401

from datetime import date

import pytest
from django.urls import reverse

from apps.organisations.services import create_organisation
from tests.warehouse import add_line, warehouse


def seed(organisation):
    dataset = warehouse(organisation)
    add_line(
        dataset,
        when=date(2024, 3, 1),
        invoice="INV-1",
        quantity=2,
        price="10.00",
        customer="C-1",
        product="SKU-1",
        description="Widget",
        country="United Kingdom",
        net="20.00",
        line="1",
    )
    add_line(
        dataset,
        when=date(2024, 3, 1),
        invoice="INV-1",
        quantity=1,
        price="30.00",
        customer="C-1",
        product="SKU-2",
        description="Gadget",
        country="United Kingdom",
        net="30.00",
        line="2",
    )
    add_line(
        dataset,
        when=date(2024, 3, 2),
        invoice="INV-2",
        quantity=1,
        price="50.00",
        customer="C-2",
        product="SKU-2",
        description="Gadget",
        country="France",
        net="50.00",
        line="1",
    )
    add_line(
        dataset,
        when=date(2024, 3, 3),
        invoice="INV-3",
        quantity=-1,
        price="10.00",
        customer="C-1",
        product="SKU-1",
        country="United Kingdom",
        net="-10.00",
        line="1",
    )
    # Prior period, same calendar dates one year earlier.
    add_line(
        dataset,
        when=date(2023, 3, 1),
        invoice="INV-0",
        quantity=1,
        price="25.00",
        product="SKU-1",
        country="United Kingdom",
        net="25.00",
        line="1",
    )
    return dataset


@pytest.mark.django_db
def test_geography_performance_groups_countries_and_reconciles(auth_client, organisation):
    seed(organisation)
    data = auth_client.get(
        reverse("geography-performance"), {"date_from": "2024-03-01", "date_to": "2024-03-03"}
    ).json()

    assert data["has_data"] is True
    assert data["country_count"] == 2
    rows = {row["country"]: row for row in data["rows"]}
    # United Kingdom: 20 + 30 sales, 10 returned.
    assert rows["United Kingdom"]["net_sales"] == "40.0000"
    assert rows["United Kingdom"]["returned_units"] == 1
    assert rows["France"]["net_sales"] == "50.0000"
    assert rows["France"]["share"] == "55.56"
    assert data["net_sales"] == "90.0000"
    assert data["comparison_date_from"] == "2024-02-27"
    assert data["comparison_date_to"] == "2024-02-29"


@pytest.mark.django_db
def test_geography_rows_without_country_are_unassigned(auth_client, organisation):
    dataset = warehouse(organisation)
    add_line(dataset, when=date(2024, 3, 1), invoice="INV-1", quantity=1, net="10.00")

    row = auth_client.get(reverse("geography-performance")).json()["rows"][0]

    assert row["country"] == "Unassigned"
    assert row["net_sales"] == "10.0000"


@pytest.mark.django_db
def test_comparison_can_use_the_same_dates_last_year(auth_client, organisation):
    seed(organisation)
    data = auth_client.get(
        reverse("sales-summary"),
        {
            "date_from": "2024-03-01",
            "date_to": "2024-03-03",
            "compare": "year",
        },
    ).json()

    assert data["compare"] == "year"
    assert data["comparison_date_from"] == "2023-03-01"
    assert data["comparison_date_to"] == "2023-03-03"
    assert data["previous_net_sales"] == "25.0000"
    assert data["sales_growth_percent"] == "260.00"


@pytest.mark.django_db
def test_custom_comparison_requires_both_dates(auth_client, organisation):
    seed(organisation)
    response = auth_client.get(reverse("sales-summary"), {"compare": "custom"})

    assert response.status_code == 400
    assert "compare_from" in str(response.json())


@pytest.mark.django_db
def test_returns_analysis_reports_rate_discounts_and_bridge(auth_client, organisation):
    dataset = warehouse(organisation)
    add_line(
        dataset,
        when=date(2024, 3, 1),
        invoice="INV-1",
        quantity=4,
        price="10.00",
        discount="4.00",
        net="36.00",
        product="SKU-1",
        country="United Kingdom",
        line="1",
    )
    add_line(
        dataset,
        when=date(2024, 3, 2),
        invoice="INV-2",
        quantity=-1,
        price="10.00",
        net="-10.00",
        product="SKU-1",
        country="United Kingdom",
        line="1",
    )

    data = auth_client.get(reverse("returns-analysis")).json()

    assert data["sold_units"] == 4
    assert data["returned_units"] == 1
    assert data["return_rate"] == "25.00"
    assert data["gross_sales"] == "40.0000"
    assert data["discount_total"] == "4.0000"
    assert data["discount_rate"] == "10.00"
    assert data["net_sales"] == "26.0000"
    assert {entry["label"]: entry["amount"] for entry in data["bridge"]} == {
        "Gross sales": "40.0000",
        "Discounts": "-4.0000",
        "Returns": "-10.0000",
        "Net sales": "26.0000",
    }
    assert data["products"][0]["source_product_code"] == "SKU-1"
    assert data["countries"][0]["country"] == "United Kingdom"


@pytest.mark.django_db
def test_basket_analysis_ranks_co_purchased_pairs(auth_client, organisation):
    seed(organisation)
    data = auth_client.get(reverse("basket-analysis")).json()

    assert data["invoices"] == 3
    pair = data["pairs"][0]
    assert {pair["product_a"]["source_product_code"], pair["product_b"]["source_product_code"]} == {
        "SKU-1",
        "SKU-2",
    }
    assert pair["invoices"] == 1
    assert pair["support"] == "33.33"
    assert pair["lift"] is not None


@pytest.mark.django_db
def test_product_detail_returns_trend_buyers_and_share(auth_client, organisation):
    seed(organisation)
    rows = auth_client.get(reverse("product-performance")).json()["rows"]
    product_id = next(row["product_id"] for row in rows if row["source_product_code"] == "SKU-2")

    data = auth_client.get(
        reverse("product-detail", args=[product_id]),
        {"date_from": "2024-03-01", "date_to": "2024-03-03"},
    ).json()

    assert data["has_data"] is True
    assert data["product"]["source_product_code"] == "SKU-2"
    assert data["net_sales"] == "80.0000"
    assert data["units"] == 2
    assert data["orders"] == 2
    assert data["share"] == "88.89"
    assert [row["month"] for row in data["trend"]] == ["2024-03"]
    assert {row["source_customer_id"] for row in data["customers"]} == {"C-1", "C-2"}
    assert {row["country"] for row in data["countries"]} == {"United Kingdom", "France"}


@pytest.mark.django_db
def test_product_detail_is_organisation_scoped(auth_client, other_user):
    other_org = create_organisation(name="Elsewhere", owner=other_user)
    dataset = warehouse(other_org)
    add_line(
        dataset,
        when=date(2024, 3, 1),
        invoice="INV-X",
        quantity=1,
        product="SKU-X",
        net="10.00",
    )
    from apps.ingestion.models import DimProduct

    foreign = DimProduct.objects.get(dataset=dataset)

    assert auth_client.get(reverse("product-detail", args=[foreign.id])).status_code == 404


@pytest.mark.django_db
def test_quality_summary_counts_reasons_and_rejected_rows(auth_client, organisation):
    dataset = warehouse(organisation)
    from apps.ingestion.models import DataQualityIssue, IssueCode

    DataQualityIssue.objects.create(
        dataset=dataset, row_number=1, code=IssueCode.INVALID_PRICE, message="bad price"
    )
    DataQualityIssue.objects.create(
        dataset=dataset, row_number=2, code=IssueCode.INVALID_PRICE, message="bad price"
    )
    DataQualityIssue.objects.create(
        dataset=dataset, row_number=3, code=IssueCode.MISSING_PRODUCT, message="no product"
    )

    data = auth_client.get(reverse("quality-summary")).json()

    assert data["dataset_count"] == 1
    assert data["open_issues"] == 3
    assert data["reasons"][0] == {"code": "invalid_price", "count": 2}
    assert data["datasets"][0]["dataset_id"] == str(dataset.id)


@pytest.mark.django_db
def test_anomaly_can_be_annotated_and_acknowledged(auth_client, organisation):
    from apps.forecasting.models import ForecastAnomaly, ForecastRun

    dataset = warehouse(organisation)
    run = ForecastRun.objects.create(
        organisation=organisation,
        dataset=dataset,
        status="succeeded",
        horizon=3,
        model_name="holt-linear",
        model_version="holt-linear-v1",
        anomaly_method="iqr",
    )
    anomaly = ForecastAnomaly.objects.create(
        run=run,
        observed_date=date(2024, 3, 1),
        observed_amount="2000.0000",
        expected_amount="1100.0000",
        deviation_amount="900.0000",
        score="3.100",
        direction="above",
    )

    response = auth_client.patch(
        reverse("forecast-anomaly-triage", args=[run.id, anomaly.id]),
        {"note": "Black Friday promotion", "acknowledged": True},
        format="json",
    )

    assert response.status_code == 200
    assert response.json()["note"] == "Black Friday promotion"
    anomaly.refresh_from_db()
    assert anomaly.acknowledged_at is not None

    undo = auth_client.patch(
        reverse("forecast-anomaly-triage", args=[run.id, anomaly.id]),
        {"acknowledged": False},
        format="json",
    )
    assert undo.json()["note"] == "Black Friday promotion"
    assert undo.json()["acknowledged_at"] is None

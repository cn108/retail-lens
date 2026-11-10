from datetime import date

import pytest
from django.urls import reverse

from apps.organisations.services import create_organisation
from tests.warehouse import add_line, warehouse


def get(client, **params):
    return client.get(reverse("product-performance"), params)


@pytest.mark.django_db
def test_product_performance_compares_with_the_prior_period(auth_client, organisation):
    dataset = warehouse(organisation)
    # Prior period: 1 Feb to 29 Feb 2024.
    add_line(
        dataset,
        when=date(2024, 2, 5),
        invoice="INV-F1",
        quantity=5,
        product="SKU-1",
        description="Widget",
        net="50.00",
    )
    add_line(
        dataset,
        when=date(2024, 2, 6),
        invoice="INV-F2",
        quantity=2,
        product="SKU-2",
        description="Gadget",
        net="20.00",
    )
    # Current period: 1 Mar to 31 Mar 2024.
    add_line(
        dataset,
        when=date(2024, 3, 5),
        invoice="INV-M1",
        quantity=2,
        product="SKU-1",
        description="Widget",
        net="20.00",
    )
    add_line(
        dataset,
        when=date(2024, 3, 6),
        invoice="INV-M2",
        quantity=1,
        price="30.00",
        product="SKU-2",
        description="Gadget",
        net="30.00",
    )
    add_line(
        dataset,
        when=date(2024, 3, 7),
        invoice="INV-M3",
        quantity=-1,
        product="SKU-2",
        net="-10.00",
    )
    add_line(
        dataset,
        when=date(2024, 3, 8),
        invoice="INV-M4",
        quantity=5,
        price="1.00",
        product="SKU-3",
        description="Thing",
        net="5.00",
    )

    response = get(
        auth_client,
        date_from="2024-03-01",
        date_to="2024-03-31",
    )

    assert response.status_code == 200
    data = response.json()
    assert data["has_data"] is True
    assert data["comparison_date_from"] == "2024-01-30"
    assert data["comparison_date_to"] == "2024-02-29"
    assert data["net_sales"] == "45.0000"
    assert data["product_count"] == 3
    assert data["top_product_share"] == "44.44"
    assert data["declining_products"] == 1

    rows = {row["source_product_code"]: row for row in data["rows"]}
    assert rows["SKU-1"]["direction"] == "declining"
    assert rows["SKU-1"]["change_percent"] == "-60.00"
    assert rows["SKU-1"]["net_sales"] == "20.0000"
    assert rows["SKU-1"]["orders"] == 1
    assert rows["SKU-1"]["description"] == "Widget"

    gadget = rows["SKU-2"]
    assert gadget["direction"] == "stable"
    assert gadget["change_percent"] == "0.00"
    assert gadget["net_sales"] == "20.0000"
    assert gadget["gross_sales"] == "30.0000"
    assert gadget["units"] == 0
    assert gadget["returned_units"] == 1
    assert gadget["return_lines"] == 1

    thing = rows["SKU-3"]
    assert thing["direction"] == "new"
    assert thing["change_percent"] is None
    assert thing["share"] == "11.11"


@pytest.mark.django_db
def test_direction_thresholds_are_twenty_percent(auth_client, organisation):
    dataset = warehouse(organisation)
    for code in ("SKU-DOWN", "SKU-UP", "SKU-FLAT"):
        add_line(
            dataset,
            when=date(2024, 2, 1),
            invoice=f"INV-{code}",
            quantity=1,
            product=code,
            net="10.00",
        )
    add_line(
        dataset,
        when=date(2024, 3, 1),
        invoice="INV-DOWN",
        quantity=1,
        product="SKU-DOWN",
        net="8.00",
    )
    add_line(
        dataset,
        when=date(2024, 3, 1),
        invoice="INV-UP",
        quantity=1,
        product="SKU-UP",
        net="12.00",
    )
    add_line(
        dataset,
        when=date(2024, 3, 1),
        invoice="INV-FLAT",
        quantity=1,
        product="SKU-FLAT",
        net="9.00",
    )

    rows = {
        row["source_product_code"]: row
        for row in get(auth_client, date_from="2024-03-01", date_to="2024-03-31").json()["rows"]
    }

    assert rows["SKU-DOWN"]["direction"] == "declining"
    assert rows["SKU-DOWN"]["change_percent"] == "-20.00"
    assert rows["SKU-UP"]["direction"] == "growing"
    assert rows["SKU-UP"]["change_percent"] == "20.00"
    assert rows["SKU-FLAT"]["direction"] == "stable"


@pytest.mark.django_db
def test_returns_only_product_is_not_labelled_new(auth_client, organisation):
    dataset = warehouse(organisation)
    add_line(
        dataset,
        when=date(2024, 3, 1),
        invoice="INV-R",
        quantity=-1,
        product="SKU-R",
        net="-10.00",
    )

    row = get(auth_client).json()["rows"][0]

    assert row["direction"] == "returns"
    assert row["change_percent"] is None
    assert row["net_sales"] == "-10.0000"


@pytest.mark.django_db
def test_product_limit_keeps_totals_over_all_products(auth_client, organisation):
    dataset = warehouse(organisation)
    for index, code in enumerate(("SKU-1", "SKU-2", "SKU-3"), start=1):
        add_line(
            dataset,
            when=date(2024, 3, index),
            invoice=f"INV-{index}",
            quantity=index,
            product=code,
            net=str(index * 10),
        )

    data = get(auth_client, limit="1").json()

    assert len(data["rows"]) == 1
    assert data["product_count"] == 3
    assert data["net_sales"] == "60.0000"


@pytest.mark.django_db
def test_product_search_narrows_rows_but_keeps_totals(auth_client, organisation):
    dataset = warehouse(organisation)
    add_line(
        dataset,
        when=date(2024, 3, 1),
        invoice="INV-1",
        quantity=2,
        product="SKU-1",
        description="Blue widget",
        net="20.00",
    )
    add_line(
        dataset,
        when=date(2024, 3, 2),
        invoice="INV-2",
        quantity=1,
        product="SKU-2",
        description="Red gadget",
        net="30.00",
    )

    data = get(auth_client, search="gadget").json()

    assert [row["source_product_code"] for row in data["rows"]] == ["SKU-2"]
    assert data["product_count"] == 2
    assert data["net_sales"] == "50.0000"

    by_code = get(auth_client, search="sku-1").json()
    assert [row["source_product_code"] for row in by_code["rows"]] == ["SKU-1"]


@pytest.mark.django_db
def test_product_performance_is_organisation_scoped(auth_client, organisation, other_user):
    own = warehouse(organisation)
    add_line(
        own,
        when=date(2024, 3, 1),
        invoice="INV-1",
        quantity=1,
        product="SKU-1",
        net="10.00",
    )
    other_org = create_organisation(name="Elsewhere", owner=other_user)
    foreign = warehouse(other_org)
    add_line(
        foreign,
        when=date(2024, 3, 1),
        invoice="INV-1",
        quantity=9,
        product="SKU-1",
        net="90.00",
    )

    assert get(auth_client).json()["net_sales"] == "10.0000"
    assert get(auth_client, dataset=str(foreign.id)).status_code == 404


@pytest.mark.django_db
def test_empty_and_invalid_product_requests(auth_client, organisation):
    empty = get(auth_client)
    assert empty.status_code == 200
    assert empty.json()["has_data"] is False
    assert empty.json()["rows"] == []
    assert empty.json()["top_product_share"] is None

    reversed_range = get(auth_client, date_from="2024-02-01", date_to="2024-01-01")
    assert reversed_range.status_code == 400

    assert get(auth_client, dataset="not-a-uuid").status_code == 400


@pytest.mark.django_db
def test_viewers_can_read_products(api_for, member, organisation):
    dataset = warehouse(organisation)
    add_line(
        dataset,
        when=date(2024, 3, 1),
        invoice="INV-1",
        quantity=1,
        product="SKU-1",
        net="10.00",
    )

    assert get(api_for(member.user)).status_code == 200

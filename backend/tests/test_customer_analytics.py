from datetime import date

import pytest
from django.urls import reverse

from apps.organisations.services import create_organisation
from tests.warehouse import add_line, warehouse


def get(client, name, **params):
    return client.get(reverse(name), params)


@pytest.mark.django_db
def test_summary_reports_repeat_purchase_and_observed_value(auth_client, organisation):
    dataset = warehouse(organisation)
    add_line(
        dataset, when=date(2024, 1, 10), invoice="INV-1", quantity=1, customer="C-1", net="10.00"
    )
    add_line(
        dataset, when=date(2024, 2, 10), invoice="INV-2", quantity=2, customer="C-1", net="20.00"
    )
    add_line(
        dataset, when=date(2024, 3, 10), invoice="INV-3", quantity=3, customer="C-1", net="30.00"
    )
    add_line(
        dataset, when=date(2024, 1, 12), invoice="INV-4", quantity=1, customer="C-2", net="15.00"
    )
    add_line(
        dataset, when=date(2024, 3, 12), invoice="INV-5", quantity=1, customer="C-2", net="5.00"
    )
    add_line(
        dataset, when=date(2024, 2, 15), invoice="INV-6", quantity=1, customer="C-3", net="25.00"
    )
    add_line(
        dataset, when=date(2024, 1, 20), invoice="INV-7", quantity=1, customer="C-4", net="40.00"
    )
    add_line(
        dataset, when=date(2024, 2, 20), invoice="INV-8", quantity=1, customer="C-4", net="10.00"
    )
    add_line(
        dataset, when=date(2024, 3, 20), invoice="INV-9", quantity=-1, customer="C-4", net="-5.00"
    )
    add_line(dataset, when=date(2024, 1, 25), invoice="INV-10", quantity=9, net="100.00")

    response = get(
        auth_client,
        "customer-summary",
        date_from="2024-01-01",
        date_to="2024-03-31",
    )

    assert response.status_code == 200
    data = response.json()
    assert data["has_data"] is True
    assert data["identifiable_customers"] == 4
    assert data["repeat_customers"] == 3
    assert data["repeat_purchase_rate"] == "75.00"
    assert data["average_orders"] == "2.00"
    assert data["historical_value"] == "150.0000"
    assert data["average_historical_value"] == "37.5000"
    # January cohort: C1 and C4 returned in February, C2 did not; February
    # cohort: C3 did not return in March. Two of four eligible customers.
    assert data["month_1_retention"] == "50.00"
    assert data["cohort_count"] == 2


@pytest.mark.django_db
def test_rfm_rows_scores_segments_and_limits(auth_client, organisation):
    dataset = warehouse(organisation)
    add_line(
        dataset, when=date(2024, 1, 10), invoice="INV-1", quantity=1, customer="C-1", net="10.00"
    )
    add_line(
        dataset, when=date(2024, 2, 10), invoice="INV-2", quantity=1, customer="C-1", net="20.00"
    )
    add_line(
        dataset, when=date(2024, 3, 10), invoice="INV-3", quantity=1, customer="C-1", net="30.00"
    )
    add_line(
        dataset, when=date(2024, 1, 12), invoice="INV-4", quantity=1, customer="C-2", net="15.00"
    )
    add_line(
        dataset, when=date(2024, 3, 12), invoice="INV-5", quantity=1, customer="C-2", net="5.00"
    )
    add_line(
        dataset, when=date(2024, 2, 15), invoice="INV-6", quantity=1, customer="C-3", net="25.00"
    )
    add_line(dataset, when=date(2024, 1, 25), invoice="INV-10", quantity=9, net="100.00")

    response = get(
        auth_client,
        "customer-rfm",
        date_from="2024-01-01",
        date_to="2024-03-31",
    )

    assert response.status_code == 200
    data = response.json()
    assert data["has_data"] is True
    assert data["as_of"] == "2024-03-31"
    assert len(data["customers"]) == 3
    assert all(1 <= row["r"] <= 5 for row in data["customers"])
    assert all(1 <= row["f"] <= 5 for row in data["customers"])
    assert all(row["segment_label"] for row in data["customers"])
    assert [row["source_customer_id"] for row in data["customers"]] == ["C-1", "C-3", "C-2"]
    assert data["customers"][0]["orders"] == 3
    assert data["customers"][0]["recency_days"] == 21
    assert sum(segment["customers"] for segment in data["segments"]) == 3
    assert [segment["key"] for segment in data["segments"]] == [
        "champion",
        "loyal",
        "potential",
        "at_risk",
        "hibernating",
        "occasional",
    ]

    limited = get(auth_client, "customer-rfm", limit="1").json()
    assert len(limited["customers"]) == 1
    assert len(limited["segments"]) == 6

    searched = get(auth_client, "customer-rfm", search="c-2").json()
    assert [row["source_customer_id"] for row in searched["customers"]] == ["C-2"]
    assert sum(segment["customers"] for segment in searched["segments"]) == 3
    assert searched["customers"][0]["segment"] in {
        "champion",
        "loyal",
        "potential",
        "at_risk",
        "hibernating",
        "occasional",
    }


@pytest.mark.django_db
def test_single_customer_gets_neutral_scores(auth_client, organisation):
    dataset = warehouse(organisation)
    add_line(dataset, when=date(2024, 2, 1), invoice="INV-1", quantity=1, customer="C-1")

    row = get(auth_client, "customer-rfm").json()["customers"][0]

    assert (row["r"], row["f"], row["m"]) == (3, 3, 3)
    assert row["segment"] == "occasional"


@pytest.mark.django_db
def test_retention_cohort_matrix_counts_calendar_months(auth_client, organisation):
    dataset = warehouse(organisation)
    add_line(dataset, when=date(2024, 1, 10), invoice="INV-1", quantity=1, customer="C-1")
    add_line(dataset, when=date(2024, 2, 10), invoice="INV-2", quantity=1, customer="C-1")
    add_line(dataset, when=date(2024, 3, 10), invoice="INV-3", quantity=1, customer="C-1")
    add_line(dataset, when=date(2024, 1, 12), invoice="INV-4", quantity=1, customer="C-2")
    add_line(dataset, when=date(2024, 3, 12), invoice="INV-5", quantity=1, customer="C-2")
    add_line(dataset, when=date(2024, 2, 15), invoice="INV-6", quantity=1, customer="C-3")

    response = get(
        auth_client,
        "customer-retention",
        date_from="2024-01-01",
        date_to="2024-03-31",
    )

    assert response.status_code == 200
    data = response.json()
    assert data["has_data"] is True
    assert data["month_1_retention"] == "33.33"
    assert [cohort["cohort"] for cohort in data["cohorts"]] == ["2024-02", "2024-01"]

    february = data["cohorts"][0]
    assert february["size"] == 1
    assert len(february["months"]) == 2
    assert february["months"][1]["rate"] == "0.00"

    january = data["cohorts"][1]
    assert january["size"] == 2
    assert [month["customers"] for month in january["months"]] == [2, 1, 2]
    assert [month["rate"] for month in january["months"]] == ["100.00", "50.00", "100.00"]


@pytest.mark.django_db
def test_customer_analytics_are_organisation_scoped(auth_client, organisation, other_user):
    own = warehouse(organisation)
    add_line(own, when=date(2024, 1, 1), invoice="INV-1", quantity=1, customer="C-1")
    other_org = create_organisation(name="Elsewhere", owner=other_user)
    foreign = warehouse(other_org)
    add_line(
        foreign, when=date(2024, 1, 1), invoice="INV-1", quantity=9, customer="C-1", net="90.00"
    )

    summary = get(auth_client, "customer-summary").json()
    assert summary["identifiable_customers"] == 1
    assert summary["historical_value"] == "10.0000"

    assert get(auth_client, "customer-summary", dataset=str(foreign.id)).status_code == 404


@pytest.mark.django_db
def test_empty_customer_state(auth_client, organisation):
    summary = get(auth_client, "customer-summary")
    rfm = get(auth_client, "customer-rfm")
    retention = get(auth_client, "customer-retention")

    assert summary.status_code == 200
    assert summary.json()["has_data"] is False
    assert summary.json()["identifiable_customers"] == 0
    assert summary.json()["repeat_purchase_rate"] is None
    assert summary.json()["month_1_retention"] is None
    assert rfm.json()["customers"] == []
    assert retention.json()["cohorts"] == []


@pytest.mark.django_db
def test_invalid_customer_parameters(auth_client, organisation):
    reversed_range = get(
        auth_client,
        "customer-summary",
        date_from="2024-02-01",
        date_to="2024-01-01",
    )
    assert reversed_range.status_code == 400
    assert "date_from" in reversed_range.json()["error"]["fields"]

    bad_date = get(auth_client, "customer-rfm", date_from="01/02/2024")
    assert bad_date.status_code == 400

    bad_dataset = get(auth_client, "customer-retention", dataset="not-a-uuid")
    assert bad_dataset.status_code == 400

    assert get(auth_client, "customer-rfm", limit="0").status_code == 200


@pytest.mark.django_db
def test_viewers_can_read_and_anonymous_is_rejected(api_for, member, api_client, organisation):
    dataset = warehouse(organisation)
    add_line(dataset, when=date(2024, 1, 1), invoice="INV-1", quantity=1, customer="C-1")

    assert get(api_for(member.user), "customer-summary").status_code == 200
    assert get(api_client, "customer-summary").status_code == 401
    assert get(api_client, "customer-retention").status_code == 401

from datetime import date

import pytest
from django.urls import reverse

from apps.forecasting.forecast import add_months
from apps.forecasting.models import ForecastRun, ForecastStatus
from apps.forecasting.services import execute_forecast
from apps.organisations.services import create_organisation
from tests.warehouse import add_line, warehouse


def seed_series(dataset, values, start=(2023, 1)):
    current = date(start[0], start[1], 1)
    for index, value in enumerate(values):
        add_line(
            dataset,
            when=current,
            invoice=f"INV-{index:03d}",
            quantity=1,
            price=str(value),
            net=str(value),
            product="SKU-1",
        )
        current = add_months(current, 1)


def create_run(client, **payload):
    return client.post(reverse("forecast-run-list"), payload, format="json")


@pytest.mark.django_db
def test_run_forecasts_and_stores_points_and_anomalies(auth_client, organisation):
    dataset = warehouse(organisation)
    values = [100 + index * 5 for index in range(24)]
    values[5] = 1000
    seed_series(dataset, values)

    response = create_run(auth_client, dataset=str(dataset.id), horizon=3)

    assert response.status_code == 202
    data = response.json()
    assert data["status"] == "succeeded"
    assert data["model_name"] == "Holt linear trend"
    assert data["model_version"] == "holt-linear-v1"
    assert data["dataset"] == {"id": str(dataset.id), "name": "Sales"}
    assert data["training_start"] == "2023-01-01"
    assert data["training_end"] == "2024-12-01"
    assert data["anomaly_count"] == 1

    detail = auth_client.get(reverse("forecast-run-detail", args=[data["id"]])).json()
    assert len(detail["history"]) == 24
    assert [point["target_date"] for point in detail["points"]] == [
        "2025-01-01",
        "2025-02-01",
        "2025-03-01",
    ]
    assert detail["metrics"]["split"] == {
        "training_periods": 14,
        "validation_periods": 5,
        "test_periods": 5,
    }
    assert detail["metrics"]["interval"] == "95% (±1.96 × test RMSE)"
    assert detail["anomalies"][0]["observed_date"] == "2023-06-01"
    assert detail["anomalies"][0]["direction"] == "above"


@pytest.mark.django_db
def test_runs_are_organisation_scoped(auth_client, organisation, other_user):
    dataset = warehouse(organisation)
    seed_series(dataset, [100 + index for index in range(12)])
    run = create_run(auth_client, dataset=str(dataset.id), horizon=2).json()

    other_org = create_organisation(name="Elsewhere", owner=other_user)
    other_dataset = warehouse(other_org)
    seed_series(other_dataset, [50 + index for index in range(12)])

    foreign = create_run(auth_client, dataset=str(other_dataset.id), horizon=2)
    assert foreign.status_code == 404

    foreign_run = ForecastRun.objects.create(
        organisation=other_org,
        horizon=2,
        model_name="Holt linear trend",
        model_version="holt-linear-v1",
    )
    detail = auth_client.get(reverse("forecast-run-detail", args=[foreign_run.id]))
    assert detail.status_code == 404

    listing = auth_client.get(reverse("forecast-run-list")).json()
    assert [item["id"] for item in listing] == [run["id"]]


@pytest.mark.django_db
def test_insufficient_or_empty_history_is_rejected(auth_client, organisation):
    short = warehouse(organisation)
    seed_series(short, [100 + index for index in range(6)])

    short_response = create_run(auth_client, dataset=str(short.id), horizon=3)
    assert short_response.status_code == 400
    assert "At least 12 monthly periods" in short_response.json()["error"]["message"]

    empty = warehouse(organisation, "Empty")
    empty_response = create_run(auth_client, dataset=str(empty.id), horizon=3)
    assert empty_response.status_code == 400


@pytest.mark.django_db
def test_horizon_and_dataset_validation(auth_client, organisation):
    seed_series(warehouse(organisation), [100] * 12)

    assert create_run(auth_client, horizon=0).status_code == 400
    assert create_run(auth_client, horizon=13).status_code == 400
    assert create_run(auth_client, dataset="not-a-uuid", horizon=3).status_code == 400


@pytest.mark.django_db
def test_active_run_blocks_a_second_request(auth_client, organisation):
    dataset = warehouse(organisation)
    seed_series(dataset, [100 + index for index in range(12)])
    ForecastRun.objects.create(
        organisation=organisation,
        dataset=dataset,
        horizon=3,
        model_name="Holt linear trend",
        model_version="holt-linear-v1",
        status=ForecastStatus.QUEUED,
    )

    response = create_run(auth_client, dataset=str(dataset.id), horizon=3)

    assert response.status_code == 409


@pytest.mark.django_db
def test_failed_run_records_its_error(organisation):
    dataset = warehouse(organisation)
    run = ForecastRun.objects.create(
        organisation=organisation,
        dataset=dataset,
        horizon=3,
        model_name="Holt linear trend",
        model_version="holt-linear-v1",
        history=[{"period": "2024-01-01", "amount": "not-a-number"}],
    )

    execute_forecast(str(run.id))

    run.refresh_from_db()
    assert run.status == ForecastStatus.FAILED
    assert run.error_message
    assert run.points.count() == 0


@pytest.mark.django_db
def test_viewers_read_but_only_analysts_run(api_for, member, api_client, organisation):
    dataset = warehouse(organisation)
    seed_series(dataset, [100 + index for index in range(12)])

    viewer = api_for(member.user)
    assert (
        viewer.post(
            reverse("forecast-run-list"),
            {"dataset": str(dataset.id), "horizon": 3},
            format="json",
        ).status_code
        == 403
    )
    assert viewer.get(reverse("forecast-run-list")).status_code == 200
    assert api_client.get(reverse("forecast-run-list")).status_code == 401

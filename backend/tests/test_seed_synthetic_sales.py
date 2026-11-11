"""The seed command must produce a dataset every analysis page can use."""

from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.datasets.models import Dataset, DatasetStatus
from apps.forecasting.models import ForecastStatus
from apps.forecasting.services import monthly_series, start_forecast
from apps.ingestion.models import FactReturn, FactSales, ProcessingLog

COMMAND = "seed_synthetic_sales"


def seed(**options):
    call_command(COMMAND, stdout=StringIO(), **options)


@pytest.mark.django_db
def test_seed_builds_a_processed_and_forecastable_dataset(organisation):
    seed(organisation=organisation.name, name="synthetic-test", months=14, orders_per_day=2, seed=7)

    dataset = Dataset.objects.get(organisation=organisation, name="synthetic-test")
    assert dataset.status == DatasetStatus.READY
    assert len(monthly_series(organisation, dataset)) == 14

    run = ProcessingLog.objects.get(dataset=dataset)
    assert run.rows_rejected == 0
    assert FactSales.objects.filter(dataset=dataset).count() > 0
    assert FactReturn.objects.filter(dataset=dataset).count() > 0
    assert run.rows_loaded == (
        FactSales.objects.filter(dataset=dataset).count()
        + FactReturn.objects.filter(dataset=dataset).count()
    )

    forecast = start_forecast(
        organisation=organisation,
        dataset_id=dataset.id,
        horizon=3,
        user=organisation.memberships.first().user,
    )
    forecast.refresh_from_db()
    assert forecast.status == ForecastStatus.SUCCEEDED
    # Both injected disruptions must survive into the observed history.
    assert forecast.anomaly_count >= 2


@pytest.mark.django_db
def test_seed_refuses_a_duplicate_name_without_replace(organisation):
    seed(organisation=organisation.name, name="synthetic-test", months=12, orders_per_day=1, seed=3)

    with pytest.raises(CommandError, match="already has a dataset named"):
        seed(
            organisation=organisation.name,
            name="synthetic-test",
            months=12,
            orders_per_day=1,
            seed=3,
        )


@pytest.mark.django_db
def test_seed_replace_rebuilds_the_dataset_in_place(organisation):
    seed(organisation=organisation.name, name="synthetic-test", months=12, orders_per_day=1, seed=3)
    seed(
        organisation=organisation.name,
        name="synthetic-test",
        months=12,
        orders_per_day=1,
        seed=4,
        replace=True,
    )

    assert Dataset.objects.filter(organisation=organisation, name="synthetic-test").count() == 1
    dataset = Dataset.objects.get(organisation=organisation, name="synthetic-test")
    assert dataset.status == DatasetStatus.READY
    assert dataset.processing_runs.count() == 1


@pytest.mark.django_db
def test_seed_requires_enough_months_to_forecast(organisation):
    with pytest.raises(CommandError, match="--months must be between"):
        seed(organisation=organisation.name, months=6)

    assert not Dataset.objects.filter(organisation=organisation).exists()

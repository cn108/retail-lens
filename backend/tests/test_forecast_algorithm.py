from datetime import date
from decimal import Decimal

import pytest

from apps.forecasting.forecast import (
    ALPHAS,
    BETAS,
    MIN_MONTHS,
    add_months,
    forecast_monthly,
)


def series(values: list[float], start=(2023, 1)) -> list[tuple[date, Decimal]]:
    year, month = start
    points = []
    current = date(year, month, 1)
    for value in values:
        points.append((current, Decimal(str(value))))
        current = add_months(current, 1)
    return points


def test_forecast_produces_points_intervals_and_evaluation_metrics():
    values = [100 + index * 4 + (index % 12) * 3 for index in range(24)]

    outcome = forecast_monthly(series(values), 6)

    assert len(outcome.points) == 6
    assert [point["target_date"] for point in outcome.points][0] == date(2025, 1, 1)
    for point in outcome.points:
        assert point["lower_bound"] <= point["predicted_amount"] <= point["upper_bound"]
    assert outcome.metrics["model"]["version"] == "holt-linear-v1"
    assert outcome.metrics["baseline"]["version"] == "seasonal-naive-v1"
    assert outcome.metrics["split"] == {
        "training_periods": 14,
        "validation_periods": 5,
        "test_periods": 5,
    }
    assert outcome.metrics["alpha"] in ALPHAS
    assert outcome.metrics["beta"] in BETAS
    assert outcome.metrics["model"]["mae"] >= 0
    assert outcome.metrics["baseline"]["rmse"] >= 0
    assert outcome.anomalies == []


def test_minimum_history_and_horizon_are_enforced():
    with pytest.raises(ValueError, match=str(MIN_MONTHS)):
        forecast_monthly(series([100] * (MIN_MONTHS - 1)), 3)

    with pytest.raises(ValueError, match="Horizon"):
        forecast_monthly(series([100] * MIN_MONTHS), 0)

    with pytest.raises(ValueError, match="Horizon"):
        forecast_monthly(series([100] * MIN_MONTHS), 13)


def test_anomaly_flags_a_single_extreme_month():
    values = [100 + (index % 5) for index in range(24)]
    values[5] = 1000

    outcome = forecast_monthly(series(values), 3)

    assert len(outcome.anomalies) == 1
    anomaly = outcome.anomalies[0]
    assert anomaly["observed_date"] == date(2023, 6, 1)
    assert anomaly["observed_amount"] == Decimal("1000.0000")
    assert anomaly["direction"] == "above"
    assert anomaly["score"] > 0
    assert anomaly["expected_amount"] < anomaly["observed_amount"]


def test_constant_series_has_no_anomalies():
    outcome = forecast_monthly(series([100] * 15), 3)

    assert outcome.anomalies == []
    assert len(outcome.points) == 3
    assert outcome.points[0]["predicted_amount"] == Decimal("100.0000")


def test_add_months_crosses_year_boundaries():
    assert add_months(date(2024, 12, 1), 1) == date(2025, 1, 1)
    assert add_months(date(2024, 1, 1), 13) == date(2025, 2, 1)
    assert add_months(date(2024, 3, 1), 12) == date(2025, 3, 1)

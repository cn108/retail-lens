"""Deterministic monthly forecasting and anomaly detection.

The model is Holt's linear trend (double exponential smoothing). It is
deliberately small and dependency-free so the worker image stays lean and the
method remains auditable. A seasonal-naive baseline is evaluated first on the
same chronological test window; every run records both errors, the selected
smoothing parameters, the split sizes and the interval rule.

Evaluation is strictly chronological: training, validation and test windows
are contiguous slices in time. Parameters are chosen on validation MAE and
reported on the untouched test window. No random split or shuffling is used.
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

MONEY = Decimal("0.0001")
MIN_MONTHS = 12
MODEL_NAME = "Holt linear trend"
MODEL_VERSION = "holt-linear-v1"
BASELINE_NAME = "Seasonal naive"
BASELINE_VERSION = "seasonal-naive-v1"
ANOMALY_METHOD = "Tukey IQR fences (mean ± 3σ fallback)"
ALPHAS = (0.1, 0.3, 0.5, 0.7, 0.9)
BETAS = (0.1, 0.3, 0.5, 0.7, 0.9)
INTERVAL_Z = 1.96


@dataclass(frozen=True)
class ForecastOutcome:
    points: list[dict]
    anomalies: list[dict]
    metrics: dict


def _money(value: Decimal | float) -> Decimal:
    return Decimal(value).quantize(MONEY, rounding=ROUND_HALF_UP)


def add_months(value: date, months: int) -> date:
    month_index = value.year * 12 + (value.month - 1) + months
    year, month = divmod(month_index, 12)
    return date(year, month + 1, 1)


def _holt_fit(values: list[float], alpha: float, beta: float) -> tuple[float, float]:
    level = values[0]
    trend = values[1] - values[0] if len(values) > 1 else 0.0
    for value in values[1:]:
        previous_level = level
        level = alpha * value + (1 - alpha) * (level + trend)
        trend = beta * (level - previous_level) + (1 - beta) * trend
    return level, trend


def _holt_forecast(values: list[float], alpha: float, beta: float, horizon: int) -> list[float]:
    level, trend = _holt_fit(values, alpha, beta)
    return [level + step * trend for step in range(1, horizon + 1)]


def _baseline_forecast(values: list[float], origin: int, horizon: int) -> list[float]:
    """Seasonal naive from the value 12 months earlier, else the origin value."""
    predictions = []
    for step in range(1, horizon + 1):
        target = origin + step
        source = target - 12
        predictions.append(values[source] if source >= 0 else values[origin])
    return predictions


def _errors(actual: list[float], predicted: list[float]) -> tuple[float, float]:
    differences = [a - p for a, p in zip(actual, predicted, strict=True)]
    mae = sum(abs(error) for error in differences) / len(differences)
    rmse = math.sqrt(sum(error * error for error in differences) / len(differences))
    return mae, rmse


def _round(value: float) -> float:
    return float(Decimal(str(value)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP))


def _anomalies(series: list[tuple[date, Decimal]]) -> list[dict]:
    if len(series) < 6:
        return []

    values = [float(amount) for _, amount in series]
    median = statistics.median(values)
    q1, _, q3 = statistics.quantiles(values, n=4, method="inclusive")
    iqr = q3 - q1
    if iqr > 0:
        lower = q1 - 1.5 * iqr
        upper = q3 + 1.5 * iqr
        scale = iqr
    else:
        mean = statistics.fmean(values)
        deviation = statistics.pstdev(values)
        if deviation == 0:
            return []
        lower = mean - 3 * deviation
        upper = mean + 3 * deviation
        scale = deviation

    anomalies = []
    for observed, amount in series:
        value = float(amount)
        if lower < value < upper:
            continue
        anomalies.append(
            {
                "observed_date": observed,
                "observed_amount": _money(amount),
                "expected_amount": _money(median),
                "deviation_amount": _money(amount - Decimal(str(median))),
                "score": _round((value - median) / scale),
                "direction": "above" if value > median else "below",
            }
        )
    return anomalies


def forecast_monthly(series: list[tuple[date, Decimal]], horizon: int) -> ForecastOutcome:
    """Forecast monthly net sales and flag historical level anomalies.

    ``series`` must be a contiguous, sorted list of month-start dates. Missing
    months are supplied as zero by the caller. At least 12 months are required.
    """
    if len(series) < MIN_MONTHS:
        raise ValueError(f"At least {MIN_MONTHS} monthly periods are required.")
    if horizon < 1 or horizon > 12:
        raise ValueError("Horizon must be between 1 and 12 months.")

    values = [float(amount) for _, amount in series]
    count = len(values)
    train_end = max(3, int(count * 0.6))
    validation_end = max(train_end + 1, int(count * 0.8))
    validation_end = min(validation_end, count - 1)
    validation_steps = validation_end - train_end
    test_steps = count - validation_end

    best_alpha, best_beta = ALPHAS[0], BETAS[0]
    best_validation_mae = math.inf
    for alpha in ALPHAS:
        for beta in BETAS:
            predictions = _holt_forecast(values[:train_end], alpha, beta, validation_steps)
            mae, _ = _errors(values[train_end:validation_end], predictions)
            if mae < best_validation_mae:
                best_validation_mae = mae
                best_alpha, best_beta = alpha, beta

    test_actual = values[validation_end:]
    model_predictions = _holt_forecast(values[:validation_end], best_alpha, best_beta, test_steps)
    baseline_predictions = _baseline_forecast(values, validation_end - 1, test_steps)
    model_mae, model_rmse = _errors(test_actual, model_predictions)
    baseline_mae, baseline_rmse = _errors(test_actual, baseline_predictions)

    improvement = None
    if baseline_rmse > 0:
        improvement = _round((baseline_rmse - model_rmse) / baseline_rmse * 100)

    last_period = series[-1][0]
    future = _holt_forecast(values, best_alpha, best_beta, horizon)
    interval = INTERVAL_Z * model_rmse
    points = [
        {
            "target_date": add_months(last_period, step),
            "predicted_amount": _money(prediction),
            "lower_bound": _money(prediction - interval),
            "upper_bound": _money(prediction + interval),
        }
        for step, prediction in enumerate(future, start=1)
    ]

    return ForecastOutcome(
        points=points,
        anomalies=_anomalies(series),
        metrics={
            "model": {
                "name": MODEL_NAME,
                "version": MODEL_VERSION,
                "mae": _round(model_mae),
                "rmse": _round(model_rmse),
            },
            "baseline": {
                "name": BASELINE_NAME,
                "version": BASELINE_VERSION,
                "mae": _round(baseline_mae),
                "rmse": _round(baseline_rmse),
            },
            "improvement_percent": improvement,
            "split": {
                "training_periods": train_end,
                "validation_periods": validation_steps,
                "test_periods": test_steps,
            },
            "alpha": best_alpha,
            "beta": best_beta,
            "interval": "95% (±1.96 × test RMSE)",
            "minimum_history_months": MIN_MONTHS,
        },
    )

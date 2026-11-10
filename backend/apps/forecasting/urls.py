from django.urls import path

from .views import (
    ForecastAnomalyTriageView,
    ForecastRunDetailView,
    ForecastRunListCreateView,
)

urlpatterns = [
    path("runs", ForecastRunListCreateView.as_view(), name="forecast-run-list"),
    path(
        "runs/<uuid:run_id>",
        ForecastRunDetailView.as_view(),
        name="forecast-run-detail",
    ),
    path(
        "runs/<uuid:run_id>/anomalies/<int:anomaly_id>",
        ForecastAnomalyTriageView.as_view(),
        name="forecast-anomaly-triage",
    ),
]

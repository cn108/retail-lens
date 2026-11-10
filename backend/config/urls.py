from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from apps.datasets.views import DatasetListUploadView
from apps.organisations.views import OrganisationListCreateView
from apps.reporting.views import SavedReportListCreateView
from config.health import health

api_v1_patterns = [
    path("health", health, name="health"),
    path("auth/", include("apps.accounts.urls")),
    # The collection is reachable with and without a trailing slash. Without
    # the alias, POST to the bare URL hits APPEND_SLASH, which cannot redirect
    # a request body and would answer 500 instead of creating the organisation.
    path(
        "organisations",
        OrganisationListCreateView.as_view(),
        name="organisation-list-root",
    ),
    path("organisations/", include("apps.organisations.urls")),
    # Same alias reason as the organisation collection: uploading is a POST,
    # and APPEND_SLASH cannot redirect a request body.
    path("datasets", DatasetListUploadView.as_view(), name="dataset-list-root"),
    path("datasets/", include("apps.datasets.urls")),
    path("analytics/", include("apps.analytics.urls")),
    path("customers/", include("apps.customers.urls")),
    path("forecasting/", include("apps.forecasting.urls")),
    # The collection is reachable with and without a trailing slash for the
    # same reason as datasets: creating a report is a POST and APPEND_SLASH
    # cannot redirect a request body.
    path("reports", SavedReportListCreateView.as_view(), name="report-list-root"),
    path("reports/", include("apps.reporting.urls")),
    path("monitoring/", include("apps.monitoring.urls")),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", include(api_v1_patterns)),
    path("api/schema", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
]

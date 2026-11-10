from django.urls import path

from . import views

urlpatterns = [
    path("", views.DatasetListUploadView.as_view(), name="dataset-list"),
    path("quality-summary", views.QualitySummaryView.as_view(), name="quality-summary"),
    path(
        "canonical-fields",
        views.CanonicalFieldListView.as_view(),
        name="dataset-canonical-fields",
    ),
    path("<uuid:dataset_id>", views.DatasetDetailView.as_view(), name="dataset-detail"),
    path(
        "<uuid:dataset_id>/mapping",
        views.DatasetMappingView.as_view(),
        name="dataset-mapping",
    ),
    path(
        "<uuid:dataset_id>/process",
        views.DatasetProcessView.as_view(),
        name="dataset-process",
    ),
    path(
        "<uuid:dataset_id>/runs",
        views.DatasetRunsView.as_view(),
        name="dataset-runs",
    ),
    path(
        "<uuid:dataset_id>/issues",
        views.DatasetIssuesView.as_view(),
        name="dataset-issues",
    ),
]

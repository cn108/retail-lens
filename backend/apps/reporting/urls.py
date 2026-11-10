from django.urls import path

from . import views

urlpatterns = [
    path("", views.SavedReportListCreateView.as_view(), name="report-list"),
    path("exports", views.ReportExportListView.as_view(), name="report-export-all"),
    path("<uuid:report_id>", views.SavedReportDetailView.as_view(), name="report-detail"),
    path(
        "<uuid:report_id>/exports",
        views.ReportExportListCreateView.as_view(),
        name="report-export-list",
    ),
    path(
        "<uuid:report_id>/exports/<uuid:job_id>",
        views.ReportExportDetailView.as_view(),
        name="report-export-detail",
    ),
    path(
        "<uuid:report_id>/exports/<uuid:job_id>/download",
        views.ReportExportDownloadView.as_view(),
        name="report-export-download",
    ),
]

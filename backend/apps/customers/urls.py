from django.urls import path

from .views import (
    CustomerDetailView,
    CustomerRetentionView,
    CustomerRfmView,
    CustomerSummaryView,
    SegmentDetailView,
    SegmentListCreateView,
    SegmentMembersView,
)

urlpatterns = [
    path("summary", CustomerSummaryView.as_view(), name="customer-summary"),
    path("rfm", CustomerRfmView.as_view(), name="customer-rfm"),
    path("retention", CustomerRetentionView.as_view(), name="customer-retention"),
    path("segments", SegmentListCreateView.as_view(), name="segment-list"),
    path("segments/<uuid:segment_id>", SegmentDetailView.as_view(), name="segment-detail"),
    path(
        "segments/<uuid:segment_id>/members",
        SegmentMembersView.as_view(),
        name="segment-members",
    ),
    path("<int:customer_id>", CustomerDetailView.as_view(), name="customer-detail"),
]

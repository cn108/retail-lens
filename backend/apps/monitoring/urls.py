from django.urls import path

from .views import (
    AlertDetailView,
    AlertEvaluateView,
    AlertEventAcknowledgeView,
    AlertListView,
    BoardDetailView,
    BoardListView,
    ScheduleDetailView,
    ScheduleListView,
    TargetDetailView,
    TargetListView,
)

urlpatterns = [
    path("alerts", AlertListView.as_view(), name="alert-list"),
    path("alerts/evaluate", AlertEvaluateView.as_view(), name="alert-evaluate"),
    path("alerts/<uuid:rule_id>", AlertDetailView.as_view(), name="alert-detail"),
    path(
        "alert-events/<uuid:event_id>/acknowledge",
        AlertEventAcknowledgeView.as_view(),
        name="alert-event-acknowledge",
    ),
    path("targets", TargetListView.as_view(), name="target-list"),
    path("targets/<uuid:target_id>", TargetDetailView.as_view(), name="target-detail"),
    path("schedules", ScheduleListView.as_view(), name="schedule-list"),
    path("schedules/<uuid:schedule_id>", ScheduleDetailView.as_view(), name="schedule-detail"),
    path("boards", BoardListView.as_view(), name="board-list"),
    path("boards/<uuid:board_id>", BoardDetailView.as_view(), name="board-detail"),
]

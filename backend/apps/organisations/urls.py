from django.urls import path

from . import views

urlpatterns = [
    path("", views.OrganisationListCreateView.as_view(), name="organisation-list"),
    path("current", views.CurrentOrganisationView.as_view(), name="organisation-current"),
    path(
        "current/members",
        views.MemberListCreateView.as_view(),
        name="organisation-members",
    ),
    path(
        "current/members/<uuid:member_id>",
        views.MemberDetailView.as_view(),
        name="organisation-member",
    ),
]

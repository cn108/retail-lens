from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.services import set_default_organisation_if_unset

from .models import Membership, Role
from .serializers import (
    AddMemberSerializer,
    MemberSerializer,
    MembershipSummarySerializer,
    OrganisationSerializer,
    OrganisationSettingsSerializer,
    RoleSerializer,
)
from .services import (
    active_membership_for,
    add_member,
    change_role,
    create_organisation,
    memberships_for,
    remove_member,
    require_role,
)


def _active_membership(request) -> Membership:  # type: ignore[no-untyped-def]
    membership = active_membership_for(request.user, request.headers.get("X-Organisation-Id"))
    if membership is None:
        raise NotFound("You do not belong to any organisation.")
    return membership


class OrganisationListCreateView(APIView):
    def get(self, request):  # type: ignore[no-untyped-def]
        return Response(MembershipSummarySerializer(memberships_for(request.user), many=True).data)

    def post(self, request):  # type: ignore[no-untyped-def]
        serializer = OrganisationSettingsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        organisation = create_organisation(
            name=data["name"],
            owner=request.user,
            currency=data.get("currency", "GBP"),
            timezone=data.get("timezone", "Europe/London"),
        )
        set_default_organisation_if_unset(request.user, organisation)
        membership = Membership.objects.get(organisation=organisation, user=request.user)
        return Response(
            OrganisationSerializer(organisation, context={"membership": membership}).data,
            status=status.HTTP_201_CREATED,
        )


class CurrentOrganisationView(APIView):
    def get(self, request):  # type: ignore[no-untyped-def]
        membership = _active_membership(request)
        return Response(
            OrganisationSerializer(membership.organisation, context={"membership": membership}).data
        )

    def patch(self, request):  # type: ignore[no-untyped-def]
        membership = _active_membership(request)
        require_role(membership, Role.ADMIN)
        serializer = OrganisationSettingsSerializer(
            membership.organisation, data=request.data, partial=True
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        membership.refresh_from_db()
        return Response(
            OrganisationSerializer(membership.organisation, context={"membership": membership}).data
        )


class MemberListCreateView(APIView):
    def get(self, request):  # type: ignore[no-untyped-def]
        membership = _active_membership(request)
        members = membership.organisation.memberships.select_related("user")
        return Response(MemberSerializer(members, many=True).data)

    def post(self, request):  # type: ignore[no-untyped-def]
        membership = _active_membership(request)
        serializer = AddMemberSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        member = add_member(
            organisation=membership.organisation,
            email=serializer.validated_data["email"],
            role=serializer.validated_data["role"],
            actor=membership,
        )
        return Response(MemberSerializer(member).data, status=status.HTTP_201_CREATED)


class MemberDetailView(APIView):
    def patch(self, request, member_id):  # type: ignore[no-untyped-def]
        actor = _active_membership(request)
        member = get_object_or_404(Membership, id=member_id, organisation=actor.organisation)
        serializer = RoleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        member = change_role(membership=member, role=serializer.validated_data["role"], actor=actor)
        return Response(MemberSerializer(member).data)

    def delete(self, request, member_id):  # type: ignore[no-untyped-def]
        actor = _active_membership(request)
        member = get_object_or_404(Membership, id=member_id, organisation=actor.organisation)
        remove_member(membership=member, actor=actor)
        return Response(status=status.HTTP_204_NO_CONTENT)

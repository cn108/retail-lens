from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils.http import content_disposition_header
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.organisations.models import Membership, Role
from apps.organisations.services import active_membership_for, require_role
from config.schema import ORGANISATION_HEADER, limit_parameter

from .models import ExportFormat, ExportStatus, ReportJob, SavedReport
from .serializers import (
    ReportExportCreateSerializer,
    ReportExportSerializer,
    SavedReportCreateSerializer,
    SavedReportSerializer,
    SavedReportSummarySerializer,
    SavedReportUpdateSerializer,
)
from .services import (
    ACTIVE_STATUSES,
    ExportNotReady,
    create_report,
    delete_report,
    job_payload,
    jobs_payload,
    report_list_payload,
    report_payload,
    start_export,
    update_report,
)

ACTIVE_PARAMETER = OpenApiParameter(
    "active",
    OpenApiTypes.STR,
    OpenApiParameter.QUERY,
    required=False,
    description="Set to 1, true or yes to return only queued and running exports.",
)


def _membership(request) -> Membership:  # type: ignore[no-untyped-def]
    membership = active_membership_for(request.user, request.headers.get("X-Organisation-Id"))
    if membership is None:
        raise NotFound("You do not belong to any organisation.")
    return membership


def _report(request, report_id) -> SavedReport:  # type: ignore[no-untyped-def]
    membership = _membership(request)
    return get_object_or_404(
        SavedReport.objects.select_related("dataset", "created_by", "organisation"),
        id=report_id,
        organisation=membership.organisation,
    )


@extend_schema_view(
    get=extend_schema(
        parameters=[ORGANISATION_HEADER],
        responses=SavedReportSummarySerializer(many=True),
    ),
    post=extend_schema(
        request=SavedReportCreateSerializer,
        responses={201: SavedReportSerializer},
    ),
)
class SavedReportListCreateView(APIView):
    def get(self, request):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        reports = SavedReport.objects.filter(organisation=membership.organisation).select_related(
            "dataset", "created_by"
        )
        return Response([report_list_payload(report) for report in reports])

    def post(self, request):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        require_role(membership, Role.ANALYST)

        serializer = SavedReportCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        report = create_report(
            organisation=membership.organisation,
            name=data["name"],
            kind=data["kind"],
            dataset_id=data.get("dataset"),
            date_from=data.get("date_from"),
            date_to=data.get("date_to"),
            user=request.user,
        )
        report.refresh_from_db()
        return Response(report_payload(report), status=status.HTTP_201_CREATED)


@extend_schema_view(
    get=extend_schema(responses=SavedReportSerializer),
    patch=extend_schema(
        request=SavedReportUpdateSerializer,
        responses=SavedReportSerializer,
    ),
    delete=extend_schema(responses={204: None}),
)
class SavedReportDetailView(APIView):
    def get(self, request, report_id):  # type: ignore[no-untyped-def]
        return Response(report_payload(_report(request, report_id)))

    def patch(self, request, report_id):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        require_role(membership, Role.ANALYST)
        report = _report(request, report_id)
        serializer = SavedReportUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        report = update_report(report, serializer.validated_data)
        return Response(report_payload(report))

    def delete(self, request, report_id):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        require_role(membership, Role.ANALYST)
        report = _report(request, report_id)
        delete_report(report)
        return Response(status=status.HTTP_204_NO_CONTENT)


@extend_schema_view(
    get=extend_schema(
        operation_id="v1_report_exports_list",
        parameters=[limit_parameter(20, 100, "exports")],
        responses=ReportExportSerializer(many=True),
    ),
    post=extend_schema(
        request=ReportExportCreateSerializer,
        responses={202: ReportExportSerializer},
    ),
)
class ReportExportListCreateView(APIView):
    def get(self, request, report_id):  # type: ignore[no-untyped-def]
        report = _report(request, report_id)
        try:
            limit = min(max(int(request.query_params.get("limit", "20")), 1), 100)
        except ValueError:
            limit = 20
        return Response(jobs_payload(report, limit=limit))

    def post(self, request, report_id):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        require_role(membership, Role.ANALYST)
        report = _report(request, report_id)
        serializer = ReportExportCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        job = start_export(
            report=report,
            format=serializer.validated_data["format"],
            user=request.user,
        )
        # Eager test configuration completes the job before returning.
        job.refresh_from_db()
        return Response(job_payload(job), status=status.HTTP_202_ACCEPTED)


@extend_schema_view(
    get=extend_schema(
        operation_id="v1_report_exports_all_list",
        parameters=[limit_parameter(20, 100, "exports"), ACTIVE_PARAMETER],
        responses=ReportExportSerializer(many=True),
    )
)
class ReportExportListView(APIView):
    """All recent report exports for the active organisation."""

    def get(self, request):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        try:
            limit = min(max(int(request.query_params.get("limit", "20")), 1), 100)
        except ValueError:
            limit = 20
        jobs = ReportJob.objects.filter(
            report__organisation=membership.organisation
        ).select_related("report")
        if request.query_params.get("active") in {"1", "true", "yes"}:
            jobs = jobs.filter(status__in=ACTIVE_STATUSES)
        return Response([job_payload(job) for job in jobs[:limit]])


@extend_schema(responses=ReportExportSerializer)
class ReportExportDetailView(APIView):
    def get(self, request, report_id, job_id):  # type: ignore[no-untyped-def]
        report = _report(request, report_id)
        job = get_object_or_404(
            ReportJob.objects.select_related("report"), id=job_id, report=report
        )
        return Response(job_payload(job))


@extend_schema(
    responses={
        (200, "text/csv"): OpenApiTypes.BINARY,
        (200, "application/pdf"): OpenApiTypes.BINARY,
    }
)
class ReportExportDownloadView(APIView):
    def get(self, request, report_id, job_id):  # type: ignore[no-untyped-def]
        report = _report(request, report_id)
        job = get_object_or_404(ReportJob, id=job_id, report=report)
        if job.status != ExportStatus.SUCCEEDED or not job.file:
            raise ExportNotReady()

        try:
            content = job.file.read()
        except (FileNotFoundError, OSError, ValueError) as error:
            raise NotFound("The generated export file is no longer available.") from error

        content_type = (
            "text/csv; charset=utf-8" if job.format == ExportFormat.CSV else "application/pdf"
        )
        fallback = f"report.{job.format}"
        response = HttpResponse(content, content_type=content_type)
        response["Content-Disposition"] = content_disposition_header(
            as_attachment=True, filename=job.filename or fallback
        )
        response["Content-Length"] = str(len(content))
        return response


@extend_schema(exclude=True)
class ReportCollectionAliasView(SavedReportListCreateView):
    """The bare collection path, kept only so a creation POST survives.

    ``APPEND_SLASH`` cannot redirect a request body, so creating a report has to
    work at ``/api/v1/reports`` as well as at the trailing-slash route. The alias
    is excluded from the schema so the collection has one documented operation
    and the paths do not collide on their operationId.
    """

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.ingestion.services import (
    issues_payload,
    run_payload,
    runs_payload,
    start_processing,
)
from apps.organisations.models import Membership, Role
from apps.organisations.services import (
    active_membership_for,
    require_role,
)

from .models import Dataset
from .serializers import (
    DatasetDetailSerializer,
    DatasetMappingSerializer,
    DatasetSummarySerializer,
    DatasetUploadSerializer,
    canonical_field_payload,
)
from .services import apply_mapping, create_dataset, delete_dataset


def _membership(request) -> Membership:  # type: ignore[no-untyped-def]
    membership = active_membership_for(request.user, request.headers.get("X-Organisation-Id"))
    if membership is None:
        raise NotFound("You do not belong to any organisation.")
    return membership


def _dataset(request, dataset_id) -> Dataset:  # type: ignore[no-untyped-def]
    membership = _membership(request)
    return get_object_or_404(
        Dataset.objects.select_related("current_import", "created_by").prefetch_related(
            "processing_runs"
        ),
        id=dataset_id,
        organisation=membership.organisation,
    )


class DatasetListUploadView(APIView):
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request):  # type: ignore[no-untyped-def]
        membership = active_membership_for(request.user, request.headers.get("X-Organisation-Id"))
        if membership is None:
            # A user without an organisation simply has no datasets; only
            # writes need an organisation context.
            return Response([])
        datasets = (
            Dataset.objects.filter(organisation=membership.organisation)
            .select_related("current_import", "created_by")
            .prefetch_related("processing_runs")
        )
        return Response(DatasetSummarySerializer(datasets, many=True).data)

    def post(self, request):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        require_role(membership, Role.ANALYST)

        serializer = DatasetUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        dataset = create_dataset(
            membership=membership,
            uploaded_file=serializer.validated_data["file"],
            name=serializer.validated_data.get("name", ""),
            delimiter=serializer.validated_data.get("delimiter", "auto"),
        )
        return Response(DatasetDetailSerializer(dataset).data, status=status.HTTP_201_CREATED)


class DatasetDetailView(APIView):
    def get(self, request, dataset_id):  # type: ignore[no-untyped-def]
        return Response(DatasetDetailSerializer(_dataset(request, dataset_id)).data)

    def delete(self, request, dataset_id):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        require_role(membership, Role.ADMIN)
        dataset = _dataset(request, dataset_id)
        delete_dataset(dataset)
        return Response(status=status.HTTP_204_NO_CONTENT)


class DatasetMappingView(APIView):
    def put(self, request, dataset_id):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        require_role(membership, Role.ANALYST)
        dataset = _dataset(request, dataset_id)

        serializer = DatasetMappingSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        dataset = apply_mapping(dataset=dataset, mapping=serializer.validated_data["mapping"])
        return Response(DatasetDetailSerializer(dataset).data)


class CanonicalFieldListView(APIView):
    def get(self, request):  # type: ignore[no-untyped-def]
        _membership(request)
        return Response(canonical_field_payload())


class DatasetProcessView(APIView):
    def post(self, request, dataset_id):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        require_role(membership, Role.ANALYST)
        dataset = _dataset(request, dataset_id)
        run = start_processing(dataset=dataset, user=request.user)
        # Eager test configuration completes the run before returning.
        run.refresh_from_db()
        return Response(run_payload(run), status=status.HTTP_202_ACCEPTED)


class DatasetRunsView(APIView):
    def get(self, request, dataset_id):  # type: ignore[no-untyped-def]
        _membership(request)
        return Response(runs_payload(_dataset(request, dataset_id)))


class DatasetIssuesView(APIView):
    def get(self, request, dataset_id):  # type: ignore[no-untyped-def]
        _membership(request)
        dataset = _dataset(request, dataset_id)
        try:
            limit = min(max(int(request.query_params.get("limit", "50")), 1), 200)
        except ValueError:
            limit = 50
        return Response(issues_payload(dataset, limit=limit))


class QualitySummaryView(APIView):
    """One organisation-wide view of rejected rows and their reasons."""

    def get(self, request):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        datasets = Dataset.objects.filter(organisation=membership.organisation).prefetch_related(
            "processing_runs"
        )

        by_code: dict[str, int] = {}
        by_dataset = []
        total_rejected = 0
        total_issues = 0
        for dataset in datasets:
            issues = dataset.quality_issues.all()
            counts = {}
            for issue in issues:
                counts[issue.code] = counts.get(issue.code, 0) + 1
                by_code[issue.code] = by_code.get(issue.code, 0) + 1
            latest = dataset.processing_runs.first()
            rejected = latest.rows_rejected if latest else 0
            total_rejected += rejected
            total_issues += sum(counts.values())
            by_dataset.append(
                {
                    "dataset_id": str(dataset.id),
                    "name": dataset.name,
                    "status": dataset.status,
                    "rows_read": latest.rows_read if latest else 0,
                    "rows_rejected": rejected,
                    "issues": sum(counts.values()),
                    "reasons": [
                        {"code": code, "count": count}
                        for code, count in sorted(counts.items(), key=lambda item: -item[1])
                    ],
                    "last_run_at": latest.created_at.isoformat() if latest else None,
                }
            )

        by_dataset.sort(key=lambda item: (-item["rows_rejected"], item["name"].lower()))
        return Response(
            {
                "dataset_count": len(by_dataset),
                "rows_rejected": total_rejected,
                "open_issues": total_issues,
                "reasons": [
                    {"code": code, "count": count}
                    for code, count in sorted(by_code.items(), key=lambda item: -item[1])
                ],
                "datasets": by_dataset,
            }
        )

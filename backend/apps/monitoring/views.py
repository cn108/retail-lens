import uuid
from datetime import date
from decimal import Decimal, InvalidOperation

from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.datasets.models import Dataset
from apps.organisations.models import Membership
from apps.organisations.services import active_membership_for
from apps.reporting.models import SavedReport

from .models import (
    AlertComparator,
    AlertEvent,
    AlertMetric,
    AlertRule,
    Board,
    ReportSchedule,
    ScheduleFrequency,
    Target,
    TargetMetric,
)
from .services import (
    alert_payload,
    board_payload,
    evaluate_rule,
    metric_choices,
    next_run_for,
    normalise_recipients,
    schedule_payload,
    target_progress,
)

WRITE_ROLES = {"owner", "admin", "analyst"}


def _membership(request) -> Membership:  # type: ignore[no-untyped-def]
    membership = active_membership_for(request.user, request.headers.get("X-Organisation-Id"))
    if membership is None:
        raise NotFound("You do not belong to any organisation.")
    return membership


def _require_writer(membership: Membership) -> None:
    if membership.role not in WRITE_ROLES:
        raise PermissionDenied("Your role can view monitoring but not change it.")


def _decimal(raw, field: str, *, allow_zero: bool = True) -> Decimal:  # type: ignore[no-untyped-def]
    try:
        value = Decimal(str(raw))
    except (InvalidOperation, TypeError, ValueError) as error:
        raise ValidationError({field: "Use a number."}) from error
    if value < 0 or (not allow_zero and value == 0):
        raise ValidationError({field: "Use a positive number."})
    return value


def _date(raw, field: str) -> date:
    try:
        return date.fromisoformat(str(raw))
    except (TypeError, ValueError) as error:
        raise ValidationError({field: "Use an ISO date (YYYY-MM-DD)."}) from error


def _dataset(raw, organisation):  # type: ignore[no-untyped-def]
    if not raw:
        return None
    dataset = Dataset.objects.filter(id=raw, organisation=organisation).first()
    if dataset is None:
        raise ValidationError({"dataset": "Dataset not found."})
    return dataset


class AlertListView(APIView):
    def get(self, request):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        rules = AlertRule.objects.filter(organisation=membership.organisation).prefetch_related(
            "events"
        )
        return Response(
            {
                "metrics": metric_choices(),
                "rules": [alert_payload(rule) for rule in rules],
            }
        )

    def post(self, request):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        _require_writer(membership)
        payload = request.data or {}
        name = str(payload.get("name") or "").strip()
        if not name:
            raise ValidationError({"name": "Give the alert a name."})
        metric = payload.get("metric")
        if metric not in AlertMetric.values:
            raise ValidationError({"metric": "Choose a metric."})
        comparator = payload.get("comparator", AlertComparator.BELOW)
        if comparator not in AlertComparator.values:
            raise ValidationError({"comparator": "Use below or above."})
        try:
            window = min(max(int(payload.get("window_days") or 30), 1), 365)
        except (TypeError, ValueError) as error:
            raise ValidationError({"window_days": "Use whole days between 1 and 365."}) from error

        rule = AlertRule.objects.create(
            organisation=membership.organisation,
            dataset=_dataset(payload.get("dataset"), membership.organisation),
            name=name[:160],
            metric=metric,
            comparator=comparator,
            threshold=_decimal(payload.get("threshold"), "threshold"),
            window_days=window,
            enabled=bool(payload.get("enabled", True)),
            created_by=request.user,
        )
        return Response(alert_payload(rule), status=201)


class AlertDetailView(APIView):
    def _rule(self, request, rule_id: uuid.UUID) -> AlertRule:  # type: ignore[no-untyped-def]
        membership = _membership(request)
        rule = AlertRule.objects.filter(id=rule_id, organisation=membership.organisation).first()
        if rule is None:
            raise NotFound("Alert not found.")
        return rule

    def patch(self, request, rule_id: uuid.UUID):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        _require_writer(membership)
        rule = self._rule(request, rule_id)
        payload = request.data or {}
        if "name" in payload:
            name = str(payload.get("name") or "").strip()
            if not name:
                raise ValidationError({"name": "Give the alert a name."})
            rule.name = name[:160]
        if "threshold" in payload:
            rule.threshold = _decimal(payload.get("threshold"), "threshold")
        if "window_days" in payload:
            try:
                rule.window_days = min(max(int(payload["window_days"]), 1), 365)
            except (TypeError, ValueError) as error:
                raise ValidationError({"window_days": "Use whole days."}) from error
        if "comparator" in payload:
            if payload["comparator"] not in AlertComparator.values:
                raise ValidationError({"comparator": "Use below or above."})
            rule.comparator = payload["comparator"]
        if "enabled" in payload:
            rule.enabled = bool(payload["enabled"])
        rule.save()
        return Response(alert_payload(rule))

    def delete(self, request, rule_id: uuid.UUID):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        _require_writer(membership)
        self._rule(request, rule_id).delete()
        return Response(status=204)


class AlertEvaluateView(APIView):
    def post(self, request):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        _require_writer(membership)
        rules = AlertRule.objects.filter(organisation=membership.organisation, enabled=True)
        events = 0
        for rule in rules:
            if evaluate_rule(rule) is not None:
                events += 1
        refreshed = AlertRule.objects.filter(organisation=membership.organisation).prefetch_related(
            "events"
        )
        return Response(
            {
                "created_events": events,
                "metrics": metric_choices(),
                "rules": [alert_payload(rule) for rule in refreshed],
            }
        )


class AlertEventAcknowledgeView(APIView):
    def post(self, request, event_id: uuid.UUID):  # type: ignore[no-untyped-def]
        from django.utils import timezone

        membership = _membership(request)
        _require_writer(membership)
        event = AlertEvent.objects.filter(
            id=event_id, rule__organisation=membership.organisation
        ).first()
        if event is None:
            raise NotFound("Alert event not found.")
        event.acknowledged_at = timezone.now()
        event.save(update_fields=["acknowledged_at"])
        return Response({"id": str(event.id), "acknowledged_at": event.acknowledged_at.isoformat()})


class TargetListView(APIView):
    def get(self, request):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        targets = Target.objects.filter(organisation=membership.organisation)
        return Response({"targets": [target_progress(target) for target in targets]})

    def post(self, request):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        _require_writer(membership)
        payload = request.data or {}
        name = str(payload.get("name") or "").strip()
        if not name:
            raise ValidationError({"name": "Give the target a name."})
        metric = payload.get("metric")
        if metric not in TargetMetric.values:
            raise ValidationError({"metric": "Choose a metric."})
        start = _date(payload.get("period_start"), "period_start")
        end = _date(payload.get("period_end"), "period_end")
        if start > end:
            raise ValidationError({"period_start": "The start must not be after the end."})

        target = Target.objects.create(
            organisation=membership.organisation,
            dataset=_dataset(payload.get("dataset"), membership.organisation),
            name=name[:160],
            metric=metric,
            amount=_decimal(payload.get("amount"), "amount", allow_zero=False),
            period_start=start,
            period_end=end,
            created_by=request.user,
        )
        return Response(target_progress(target), status=201)


class TargetDetailView(APIView):
    def _target(self, request, target_id: uuid.UUID) -> Target:  # type: ignore[no-untyped-def]
        membership = _membership(request)
        target = Target.objects.filter(id=target_id, organisation=membership.organisation).first()
        if target is None:
            raise NotFound("Target not found.")
        return target

    def delete(self, request, target_id: uuid.UUID):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        _require_writer(membership)
        self._target(request, target_id).delete()
        return Response(status=204)


class ScheduleListView(APIView):
    def get(self, request):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        schedules = ReportSchedule.objects.filter(
            organisation=membership.organisation
        ).select_related("report")
        return Response({"schedules": [schedule_payload(schedule) for schedule in schedules]})

    def post(self, request):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        _require_writer(membership)
        payload = request.data or {}
        report = SavedReport.objects.filter(
            id=payload.get("report"), organisation=membership.organisation
        ).first()
        if report is None:
            raise ValidationError({"report": "Choose one of this organisation's reports."})
        frequency = payload.get("frequency", ScheduleFrequency.WEEKLY)
        if frequency not in ScheduleFrequency.values:
            raise ValidationError({"frequency": "Use daily, weekly or monthly."})
        export_format = payload.get("format", "csv")
        if export_format not in {"csv", "pdf"}:
            raise ValidationError({"format": "Use csv or pdf."})
        recipients = normalise_recipients(payload.get("recipients"))
        if not recipients:
            raise ValidationError({"recipients": "Add at least one email address."})

        schedule = ReportSchedule.objects.create(
            organisation=membership.organisation,
            report=report,
            frequency=frequency,
            format=export_format,
            recipients=recipients,
            enabled=bool(payload.get("enabled", True)),
            next_run_at=next_run_for(frequency),
            created_by=request.user,
        )
        return Response(schedule_payload(schedule), status=201)


class ScheduleDetailView(APIView):
    def _schedule(self, request, schedule_id: uuid.UUID) -> ReportSchedule:  # type: ignore[no-untyped-def]
        membership = _membership(request)
        schedule = (
            ReportSchedule.objects.filter(id=schedule_id, organisation=membership.organisation)
            .select_related("report")
            .first()
        )
        if schedule is None:
            raise NotFound("Schedule not found.")
        return schedule

    def patch(self, request, schedule_id: uuid.UUID):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        _require_writer(membership)
        schedule = self._schedule(request, schedule_id)
        payload = request.data or {}
        if "frequency" in payload:
            if payload["frequency"] not in ScheduleFrequency.values:
                raise ValidationError({"frequency": "Use daily, weekly or monthly."})
            schedule.frequency = payload["frequency"]
            schedule.next_run_at = next_run_for(schedule.frequency)
        if "format" in payload:
            if payload["format"] not in {"csv", "pdf"}:
                raise ValidationError({"format": "Use csv or pdf."})
            schedule.format = payload["format"]
        if "recipients" in payload:
            recipients = normalise_recipients(payload.get("recipients"))
            if not recipients:
                raise ValidationError({"recipients": "Add at least one email address."})
            schedule.recipients = recipients
        if "enabled" in payload:
            schedule.enabled = bool(payload["enabled"])
        schedule.save()
        return Response(schedule_payload(schedule))

    def delete(self, request, schedule_id: uuid.UUID):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        _require_writer(membership)
        self._schedule(request, schedule_id).delete()
        return Response(status=204)


class BoardListView(APIView):
    ALLOWED_WIDGETS = {
        "kpi",
        "trend",
        "geography",
        "returns",
        "basket",
        "top_products",
        "targets",
        "alerts",
    }

    def get(self, request):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        boards = Board.objects.filter(organisation=membership.organisation).select_related(
            "created_by"
        )
        return Response({"boards": [board_payload(board) for board in boards]})

    def post(self, request):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        _require_writer(membership)
        payload = request.data or {}
        name = str(payload.get("name") or "").strip()
        if not name:
            raise ValidationError({"name": "Give the board a name."})
        widgets = payload.get("widgets") or []
        if not isinstance(widgets, list):
            raise ValidationError({"widgets": "Widgets must be a list."})
        cleaned = [widget for widget in widgets if widget.get("type") in self.ALLOWED_WIDGETS]
        if not cleaned:
            raise ValidationError({"widgets": "Add at least one supported widget."})

        board = Board.objects.create(
            organisation=membership.organisation,
            name=name[:160],
            description=str(payload.get("description") or "")[:255],
            widgets=cleaned[:12],
            created_by=request.user,
        )
        return Response(board_payload(board), status=201)


class BoardDetailView(APIView):
    def _board(self, request, board_id: uuid.UUID) -> Board:  # type: ignore[no-untyped-def]
        membership = _membership(request)
        board = Board.objects.filter(id=board_id, organisation=membership.organisation).first()
        if board is None:
            raise NotFound("Board not found.")
        return board

    def patch(self, request, board_id: uuid.UUID):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        _require_writer(membership)
        board = self._board(request, board_id)
        payload = request.data or {}
        if "name" in payload:
            name = str(payload.get("name") or "").strip()
            if not name:
                raise ValidationError({"name": "Give the board a name."})
            board.name = name[:160]
        if "description" in payload:
            board.description = str(payload.get("description") or "")[:255]
        if "widgets" in payload:
            widgets = payload.get("widgets") or []
            if not isinstance(widgets, list):
                raise ValidationError({"widgets": "Widgets must be a list."})
            board.widgets = [
                widget for widget in widgets if widget.get("type") in BoardListView.ALLOWED_WIDGETS
            ][:12]
        board.save()
        return Response(board_payload(board))

    def delete(self, request, board_id: uuid.UUID):  # type: ignore[no-untyped-def]
        membership = _membership(request)
        _require_writer(membership)
        self._board(request, board_id).delete()
        return Response(status=204)

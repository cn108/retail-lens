from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.core import mail
from django.urls import reverse
from django.utils import timezone

from apps.monitoring.models import AlertRule, AlertState, ReportSchedule
from apps.reporting.models import SavedReport
from tests.warehouse import add_line, warehouse


def seed_sales(organisation, net="100.00"):
    dataset = warehouse(organisation)
    add_line(
        dataset,
        when=timezone.localdate(),
        invoice="INV-1",
        quantity=1,
        customer="C-1",
        net=net,
    )
    return dataset


@pytest.mark.django_db
def test_alert_rule_records_a_first_breach_only(auth_client, organisation):
    seed_sales(organisation)
    created = auth_client.post(
        reverse("alert-list"),
        {
            "name": "Net sales floor",
            "metric": "net_sales",
            "comparator": "below",
            "threshold": "500.00",
            "window_days": 7,
        },
        format="json",
    )
    assert created.status_code == 201
    rule_id = created.json()["id"]

    first = auth_client.post(reverse("alert-evaluate")).json()
    assert first["created_events"] == 1
    rule = next(item for item in first["rules"] if item["id"] == rule_id)
    assert rule["last_state"] == AlertState.BREACHED
    assert rule["events"][0]["value"] == "100.0000"

    # A second sweep while the rule is still breached is not a new event.
    second = auth_client.post(reverse("alert-evaluate")).json()
    assert second["created_events"] == 0
    assert len(second["rules"][0]["events"]) == 1


@pytest.mark.django_db
def test_alert_returns_to_ok_when_the_threshold_is_met(auth_client, organisation):
    seed_sales(organisation, net="900.00")
    auth_client.post(
        reverse("alert-list"),
        {
            "name": "Net sales floor",
            "metric": "net_sales",
            "comparator": "below",
            "threshold": "500.00",
            "window_days": 7,
        },
        format="json",
    )

    payload = auth_client.post(reverse("alert-evaluate")).json()

    assert payload["created_events"] == 0
    assert payload["rules"][0]["last_state"] == AlertState.OK


@pytest.mark.django_db
def test_alert_threshold_must_be_a_number(auth_client, organisation):
    response = auth_client.post(
        reverse("alert-list"),
        {"name": "Bad", "metric": "net_sales", "threshold": "abc", "window_days": 7},
        format="json",
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_target_progress_uses_the_target_period(auth_client, organisation):
    seed_sales(organisation, net="250.00")
    today = timezone.localdate()
    created = auth_client.post(
        reverse("target-list"),
        {
            "name": "March goal",
            "metric": "net_sales",
            "amount": "1000.00",
            "period_start": today.replace(day=1).isoformat(),
            "period_end": (today.replace(day=1) + timedelta(days=27)).isoformat(),
        },
        format="json",
    )

    assert created.status_code == 201
    payload = created.json()
    assert payload["target"] == "1000.00"
    assert payload["actual"] == "250.0000"
    assert payload["attainment_percent"] == "25.00"
    assert payload["pace"] in {"ahead", "behind"}


@pytest.mark.django_db
def test_saving_a_segment_and_listing_its_members(auth_client, organisation):
    dataset = warehouse(organisation)
    add_line(
        dataset,
        when=date(2024, 3, 1),
        invoice="INV-1",
        quantity=1,
        customer="C-BIG",
        net="500.00",
    )
    add_line(
        dataset,
        when=date(2024, 3, 2),
        invoice="INV-2",
        quantity=1,
        customer="C-SMALL",
        net="5.00",
    )

    created = auth_client.post(
        reverse("segment-list"),
        {"name": "High value", "rules": {"net_sales_min": "100", "orders_min": 1}},
        format="json",
    )
    assert created.status_code == 201
    segment_id = created.json()["id"]

    members = auth_client.get(reverse("segment-members", args=[segment_id])).json()

    assert members["total"] == 1
    assert members["customers"][0]["source_customer_id"] == "C-BIG"
    assert members["net_sales"] == "500.0000"


@pytest.mark.django_db
def test_unknown_segment_rule_is_rejected(auth_client, organisation):
    response = auth_client.post(
        reverse("segment-list"),
        {"name": "Nope", "rules": {"magic": 1}},
        format="json",
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_schedule_delivers_a_csv_attachment(auth_client, organisation, settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    seed_sales(organisation)
    report = SavedReport.objects.create(
        organisation=organisation, name="Weekly sales", kind="sales"
    )

    created = auth_client.post(
        reverse("schedule-list"),
        {
            "report": str(report.id),
            "frequency": "weekly",
            "format": "csv",
            "recipients": "ops@example.com",
        },
        format="json",
    )
    assert created.status_code == 201

    schedule = ReportSchedule.objects.get()
    from apps.monitoring.services import run_schedule

    status = run_schedule(schedule)

    assert status == "succeeded"
    assert len(mail.outbox) == 1
    assert mail.outbox[0].to == ["ops@example.com"]
    assert mail.outbox[0].attachments[0][0].endswith(".csv")
    schedule.refresh_from_db()
    assert schedule.last_status == "succeeded"
    assert schedule.next_run_at > timezone.now()


@pytest.mark.django_db
def test_schedule_requires_a_recipient(auth_client, organisation):
    report = SavedReport.objects.create(
        organisation=organisation, name="Weekly sales", kind="sales"
    )
    response = auth_client.post(
        reverse("schedule-list"),
        {"report": str(report.id), "frequency": "weekly", "format": "csv", "recipients": ""},
        format="json",
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_board_stores_only_supported_widgets(auth_client, organisation):
    response = auth_client.post(
        reverse("board-list"),
        {
            "name": "Ops board",
            "widgets": [
                {"type": "kpi", "title": "Headline"},
                {"type": "geography", "title": "Countries"},
                {"type": "nonsense", "title": "Ignored"},
            ],
        },
        format="json",
    )

    assert response.status_code == 201
    assert [widget["type"] for widget in response.json()["widgets"]] == ["kpi", "geography"]


@pytest.mark.django_db
def test_viewer_cannot_create_an_alert(api_for, member, organisation):
    response = api_for(member.user).post(
        reverse("alert-list"),
        {"name": "Nope", "metric": "net_sales", "threshold": "1", "window_days": 7},
        format="json",
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_alert_rules_are_organisation_scoped(auth_client, organisation, other_user):
    from apps.organisations.services import create_organisation

    other = create_organisation(name="Other", owner=other_user)
    AlertRule.objects.create(
        organisation=other,
        name="Theirs",
        metric="net_sales",
        comparator="below",
        threshold=Decimal("1"),
        window_days=7,
    )

    assert auth_client.get(reverse("alert-list")).json()["rules"] == []

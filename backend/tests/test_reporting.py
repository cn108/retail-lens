import os
from datetime import date

import pytest
from django.urls import reverse

from apps.organisations.services import create_organisation
from apps.reporting import services as reporting_services
from apps.reporting import tasks as reporting_tasks
from apps.reporting.models import ExportStatus, ReportJob, SavedReport
from tests.warehouse import add_line, warehouse


@pytest.fixture(autouse=True)
def _organisation(organisation):
    """Every report in this module belongs to the owner's organisation."""
    return organisation


def seed_sales(organisation, name="Reporting sales"):
    dataset = warehouse(organisation, name)
    add_line(
        dataset,
        when=date(2024, 1, 5),
        invoice="INV-1",
        quantity=2,
        price="10.00",
        customer="C-1",
        product="SKU-1",
        description="Widget",
    )
    add_line(
        dataset,
        when=date(2024, 2, 5),
        invoice="INV-2",
        quantity=1,
        price="20.00",
        customer="C-2",
        product="=SKU-2",
        description="Gadget",
    )
    return dataset


def create_report(client, dataset=None, **overrides):
    payload = {
        "name": "Board pack",
        "kind": "sales",
    }
    if dataset is not None:
        payload["dataset"] = str(dataset.id)
    payload.update(overrides)
    return client.post(reverse("report-list"), payload, format="json")


def create_export(client, report_id, fmt="csv"):
    return client.post(
        reverse("report-export-list", args=[report_id]),
        {"format": fmt},
        format="json",
    )


def summary_value(payload, label):
    return next(card["value"] for card in payload["summary"] if card["label"] == label)


@pytest.mark.django_db
def test_sales_report_uses_shared_metrics_and_definitions(auth_client, organisation):
    dataset = seed_sales(organisation)

    response = create_report(auth_client, dataset)

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Board pack"
    assert body["kind_label"] == "Sales performance"
    assert body["dataset"] == {"id": str(dataset.id), "name": "Reporting sales"}
    assert body["has_data"] is True
    assert summary_value(body, "Net sales") == "40.0000"
    assert summary_value(body, "Eligible orders") == 2
    assert summary_value(body, "Unique customers") == 2
    assert body["period"] == {"date_from": "2024-01-05", "date_to": "2024-02-05"}
    monthly = next(section for section in body["sections"] if section["key"] == "monthly_sales")
    assert [row["month"] for row in monthly["rows"]] == ["Jan 2024", "Feb 2024"]
    assert [row["net"] for row in monthly["rows"]] == ["20.0000", "20.0000"]
    assert {definition["metric"] for definition in body["definitions"]} >= {
        "Net sales",
        "Gross sales",
        "Eligible orders",
    }
    assert body["generated_at"]


@pytest.mark.django_db
def test_a_report_can_span_every_processed_dataset(auth_client, organisation):
    seed_sales(organisation, "First")
    second = warehouse(organisation, "Second")
    add_line(
        second,
        when=date(2024, 1, 9),
        invoice="INV-9",
        quantity=1,
        price="30.00",
        product="SKU-9",
        description="Thing",
    )

    response = create_report(auth_client, None, name="All data")

    assert response.status_code == 201
    body = response.json()
    assert body["dataset"] is None
    assert summary_value(body, "Net sales") == "70.0000"
    assert any("not merged across datasets" in note for note in body["notes"])


@pytest.mark.django_db
def test_a_report_can_be_updated_with_new_filters(auth_client, organisation):
    dataset = seed_sales(organisation)
    report = create_report(auth_client, dataset).json()

    response = auth_client.patch(
        reverse("report-detail", args=[report["id"]]),
        {
            "name": "Updated pack",
            "kind": "customers",
            "date_from": "2024-02-01",
            "date_to": "2024-02-28",
        },
        format="json",
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Updated pack"
    assert body["kind"] == "customers"
    assert body["date_from"] == "2024-02-01"
    assert body["date_to"] == "2024-02-28"
    assert body["period"] == {"date_from": "2024-02-01", "date_to": "2024-02-28"}

    reversed_range = auth_client.patch(
        reverse("report-detail", args=[report["id"]]),
        {"date_from": "2024-03-01", "date_to": "2024-01-01"},
        format="json",
    )
    assert reversed_range.status_code == 400


@pytest.mark.django_db
def test_viewers_cannot_update_reports(api_for, member, auth_client, organisation):
    report = create_report(auth_client, seed_sales(organisation)).json()

    response = api_for(member.user).patch(
        reverse("report-detail", args=[report["id"]]),
        {"name": "Nope"},
        format="json",
    )

    assert response.status_code == 403


@pytest.mark.django_db
def test_all_exports_are_scoped_to_the_organisation(auth_client, api_for, other_user, organisation):
    dataset = seed_sales(organisation)
    report = create_report(auth_client, dataset).json()
    create_export(auth_client, report["id"], "csv")

    listing = auth_client.get(reverse("report-export-all"))
    assert listing.status_code == 200
    assert [item["report_name"] for item in listing.json()] == ["Board pack"]

    foreign_org = create_organisation(name="Elsewhere exports", owner=other_user)
    foreign_dataset = warehouse(foreign_org, "Foreign export")
    foreign = create_report(api_for(other_user), foreign_dataset).json()
    create_export(api_for(other_user), foreign["id"], "csv")

    listing = auth_client.get(reverse("report-export-all")).json()
    assert [item["report_name"] for item in listing] == ["Board pack"]


@pytest.mark.django_db
def test_customer_and_product_reports_have_their_own_sections(auth_client, organisation):
    dataset = seed_sales(organisation)

    customers = create_report(auth_client, dataset, name="Customers", kind="customers")
    assert customers.status_code == 201
    customer_body = customers.json()
    assert summary_value(customer_body, "Identifiable customers") == 2
    assert {section["key"] for section in customer_body["sections"]} == {
        "rfm_segments",
        "top_customers",
    }

    products = create_report(auth_client, dataset, name="Products", kind="products")
    assert products.status_code == 201
    product_body = products.json()
    assert summary_value(product_body, "Products sold") == 2
    assert product_body["sections"][0]["key"] == "products"


@pytest.mark.django_db
def test_csv_export_is_queued_and_downloadable(auth_client, organisation):
    report = create_report(auth_client, seed_sales(organisation)).json()

    response = create_export(auth_client, report["id"], "csv")

    assert response.status_code == 202
    job = response.json()
    assert job["status"] == "succeeded"
    assert job["format"] == "csv"
    assert job["filename"].endswith(".csv")
    assert job["row_count"] > 0
    assert job["download_url"]

    download = auth_client.get(reverse("report-export-download", args=[report["id"], job["id"]]))
    assert download.status_code == 200
    assert download["Content-Type"].startswith("text/csv")
    assert "attachment" in download["Content-Disposition"]
    content = download.content
    assert content.startswith(b"\xef\xbb\xbf")
    text = content.decode("utf-8-sig")
    assert "RetailLens report" in text
    assert "Board pack" in text
    assert "Net sales" in text
    assert "Metric definitions" in text
    # Product codes from the source are neutralised as CSV formulas.
    assert "'=SKU-2" in text


@pytest.mark.django_db
def test_export_is_enqueued_only_after_its_job_is_committed(
    auth_client, organisation, monkeypatch, settings, django_capture_on_commit_callbacks
):
    report = create_report(auth_client, seed_sales(organisation)).json()
    enqueued = []
    monkeypatch.setattr(reporting_tasks.generate_export, "delay", enqueued.append)
    settings.CELERY_TASK_ALWAYS_EAGER = False

    with django_capture_on_commit_callbacks(execute=False) as callbacks:
        response = create_export(auth_client, report["id"], "csv")
        assert response.status_code == 202
        assert enqueued == []

    callbacks[0]()
    assert enqueued == [response.json()["id"]]


@pytest.mark.django_db
def test_pdf_export_is_a_real_pdf(auth_client, organisation):
    report = create_report(auth_client, seed_sales(organisation)).json()

    job = create_export(auth_client, report["id"], "pdf").json()

    assert job["status"] == "succeeded"
    assert job["filename"].endswith(".pdf")
    download = auth_client.get(reverse("report-export-download", args=[report["id"], job["id"]]))
    assert download.status_code == 200
    assert download["Content-Type"] == "application/pdf"
    assert download.content.startswith(b"%PDF")
    assert b"%%EOF" in download.content
    assert len(download.content) > 1000


@pytest.mark.django_db
def test_exports_list_and_detail_belong_to_their_report(auth_client, organisation):
    report = create_report(auth_client, seed_sales(organisation)).json()
    job = create_export(auth_client, report["id"], "csv").json()

    listing = auth_client.get(reverse("report-export-list", args=[report["id"]]))
    assert listing.status_code == 200
    assert [item["id"] for item in listing.json()] == [job["id"]]

    detail = auth_client.get(reverse("report-export-detail", args=[report["id"], job["id"]]))
    assert detail.status_code == 200
    assert detail.json()["status"] == "succeeded"

    foreign = ReportJob.objects.create(
        report=SavedReport.objects.create(
            organisation=organisation,
            dataset=warehouse(organisation, "Other"),
            name="Other",
            kind="sales",
        ),
        format="csv",
    )
    assert (
        auth_client.get(
            reverse("report-export-detail", args=[report["id"], foreign.id])
        ).status_code
        == 404
    )


@pytest.mark.django_db
def test_viewers_read_but_cannot_create_export_or_delete(
    api_for, member, auth_client, organisation
):
    report = create_report(auth_client, seed_sales(organisation)).json()
    viewer = api_for(member.user)

    assert viewer.get(reverse("report-list")).status_code == 200
    assert viewer.get(reverse("report-detail", args=[report["id"]])).status_code == 200
    assert create_report(viewer, warehouse(organisation, "Viewer")).status_code == 403
    assert create_export(viewer, report["id"]).status_code == 403
    assert viewer.delete(reverse("report-detail", args=[report["id"]])).status_code == 403


@pytest.mark.django_db
def test_foreign_report_and_dataset_are_hidden(auth_client, api_for, other_user, organisation):
    dataset = seed_sales(organisation)
    report = create_report(auth_client, dataset).json()

    foreign_org = create_organisation(name="Elsewhere", owner=other_user)
    foreign_dataset = warehouse(foreign_org, "Foreign")
    assert create_report(auth_client, foreign_dataset).status_code == 404
    assert api_for(other_user).get(reverse("report-detail", args=[report["id"]])).status_code == 404


@pytest.mark.django_db
def test_invalid_report_and_export_requests_are_rejected(auth_client, organisation):
    dataset = seed_sales(organisation)

    assert create_report(auth_client, dataset, kind="profit").status_code == 400
    assert create_report(auth_client, dataset, name="  ").status_code == 400
    reversed_range = create_report(
        auth_client,
        dataset,
        date_from="2024-03-01",
        date_to="2024-01-01",
    )
    assert reversed_range.status_code == 400

    report = create_report(auth_client, dataset).json()
    assert create_export(auth_client, report["id"], "xlsx").status_code == 400


@pytest.mark.django_db
def test_empty_report_is_explicit_and_still_exportable(auth_client, organisation):
    dataset = warehouse(organisation, "No facts")
    report = create_report(auth_client, dataset).json()

    assert report["has_data"] is False
    assert all(section["rows"] == [] for section in report["sections"])
    assert summary_value(report, "Net sales") == "0.0000"

    job = create_export(auth_client, report["id"], "csv").json()
    assert job["status"] == "succeeded"
    assert job["row_count"] == 0


@pytest.mark.django_db
def test_a_second_active_export_is_rejected(auth_client, organisation):
    dataset = seed_sales(organisation)
    report = create_report(auth_client, dataset).json()
    job = ReportJob.objects.create(report_id=report["id"], format="csv", status=ExportStatus.QUEUED)

    assert create_export(auth_client, report["id"]).status_code == 409
    assert (
        auth_client.get(reverse("report-export-download", args=[report["id"], job.id])).status_code
        == 409
    )


@pytest.mark.django_db
def test_failed_export_records_the_error(auth_client, organisation, monkeypatch):
    report = create_report(auth_client, seed_sales(organisation)).json()

    def explode(payload):
        raise RuntimeError("renderer failed")

    monkeypatch.setattr(reporting_services, "render_pdf", explode)

    job = create_export(auth_client, report["id"], "pdf").json()

    assert job["status"] == "failed"
    assert "renderer failed" in job["error_message"]
    stored = ReportJob.objects.get(pk=job["id"])
    assert stored.status == ExportStatus.FAILED
    assert not stored.file


@pytest.mark.django_db
def test_deleting_a_report_removes_its_export_files(auth_client, organisation):
    report = create_report(auth_client, seed_sales(organisation)).json()
    job = create_export(auth_client, report["id"], "csv").json()
    stored = ReportJob.objects.get(pk=job["id"])
    path = stored.file.path
    assert os.path.exists(path)

    response = auth_client.delete(reverse("report-detail", args=[report["id"]]))

    assert response.status_code == 204
    assert not SavedReport.objects.filter(pk=report["id"]).exists()
    assert not ReportJob.objects.filter(pk=job["id"]).exists()
    assert not os.path.exists(path)


@pytest.mark.django_db
def test_deleting_a_dataset_removes_its_reports(auth_client, organisation):
    dataset = seed_sales(organisation)
    report = create_report(auth_client, dataset).json()
    job = create_export(auth_client, report["id"], "csv").json()
    path = ReportJob.objects.get(pk=job["id"]).file.path

    response = auth_client.delete(reverse("dataset-detail", args=[dataset.id]))

    assert response.status_code == 204
    assert not SavedReport.objects.filter(pk=report["id"]).exists()
    assert not ReportJob.objects.filter(report_id=report["id"]).exists()
    assert not os.path.exists(path)

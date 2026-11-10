import csv
import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse

from apps.datasets.models import Dataset
from apps.ingestion.models import (
    DataQualityIssue,
    DimCustomer,
    DimGeography,
    DimProduct,
    FactReturn,
    FactSales,
    ProcessingLog,
    RawTransaction,
)

HEADER = [
    "InvoiceNo",
    "InvoiceDate",
    "StockCode",
    "Description",
    "Quantity",
    "UnitPrice",
    "CustomerID",
    "Country",
    "LineNo",
    "Discount",
    "IsReturn",
]

ROWS = [
    [
        "INV-100",
        "01/02/2024",
        "SKU-1",
        "Widget",
        "2",
        "10.00",
        "C-1",
        "United Kingdom",
        "1",
        "0",
        "false",
    ],
    ["INV-100", "01/02/2024", "SKU-2", "Gadget", "1", "20.00", "", "United Kingdom", "2", "", ""],
    ["INV-101", "02/02/2024", "SKU-1", "Widget", "-3", "10.00", "C-2", "France", "1", "", ""],
    ["INV-102", "not-a-date", "SKU-1", "Widget", "1", "5.00", "", "United Kingdom", "1", "", ""],
    ["INV-103", "03/02/2024", "SKU-2", "Gadget", "two", "5.00", "", "United Kingdom", "1", "", ""],
    ["INV-104", "03/02/2024", "", "Gadget", "1", "5.00", "", "United Kingdom", "1", "", ""],
    [
        "INV-105",
        "03/02/2024",
        "SKU-3",
        "Thing",
        "4",
        "2.50",
        "C-1",
        "United Kingdom",
        "1",
        "1.00",
        "true",
    ],
]


def csv_bytes(header: list[str], rows: list[list[str]]) -> bytes:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(header)
    for row in rows:
        writer.writerow(row)
    return buffer.getvalue().encode()


@pytest.fixture(autouse=True)
def _organisation(organisation):
    return organisation


def prepared_dataset(api_client, rows=None, header=None) -> dict:
    content = csv_bytes(header or HEADER, rows if rows is not None else ROWS)
    response = api_client.post(
        reverse("dataset-list"),
        {"file": SimpleUploadedFile("transactions.csv", content, content_type="text/csv")},
        format="multipart",
    )
    assert response.status_code == 201, response.json()
    detail = response.json()
    mapping = {str(column["id"]): column["suggested_field"] for column in detail["columns"]}
    saved = api_client.put(
        reverse("dataset-mapping", args=[detail["id"]]),
        {"mapping": mapping},
        format="json",
    )
    assert saved.status_code == 200, saved.json()
    assert saved.json()["mapping_complete"] is True
    return saved.json()


def process(api_client, dataset_id):
    return api_client.post(reverse("dataset-process", args=[dataset_id]))


@pytest.mark.django_db
def test_processing_loads_facts_dimensions_and_quality(auth_client):
    dataset = prepared_dataset(auth_client)

    response = process(auth_client, dataset["id"])

    assert response.status_code == 202
    run = response.json()
    assert run["status"] == "succeeded"
    assert run["rows_read"] == 7
    assert run["rows_loaded"] == 4
    assert run["rows_rejected"] == 3
    assert run["summary"]["sales_rows"] == 2
    assert run["summary"]["return_rows"] == 2
    assert run["summary"]["raw_rows"] == 7
    assert run["summary"]["issues"] == 3

    dataset_row = Dataset.objects.get(pk=dataset["id"])
    assert dataset_row.status == "ready"

    sales = {
        (line.source_invoice_id, line.source_line_identifier): line
        for line in FactSales.objects.filter(dataset=dataset_row)
    }
    first = sales[("INV-100", "1")]
    assert first.quantity == 2
    assert first.unit_price == 10
    assert first.gross_line_amount == 20
    assert first.discount_amount == 0
    assert first.net_line_amount == 20
    assert sales[("INV-100", "2")].customer_key is None

    returns = {
        (line.source_invoice_id, line.source_line_identifier): line
        for line in FactReturn.objects.filter(dataset=dataset_row)
    }
    negative = returns[("INV-101", "1")]
    assert negative.quantity == -3
    assert negative.net_line_amount == -30
    flagged = returns[("INV-105", "1")]
    assert flagged.quantity == -4
    assert flagged.gross_line_amount == -10
    assert flagged.discount_amount == 1
    # The discount reduces the absolute amount of the return.
    assert flagged.net_line_amount == -9

    assert FactSales.objects.filter(dataset=dataset_row, quantity__lte=0).count() == 0
    assert FactReturn.objects.filter(dataset=dataset_row, quantity__gte=0).count() == 0

    assert DimCustomer.objects.filter(dataset=dataset_row).count() == 2
    assert DimProduct.objects.filter(dataset=dataset_row).count() == 3
    assert DimGeography.objects.filter(dataset=dataset_row).count() == 2


@pytest.mark.django_db
def test_raw_rows_are_preserved_including_rejected_rows(auth_client):
    dataset = prepared_dataset(auth_client)
    process(auth_client, dataset["id"])
    dataset_row = Dataset.objects.get(pk=dataset["id"])

    assert RawTransaction.objects.filter(dataset=dataset_row).count() == 7
    invalid = RawTransaction.objects.get(dataset=dataset_row, row_number=4)
    assert invalid.payload["InvoiceNo"] == "INV-102"
    assert invalid.payload["InvoiceDate"] == "not-a-date"


@pytest.mark.django_db
def test_quality_issues_name_the_row_and_reason(auth_client):
    dataset = prepared_dataset(auth_client)
    process(auth_client, dataset["id"])

    codes = dict(
        DataQualityIssue.objects.filter(dataset_id=dataset["id"]).values_list("row_number", "code")
    )
    assert codes == {
        4: "invalid_date",
        5: "invalid_quantity",
        6: "missing_product",
    }


@pytest.mark.django_db
def test_reprocessing_replaces_the_warehouse_output(auth_client):
    dataset = prepared_dataset(auth_client)
    process(auth_client, dataset["id"])
    first_counts = (
        FactSales.objects.filter(dataset_id=dataset["id"]).count(),
        FactReturn.objects.filter(dataset_id=dataset["id"]).count(),
        RawTransaction.objects.filter(dataset_id=dataset["id"]).count(),
    )

    second = process(auth_client, dataset["id"])

    assert second.status_code == 202
    assert second.json()["status"] == "succeeded"
    assert (
        FactSales.objects.filter(dataset_id=dataset["id"]).count(),
        FactReturn.objects.filter(dataset_id=dataset["id"]).count(),
        RawTransaction.objects.filter(dataset_id=dataset["id"]).count(),
    ) == first_counts
    assert ProcessingLog.objects.filter(dataset_id=dataset["id"]).count() == 2


@pytest.mark.django_db
def test_duplicate_invoice_lines_are_rejected(auth_client):
    rows = [
        ["INV-200", "01/02/2024", "SKU-1", "Widget", "1", "10.00", "", "UK", "1", "", ""],
        ["INV-200", "01/02/2024", "SKU-2", "Gadget", "1", "10.00", "", "UK", "1", "", ""],
    ]
    dataset = prepared_dataset(auth_client, rows=rows)

    run = process(auth_client, dataset["id"]).json()

    assert run["rows_rejected"] == 1
    assert FactSales.objects.filter(dataset_id=dataset["id"]).count() == 1
    issue = DataQualityIssue.objects.get(dataset_id=dataset["id"])
    assert issue.code == "duplicate_line"
    assert issue.row_number == 2


@pytest.mark.django_db
def test_unmapped_dataset_cannot_be_processed(auth_client):
    response = auth_client.post(
        reverse("dataset-list"),
        {
            "file": SimpleUploadedFile(
                "transactions.csv", csv_bytes(HEADER, ROWS), content_type="text/csv"
            )
        },
        format="multipart",
    )
    dataset_id = response.json()["id"]

    result = process(auth_client, dataset_id)

    assert result.status_code == 400
    assert "required fields" in result.json()["error"]["message"].lower()
    assert ProcessingLog.objects.count() == 0


@pytest.mark.django_db
def test_viewer_cannot_process(api_for, member, organisation, auth_client):
    dataset = prepared_dataset(auth_client)

    response = process(api_for(member.user), dataset["id"])

    assert response.status_code == 403


@pytest.mark.django_db
def test_foreign_dataset_cannot_be_processed(api_for, other_user, organisation, auth_client):
    dataset = prepared_dataset(auth_client)

    response = process(api_for(other_user), dataset["id"])

    assert response.status_code == 404


@pytest.mark.django_db
def test_a_missing_source_file_fails_the_run(auth_client):
    dataset = prepared_dataset(auth_client)
    dataset_row = Dataset.objects.get(pk=dataset["id"])
    dataset_row.current_import.file.delete(save=False)

    run = process(auth_client, dataset["id"]).json()

    assert run["status"] == "failed"
    assert "could not be opened" in run["error_message"]
    assert Dataset.objects.get(pk=dataset["id"]).status == "failed"
    assert FactSales.objects.filter(dataset_id=dataset["id"]).count() == 0


@pytest.mark.django_db
def test_runs_and_issues_are_readable(auth_client):
    dataset = prepared_dataset(auth_client)
    process(auth_client, dataset["id"])

    runs = auth_client.get(reverse("dataset-runs", args=[dataset["id"]]))
    assert runs.status_code == 200
    assert len(runs.json()) == 1
    assert runs.json()[0]["status"] == "succeeded"

    issues = auth_client.get(reverse("dataset-issues", args=[dataset["id"]]))
    assert issues.status_code == 200
    assert {issue["code"] for issue in issues.json()} == {
        "invalid_date",
        "invalid_quantity",
        "missing_product",
    }

    detail = auth_client.get(reverse("dataset-detail", args=[dataset["id"]])).json()
    assert detail["processing"]["warehouse"]["sales_rows"] == 2
    assert detail["processing"]["warehouse"]["return_rows"] == 2
    assert detail["processing"]["can_process"] is True
    assert detail["last_run_status"] == "succeeded"
    assert detail["rows_rejected"] == 3
    assert detail["quality_issue_count"] == 3
    assert detail["last_processed_at"] is not None

    listing = auth_client.get(reverse("dataset-list")).json()
    summary = next(item for item in listing if item["id"] == dataset["id"])
    assert summary["last_run_status"] == "succeeded"
    assert summary["rows_rejected"] == 3
    assert summary["quality_issue_count"] == 3

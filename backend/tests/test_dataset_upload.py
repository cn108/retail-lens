import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse

from apps.datasets.models import Dataset, DatasetColumn, DatasetImport
from apps.ingestion.inspection import CsvInspectionError, inspect_csv
from apps.ingestion.models import DimProduct, FactReturn, FactSales
from tests.sample_data import mapping_from, sales_csv


@pytest.fixture(autouse=True)
def _organisation(organisation):
    """Every upload in this module happens inside the owner's organisation."""
    return organisation


def upload(api_client, content: bytes, **extra):
    data = {
        "file": SimpleUploadedFile("sales.csv", content, content_type="text/csv"),
        **extra,
    }
    return api_client.post(reverse("dataset-list"), data, format="multipart")


@pytest.mark.django_db
def test_upload_inspects_the_file_and_creates_a_draft(auth_client, organisation):
    response = upload(auth_client, sales_csv(), name="February sales")

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "February sales"
    assert body["status"] == "draft"
    assert body["row_count"] == 3
    assert body["column_count"] == 8
    assert body["encoding"] == "utf-8"
    assert body["delimiter"] == ","
    assert body["mapping_complete"] is False

    types = {column["source_name"]: column["inferred_type"] for column in body["columns"]}
    assert types["Quantity"] == "integer"
    assert types["UnitPrice"] == "decimal"
    assert types["InvoiceDate"] == "date"
    assert types["CustomerID"] == "text"
    assert types["Description"] == "text"

    import_record = DatasetImport.objects.get(dataset_id=body["id"])
    assert import_record.file.storage.exists(import_record.file.name)
    assert import_record.checksum_sha256
    assert import_record.columns.count() == 8


@pytest.mark.django_db
def test_upload_suggests_canonical_fields_without_accepting_them(auth_client):
    body = upload(auth_client, sales_csv()).json()
    suggestions = {column["source_name"]: column["suggested_field"] for column in body["columns"]}

    assert suggestions["InvoiceNo"] == "invoice_id"
    assert suggestions["InvoiceDate"] == "invoice_date"
    assert suggestions["StockCode"] == "product_code"
    assert suggestions["Quantity"] == "quantity"
    assert suggestions["UnitPrice"] == "unit_price"
    assert all(column["canonical_field"] == "" for column in body["columns"])


@pytest.mark.django_db
def test_upload_detects_a_semicolon_delimiter(auth_client):
    content = sales_csv().replace(b",", b";")
    body = upload(auth_client, content).json()

    assert body["delimiter"] == ";"
    assert body["column_count"] == 8


@pytest.mark.django_db
def test_upload_reads_a_cp1252_file(auth_client):
    content = sales_csv().replace(b"Widget", "Caf\xe9".encode("cp1252"))
    response = upload(auth_client, content)

    assert response.status_code == 201
    assert response.json()["encoding"] == "cp1252"


@pytest.mark.django_db
def test_second_upload_of_the_same_file_is_rejected(auth_client):
    assert upload(auth_client, sales_csv()).status_code == 201

    response = upload(auth_client, sales_csv())

    assert response.status_code == 409
    assert "already" in response.json()["error"]["message"].lower()
    assert Dataset.objects.count() == 1


@pytest.mark.django_db
def test_non_csv_files_are_rejected(auth_client):
    response = auth_client.post(
        reverse("dataset-list"),
        {"file": SimpleUploadedFile("sales.txt", sales_csv())},
        format="multipart",
    )

    assert response.status_code == 400
    assert response.json()["error"]["fields"]["file"]


@pytest.mark.django_db
def test_a_file_without_data_rows_is_rejected(auth_client):
    response = upload(auth_client, sales_csv(rows=[]))

    assert response.status_code == 400
    assert "no data rows" in response.json()["error"]["fields"]["file"][0]


@pytest.mark.django_db
def test_duplicate_headers_are_rejected(auth_client):
    header = ["InvoiceNo", "InvoiceNo", "Quantity"]
    response = upload(auth_client, sales_csv(header=header, rows=[["1", "2", "3"]]))

    assert response.status_code == 400
    assert "repeats" in response.json()["error"]["fields"]["file"][0]


@pytest.mark.django_db
def test_empty_header_is_rejected(auth_client):
    header = ["InvoiceNo", "", "Quantity"]
    response = upload(auth_client, sales_csv(header=header, rows=[["1", "2", "3"]]))

    assert response.status_code == 400
    assert "no header" in response.json()["error"]["fields"]["file"][0]


@pytest.mark.django_db
def test_viewer_cannot_upload(api_for, member, organisation):
    client = api_for(member.user)

    response = upload(client, sales_csv())

    assert response.status_code == 403


@pytest.mark.django_db
def test_datasets_are_isolated_between_organisations(
    api_for, other_user, auth_client, organisation
):
    body = upload(auth_client, sales_csv()).json()
    outsider = api_for(other_user)

    assert outsider.get(reverse("dataset-detail", args=[body["id"]])).status_code == 404
    assert outsider.get(reverse("dataset-list")).json() == []


@pytest.mark.django_db
def test_analyst_can_upload_but_not_delete(api_for, member, organisation):
    member.role = "analyst"
    member.save(update_fields=["role"])
    client = api_for(member.user)

    created = upload(client, sales_csv())
    assert created.status_code == 201

    response = client.delete(reverse("dataset-detail", args=[created.json()["id"]]))
    assert response.status_code == 403


@pytest.mark.django_db
def test_owner_can_delete_a_dataset_and_its_file(auth_client):
    body = upload(auth_client, sales_csv()).json()
    import_record = DatasetImport.objects.get(dataset_id=body["id"])
    path = import_record.file.path

    response = auth_client.delete(reverse("dataset-detail", args=[body["id"]]))

    assert response.status_code == 204
    assert Dataset.objects.count() == 0
    assert DatasetColumn.objects.count() == 0
    import os

    assert not os.path.exists(path)


@pytest.mark.django_db
def test_owner_can_delete_a_processed_dataset_and_its_warehouse_rows(auth_client):
    body = upload(auth_client, sales_csv()).json()
    mapping_response = auth_client.put(
        reverse("dataset-mapping", args=[body["id"]]),
        {"mapping": mapping_from(body)},
        format="json",
    )
    assert mapping_response.status_code == 200

    processing_response = auth_client.post(reverse("dataset-process", args=[body["id"]]))
    assert processing_response.status_code == 202
    assert FactSales.objects.filter(dataset_id=body["id"]).exists()
    assert DimProduct.objects.filter(dataset_id=body["id"]).exists()
    import_record = DatasetImport.objects.get(dataset_id=body["id"])
    path = import_record.file.path

    response = auth_client.delete(reverse("dataset-detail", args=[body["id"]]))

    assert response.status_code == 204
    assert not Dataset.objects.filter(pk=body["id"]).exists()
    assert not FactSales.objects.filter(dataset_id=body["id"]).exists()
    assert not FactReturn.objects.filter(dataset_id=body["id"]).exists()
    assert not DimProduct.objects.filter(dataset_id=body["id"]).exists()
    assert not DatasetImport.objects.filter(dataset_id=body["id"]).exists()
    import os

    assert not os.path.exists(path)


def test_inspection_rejects_an_empty_file():
    from django.core.files.uploadedfile import SimpleUploadedFile

    with pytest.raises(CsvInspectionError):
        inspect_csv(SimpleUploadedFile("empty.csv", b""))

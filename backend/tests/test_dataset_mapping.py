import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse

from apps.datasets.models import DatasetColumn
from tests.sample_data import mapping_from, sales_csv


@pytest.fixture(autouse=True)
def _organisation(organisation):
    """Every dataset in this module belongs to the owner's organisation."""
    return organisation


def create_dataset(api_client) -> dict:
    response = api_client.post(
        reverse("dataset-list"),
        {"file": SimpleUploadedFile("sales.csv", sales_csv(), content_type="text/csv")},
        format="multipart",
    )
    assert response.status_code == 201
    return response.json()


def put_mapping(api_client, dataset_id: str, mapping: dict):
    return api_client.put(
        reverse("dataset-mapping", args=[dataset_id]), {"mapping": mapping}, format="json"
    )


@pytest.mark.django_db
def test_complete_mapping_marks_the_dataset_ready(auth_client):
    dataset = create_dataset(auth_client)

    response = put_mapping(auth_client, dataset["id"], mapping_from(dataset))

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "mapped"
    assert body["mapping_complete"] is True
    mapped = {column["source_name"]: column["canonical_field"] for column in body["columns"]}
    assert mapped["InvoiceNo"] == "invoice_id"
    assert mapped["Quantity"] == "quantity"
    assert mapped["CustomerID"] == "customer_id"


@pytest.mark.django_db
def test_mapping_is_stored_on_the_columns(auth_client):
    dataset = create_dataset(auth_client)
    put_mapping(auth_client, dataset["id"], mapping_from(dataset))

    stored = dict(
        DatasetColumn.objects.filter(import_record__dataset_id=dataset["id"]).values_list(
            "source_name", "canonical_field"
        )
    )
    assert stored["InvoiceDate"] == "invoice_date"
    assert stored["StockCode"] == "product_code"


@pytest.mark.django_db
def test_missing_required_field_is_rejected(auth_client):
    dataset = create_dataset(auth_client)
    mapping = mapping_from(dataset)
    quantity_id = next(
        str(column["id"]) for column in dataset["columns"] if column["source_name"] == "Quantity"
    )
    mapping[quantity_id] = ""

    response = put_mapping(auth_client, dataset["id"], mapping)

    assert response.status_code == 400
    message = response.json()["error"]["fields"]["mapping"][0]
    assert "Quantity" in message


@pytest.mark.django_db
def test_a_field_cannot_be_mapped_twice(auth_client):
    dataset = create_dataset(auth_client)
    mapping = mapping_from(dataset)
    customer_id = next(
        str(column["id"]) for column in dataset["columns"] if column["source_name"] == "CustomerID"
    )
    mapping[customer_id] = "invoice_id"

    response = put_mapping(auth_client, dataset["id"], mapping)

    assert response.status_code == 400
    assert "more than one column" in response.json()["error"]["fields"]["mapping"][0]


@pytest.mark.django_db
def test_incompatible_column_type_is_rejected(auth_client):
    dataset = create_dataset(auth_client)
    mapping = mapping_from(dataset)
    date_id = next(
        str(column["id"]) for column in dataset["columns"] if column["source_name"] == "InvoiceDate"
    )
    mapping[date_id] = "quantity"

    response = put_mapping(auth_client, dataset["id"], mapping)

    assert response.status_code == 400
    assert "needs a integer column" in response.json()["error"]["fields"]["mapping"][0]


@pytest.mark.django_db
def test_unknown_canonical_field_is_rejected(auth_client):
    dataset = create_dataset(auth_client)
    mapping = mapping_from(dataset)
    first_id = str(dataset["columns"][0]["id"])
    mapping[first_id] = "profit_margin"

    response = put_mapping(auth_client, dataset["id"], mapping)

    assert response.status_code == 400
    assert "not a known field" in response.json()["error"]["fields"]["mapping"][0]


@pytest.mark.django_db
def test_unknown_column_is_rejected(auth_client):
    dataset = create_dataset(auth_client)
    mapping = mapping_from(dataset)
    mapping["00000000-0000-4000-8000-000000000000"] = "country"

    response = put_mapping(auth_client, dataset["id"], mapping)

    assert response.status_code == 400
    assert "Unknown column" in response.json()["error"]["fields"]["mapping"][0]


@pytest.mark.django_db
def test_mapping_is_a_full_replacement(auth_client):
    dataset = create_dataset(auth_client)
    put_mapping(auth_client, dataset["id"], mapping_from(dataset))

    reduced = mapping_from(dataset)
    customer_id = next(
        str(column["id"]) for column in dataset["columns"] if column["source_name"] == "CustomerID"
    )
    reduced[customer_id] = ""

    response = put_mapping(auth_client, dataset["id"], reduced)

    assert response.status_code == 200
    columns = {column["source_name"]: column for column in response.json()["columns"]}
    assert columns["CustomerID"]["canonical_field"] == ""
    assert columns["InvoiceNo"]["canonical_field"] == "invoice_id"
    assert response.json()["status"] == "mapped"


@pytest.mark.django_db
def test_rejected_mapping_keeps_the_saved_mapping(auth_client):
    dataset = create_dataset(auth_client)
    put_mapping(auth_client, dataset["id"], mapping_from(dataset))

    response = put_mapping(auth_client, dataset["id"], {})

    assert response.status_code == 400
    body = auth_client.get(reverse("dataset-detail", args=[dataset["id"]])).json()
    assert body["status"] == "mapped"
    mapped = {column["source_name"]: column["canonical_field"] for column in body["columns"]}
    assert mapped["InvoiceNo"] == "invoice_id"


@pytest.mark.django_db
def test_viewer_cannot_map_columns(api_for, member, organisation, auth_client):
    dataset = create_dataset(auth_client)

    response = put_mapping(api_for(member.user), dataset["id"], mapping_from(dataset))

    assert response.status_code == 403


@pytest.mark.django_db
def test_mapping_is_denied_for_a_foreign_organisation(api_for, other_user, auth_client):
    dataset = create_dataset(auth_client)

    response = put_mapping(api_for(other_user), dataset["id"], mapping_from(dataset))

    assert response.status_code == 404


@pytest.mark.django_db
def test_canonical_fields_are_described_for_the_ui(auth_client):
    response = auth_client.get(reverse("dataset-canonical-fields"))

    assert response.status_code == 200
    body = response.json()
    fields = {field["key"]: field for field in body["fields"]}
    assert fields["invoice_date"]["required"] is True
    assert fields["invoice_date"]["accepts"] == ["date"]
    assert body["required"] == [
        "invoice_id",
        "invoice_date",
        "product_code",
        "quantity",
        "unit_price",
    ]

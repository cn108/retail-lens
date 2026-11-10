"""Transactional ETL: raw rows, dimensions and facts.

Every run replaces the dataset's previous warehouse output inside one
transaction, so reprocessing is repeatable and a failure leaves no partial
curated rows. Source rows are always preserved in ``RawTransaction``, even
when validation rejects them.
"""

from __future__ import annotations

import csv
import io
import logging
from datetime import date, datetime
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from apps.datasets.models import Dataset, DatasetColumn, DatasetStatus

from .canonical import REQUIRED_KEYS
from .inspection import DATE_FORMATS, DECIMAL, INTEGER
from .models import (
    DataQualityIssue,
    DimCustomer,
    DimDate,
    DimGeography,
    DimProduct,
    FactReturn,
    FactSales,
    IssueCode,
    ProcessingLog,
    ProcessingStatus,
    RawTransaction,
)

logger = logging.getLogger(__name__)

BATCH_SIZE = 1000
RETURN_FLAGS = {"true", "yes", "y", "1"}
SALES_FLAGS = {"false", "no", "n", "0"}


class ETLFailure(Exception):
    """The dataset cannot be loaded and the run should be marked failed."""


def parse_date(value: str) -> date:
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"'{value}' is not a recognised date")


def _issue(code: str, message: str, column: str, raw: str) -> dict:
    return {
        "code": code,
        "message": message,
        "source_column": column,
        "raw_value": raw[:500],
    }


def _parse_row(
    raw: list[str], positions: dict[str, int], row_number: int
) -> tuple[dict | None, list[dict]]:
    """Validate one source row against the canonical transaction model."""

    def value(field: str) -> str:
        position = positions.get(field)
        if position is None or position >= len(raw):
            return ""
        return raw[position].strip()

    issues: list[dict] = []
    invoice_id = value("invoice_id")
    if not invoice_id:
        issues.append(
            _issue(IssueCode.MISSING_INVOICE, "Invoice number is required.", "invoice_id", "")
        )

    invoice_date: date | None = None
    raw_date = value("invoice_date")
    if not raw_date:
        issues.append(
            _issue(IssueCode.INVALID_DATE, "Invoice date is required.", "invoice_date", "")
        )
    else:
        try:
            invoice_date = parse_date(raw_date)
        except ValueError as error:
            issues.append(_issue(IssueCode.INVALID_DATE, str(error), "invoice_date", raw_date))

    product_code = value("product_code")
    if not product_code:
        issues.append(
            _issue(
                IssueCode.MISSING_PRODUCT,
                "Product code is required.",
                "product_code",
                "",
            )
        )

    quantity: int | None = None
    raw_quantity = value("quantity")
    if not INTEGER.match(raw_quantity):
        issues.append(
            _issue(
                IssueCode.INVALID_QUANTITY,
                f"'{raw_quantity}' is not a whole number.",
                "quantity",
                raw_quantity,
            )
        )
    else:
        quantity = int(raw_quantity)

    unit_price: Decimal | None = None
    raw_price = value("unit_price")
    if not DECIMAL.match(raw_price):
        issues.append(
            _issue(
                IssueCode.INVALID_PRICE,
                f"'{raw_price}' is not a number.",
                "unit_price",
                raw_price,
            )
        )
    else:
        unit_price = Decimal(raw_price)
        if unit_price < 0:
            issues.append(
                _issue(
                    IssueCode.INVALID_PRICE,
                    "Unit price cannot be negative; express returns with quantity.",
                    "unit_price",
                    raw_price,
                )
            )

    discount: Decimal | None = None
    raw_discount = value("discount")
    if raw_discount:
        if not DECIMAL.match(raw_discount):
            issues.append(
                _issue(
                    IssueCode.INVALID_DISCOUNT,
                    f"'{raw_discount}' is not a number.",
                    "discount",
                    raw_discount,
                )
            )
        else:
            discount = Decimal(raw_discount)
            if discount < 0:
                issues.append(
                    _issue(
                        IssueCode.INVALID_DISCOUNT,
                        "Discount cannot be negative.",
                        "discount",
                        raw_discount,
                    )
                )

    is_return: bool | None = None
    raw_return = value("is_return")
    if raw_return:
        lowered = raw_return.lower()
        if lowered in RETURN_FLAGS:
            is_return = True
        elif lowered in SALES_FLAGS:
            is_return = False
        else:
            issues.append(
                _issue(
                    IssueCode.INVALID_RETURN_FLAG,
                    f"'{raw_return}' is not a true/false flag.",
                    "is_return",
                    raw_return,
                )
            )

    if issues:
        return None, issues

    return (
        {
            "invoice_id": invoice_id,
            "invoice_date": invoice_date,
            "product_code": product_code,
            "description": value("product_description"),
            "quantity": quantity,
            "unit_price": unit_price,
            "discount": discount,
            "customer_id": value("customer_id") or None,
            "country": value("country") or None,
            "is_return": is_return,
            "line_id": value("line_id"),
            "row_number": row_number,
        },
        [],
    )


def _clear_warehouse(dataset: Dataset) -> None:
    FactSales.objects.filter(dataset=dataset).delete()
    FactReturn.objects.filter(dataset=dataset).delete()
    RawTransaction.objects.filter(dataset=dataset).delete()
    DataQualityIssue.objects.filter(dataset=dataset).delete()
    DimCustomer.objects.filter(dataset=dataset).delete()
    DimProduct.objects.filter(dataset=dataset).delete()
    DimGeography.objects.filter(dataset=dataset).delete()


class _WarehouseWriter:
    """Accumulates and flushes rows in batches while caching dimensions."""

    def __init__(self, dataset: Dataset, run: ProcessingLog) -> None:
        self.dataset = dataset
        self.run = run
        self.import_record = dataset.current_import
        self.raw: list[RawTransaction] = []
        self.sales: list[FactSales] = []
        self.returns: list[FactReturn] = []
        self.issues: list[DataQualityIssue] = []
        self.dates: dict[date, DimDate] = {}
        self.customers: dict[str, DimCustomer] = {}
        self.products: dict[str, DimProduct] = {}
        self.countries: dict[str, DimGeography] = {}
        self.rows_read = 0
        self.rows_rejected = 0

    def add_raw(self, row_number: int, payload: dict) -> None:
        self.raw.append(
            RawTransaction(
                dataset=self.dataset,
                import_record=self.import_record,
                row_number=row_number,
                payload=payload,
            )
        )

    def add_issue(self, row_number: int, issue: dict) -> None:
        self.issues.append(
            DataQualityIssue(
                dataset=self.dataset,
                processing_run=self.run,
                row_number=row_number,
                code=issue["code"],
                message=issue["message"][:255],
                source_column=issue["source_column"][:255],
                raw_value=issue["raw_value"],
            )
        )

    def date_key(self, value: date) -> DimDate:
        cached = self.dates.get(value)
        if cached is not None:
            return cached
        iso = value.isocalendar()
        dim, _ = DimDate.objects.get_or_create(
            date=value,
            defaults={
                "year": value.year,
                "quarter": (value.month - 1) // 3 + 1,
                "month": value.month,
                "day": value.day,
                "iso_year": iso.year,
                "iso_week": iso.week,
                "day_of_week": value.isoweekday(),
            },
        )
        self.dates[value] = dim
        return dim

    def customer_key(self, source_id: str | None) -> DimCustomer | None:
        if not source_id:
            return None
        cached = self.customers.get(source_id)
        if cached is not None:
            return cached
        dim, _ = DimCustomer.objects.get_or_create(
            dataset=self.dataset, source_customer_id=source_id[:128]
        )
        self.customers[source_id] = dim
        return dim

    def product_key(self, code: str, description: str) -> DimProduct:
        cached = self.products.get(code)
        if cached is not None:
            if description and not cached.description:
                cached.description = description[:255]
                cached.save(update_fields=["description"])
            return cached
        dim, created = DimProduct.objects.get_or_create(
            dataset=self.dataset,
            source_product_code=code[:128],
            defaults={"description": description[:255]},
        )
        self.products[code] = dim
        return dim

    def geography_key(self, country: str | None) -> DimGeography | None:
        if not country:
            return None
        cached = self.countries.get(country)
        if cached is not None:
            return cached
        dim, _ = DimGeography.objects.get_or_create(dataset=self.dataset, country=country[:128])
        self.countries[country] = dim
        return dim

    def flush(self) -> None:
        if self.raw:
            RawTransaction.objects.bulk_create(self.raw, batch_size=BATCH_SIZE)
            self.raw = []
        if self.sales:
            FactSales.objects.bulk_create(self.sales, batch_size=BATCH_SIZE)
            self.sales = []
        if self.returns:
            FactReturn.objects.bulk_create(self.returns, batch_size=BATCH_SIZE)
            self.returns = []
        if self.issues:
            DataQualityIssue.objects.bulk_create(self.issues, batch_size=BATCH_SIZE)
            self.issues = []


def _load(dataset: Dataset, run: ProcessingLog) -> tuple[dict, dict]:
    import_record = dataset.current_import
    if import_record is None:
        raise ETLFailure("The dataset has no inspected import.")

    columns: list[DatasetColumn] = list(import_record.columns.all())
    positions = {
        column.canonical_field: column.position for column in columns if column.canonical_field
    }
    missing = [key for key in REQUIRED_KEYS if key not in positions]
    if missing:
        raise ETLFailure(f"Required fields are not mapped: {', '.join(missing)}.")

    _clear_warehouse(dataset)
    writer = _WarehouseWriter(dataset, run)
    seen_lines: set[tuple[str, str]] = set()

    try:
        handle = import_record.file.storage.open(import_record.file.name, "rb")
    except OSError as error:
        raise ETLFailure(f"The stored file could not be opened: {error}") from error

    with handle:
        wrapper = io.TextIOWrapper(handle, encoding=import_record.encoding, newline="")
        try:
            reader = csv.reader(wrapper, delimiter=import_record.delimiter)
            next(reader, None)
            for raw in reader:
                if not any(value.strip() for value in raw):
                    continue

                writer.rows_read += 1
                row_number = writer.rows_read
                payload = {
                    column.source_name: raw[column.position] if column.position < len(raw) else ""
                    for column in columns
                }
                writer.add_raw(row_number, payload)

                parsed, issues = _parse_row(raw, positions, row_number)
                if parsed is None:
                    writer.rows_rejected += 1
                    for issue in issues:
                        writer.add_issue(row_number, issue)
                else:
                    invoice_id = parsed["invoice_id"]
                    line_id = parsed["line_id"] or f"row-{row_number}"
                    line_key = (invoice_id, line_id)
                    if line_key in seen_lines:
                        writer.rows_rejected += 1
                        writer.add_issue(
                            row_number,
                            _issue(
                                IssueCode.DUPLICATE_LINE,
                                f"Line '{line_id}' repeats within invoice '{invoice_id}'.",
                                "line_id",
                                line_id,
                            ),
                        )
                    else:
                        seen_lines.add(line_key)
                        _add_fact(writer, parsed, line_id)

                if writer.rows_read % BATCH_SIZE == 0:
                    writer.flush()
        except csv.Error as error:
            raise ETLFailure(f"The stored file is not valid CSV: {error}") from error
        finally:
            wrapper.detach()
            writer.flush()

    if writer.rows_read == 0:
        raise ETLFailure("The stored file has no data rows.")

    summary = {
        "sales_rows": FactSales.objects.filter(dataset=dataset).count(),
        "return_rows": FactReturn.objects.filter(dataset=dataset).count(),
        "raw_rows": RawTransaction.objects.filter(dataset=dataset).count(),
        "issues": DataQualityIssue.objects.filter(dataset=dataset).count(),
        "customers": DimCustomer.objects.filter(dataset=dataset).count(),
        "products": DimProduct.objects.filter(dataset=dataset).count(),
        "countries": DimGeography.objects.filter(dataset=dataset).count(),
    }
    counts = {
        "rows_read": writer.rows_read,
        "rows_rejected": writer.rows_rejected,
        "rows_loaded": summary["sales_rows"] + summary["return_rows"],
    }
    return summary, counts


def _add_fact(writer: _WarehouseWriter, parsed: dict, line_id: str) -> None:
    quantity: int = parsed["quantity"]
    is_return = bool(parsed["is_return"]) or quantity < 0
    if is_return:
        quantity = -abs(quantity)

    unit_price: Decimal = parsed["unit_price"]
    gross = unit_price * quantity
    discount = parsed["discount"]
    # A discount reduces the absolute line amount, so it is subtracted from a
    # sale and added back to a (negative) return.
    if discount is None:
        net = gross
    else:
        net = gross - (discount if quantity > 0 else -discount)

    common = {
        "dataset": writer.dataset,
        "import_record": writer.import_record,
        "date_key": writer.date_key(parsed["invoice_date"]),
        "customer_key": writer.customer_key(parsed["customer_id"]),
        "product_key": writer.product_key(parsed["product_code"], parsed["description"]),
        "geography_key": writer.geography_key(parsed["country"]),
        "quantity": quantity,
        "unit_price": unit_price,
        "gross_line_amount": gross,
        "discount_amount": discount,
        "net_line_amount": net,
        "source_invoice_id": parsed["invoice_id"][:128],
        "source_line_identifier": line_id[:128],
        "source_row_number": parsed["row_number"],
    }
    if is_return:
        writer.returns.append(FactReturn(**common))
    else:
        writer.sales.append(FactSales(**common))


def run_processing(run_id: str) -> str:
    """Execute one queued run. Safe to call synchronously (tests) or from Celery."""
    try:
        run = ProcessingLog.objects.select_related("dataset").get(pk=run_id)
    except ProcessingLog.DoesNotExist:
        logger.warning("Processing run %s no longer exists", run_id)
        return "missing"

    dataset_id = run.dataset_id
    run.status = ProcessingStatus.RUNNING
    run.started_at = timezone.now()
    run.save(update_fields=["status", "started_at"])

    try:
        with transaction.atomic():
            dataset = Dataset.objects.select_for_update().get(pk=dataset_id)
            summary, counts = _load(dataset, run)
            dataset.status = DatasetStatus.READY
            dataset.save(update_fields=["status", "updated_at"])
        run.rows_read = counts["rows_read"]
        run.rows_loaded = counts["rows_loaded"]
        run.rows_rejected = counts["rows_rejected"]
        run.summary = summary
        run.status = ProcessingStatus.SUCCEEDED
        run.finished_at = timezone.now()
        run.save()
        return "succeeded"
    except Exception as error:  # noqa: BLE001 - the run records the failure
        logger.exception("Dataset %s processing failed", dataset_id)
        run.status = ProcessingStatus.FAILED
        run.error_message = str(error)[:2000] or "Processing failed."
        run.finished_at = timezone.now()
        run.save()
        Dataset.objects.filter(pk=dataset_id).update(
            status=DatasetStatus.FAILED, updated_at=timezone.now()
        )
        return "failed"

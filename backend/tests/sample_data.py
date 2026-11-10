"""Sample source files shared by the dataset tests."""

import csv
import io

SALES_HEADER = [
    "InvoiceNo",
    "InvoiceDate",
    "StockCode",
    "Description",
    "Quantity",
    "UnitPrice",
    "CustomerID",
    "Country",
]

SALES_ROWS = [
    ["INV-1", "01/02/2024", "SKU-1", "Widget", "2", "9.99", "C-1", "United Kingdom"],
    ["INV-1", "01/02/2024", "SKU-2", "Gadget", "1", "19.50", "C-1", "United Kingdom"],
    ["INV-2", "03/02/2024", "SKU-1", "Widget", "4", "9.99", "", "United Kingdom"],
]


def sales_csv(header: list[str] | None = None, rows: list[list[str]] | None = None) -> bytes:
    buffer = io.StringIO()
    writer = csv.writer(buffer, quoting=csv.QUOTE_MINIMAL)
    writer.writerow(header or SALES_HEADER)
    for row in rows if rows is not None else SALES_ROWS:
        writer.writerow(row)
    return buffer.getvalue().encode()


def mapping_from(detail: dict) -> dict:
    """Use each column's suggested field as a complete mapping."""
    return {str(column["id"]): column["suggested_field"] for column in detail["columns"]}

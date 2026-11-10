"""The standard transaction fields a source CSV is mapped onto.

These definitions are the single vocabulary shared by dataset mapping (M3)
and ETL (M4+). A source column may only be mapped to a field whose accepted
storage types include the column's inferred type, which stops a quantity from
being mapped to a date.
"""

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class CanonicalField:
    key: str
    label: str
    description: str
    accepts: tuple[str, ...]
    required: bool = False
    aliases: tuple[str, ...] = ()


CANONICAL_FIELDS: tuple[CanonicalField, ...] = (
    CanonicalField(
        key="invoice_id",
        label="Invoice number",
        description="Identifier shared by every line of one invoice.",
        accepts=("text", "integer"),
        required=True,
        aliases=("invoiceid", "invoiceno", "invoicenumber", "invoice", "orderid"),
    ),
    CanonicalField(
        key="line_id",
        label="Line number",
        description="Identifier unique within the invoice; used to de-duplicate lines.",
        accepts=("text", "integer"),
        aliases=("lineid", "linenumber", "lineno", "line"),
    ),
    CanonicalField(
        key="invoice_date",
        label="Invoice date",
        description="Date the sale took place.",
        accepts=("date",),
        required=True,
        aliases=("invoicedate", "date", "orderdate", "transactiondate"),
    ),
    CanonicalField(
        key="customer_id",
        label="Customer ID",
        description="Source customer identifier; anonymous rows may stay blank.",
        accepts=("text", "integer"),
        aliases=("customerid", "customerno", "customer", "customercode"),
    ),
    CanonicalField(
        key="product_code",
        label="Product code",
        description="Stock keeping unit or SKU.",
        accepts=("text", "integer"),
        required=True,
        aliases=("stockcode", "productcode", "sku", "itemcode", "productid"),
    ),
    CanonicalField(
        key="product_description",
        label="Description",
        description="Product name or description.",
        accepts=("text",),
        aliases=(
            "description",
            "productdescription",
            "productname",
            "itemdescription",
        ),
    ),
    CanonicalField(
        key="quantity",
        label="Quantity",
        description="Units sold on the line; negative values represent returns.",
        accepts=("integer",),
        required=True,
        aliases=("quantity", "qty", "units"),
    ),
    CanonicalField(
        key="unit_price",
        label="Unit price",
        description="Price per unit in the organisation currency.",
        accepts=("decimal", "integer"),
        required=True,
        aliases=("unitprice", "price", "saleprice"),
    ),
    CanonicalField(
        key="discount",
        label="Discount",
        description="Line discount amount, only when the source supplies it.",
        accepts=("decimal", "integer"),
        aliases=("discount", "discountamount"),
    ),
    CanonicalField(
        key="country",
        label="Country",
        description="Customer country label.",
        accepts=("text",),
        aliases=("country", "customercountry"),
    ),
    CanonicalField(
        key="is_return",
        label="Return flag",
        description="Marks a line as a return when the source states it explicitly.",
        accepts=("boolean", "integer", "text"),
        aliases=("isreturn", "returnflag", "returned"),
    ),
)

BY_KEY = {field.key: field for field in CANONICAL_FIELDS}
REQUIRED_KEYS = tuple(field.key for field in CANONICAL_FIELDS if field.required)


def accepts_type(field_key: str, inferred_type: str) -> bool:
    field = BY_KEY.get(field_key)
    return field is not None and inferred_type in field.accepts


def _normalise(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


ALIASES = {
    _normalise(alias): field.key
    for field in CANONICAL_FIELDS
    for alias in (field.key, *field.aliases)
}


def suggest_canonical_field(source_name: str) -> str:
    """Name-based suggestion only; the user confirms every mapping."""
    return ALIASES.get(_normalise(source_name), "")

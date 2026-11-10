"""Metric definitions attached to every saved report.

These are presentation metadata, not formulas: every number in a report is
computed by the analytics or customers services. The definitions mirror
``docs/ANALYTICAL_METHODOLOGY.md`` so an exported report explains its measures
without duplicating the calculation.
"""

from .models import ReportKind

KIND_LABELS = {
    ReportKind.SALES: "Sales performance",
    ReportKind.CUSTOMERS: "Customer performance",
    ReportKind.PRODUCTS: "Product performance",
}


def _definition(metric: str, definition: str, grain: str, exclusions: str) -> dict:
    return {
        "metric": metric,
        "definition": definition,
        "grain": grain,
        "exclusions": exclusions,
    }


DEFINITIONS = {
    ReportKind.SALES: [
        _definition(
            "Gross sales",
            "Sum of sales line amounts before discounts.",
            "Line to selected period",
            "Returns and rejected rows",
        ),
        _definition(
            "Net sales",
            "Gross sales after discounts plus negative return amounts.",
            "Line to selected period",
            "Rejected rows",
        ),
        _definition(
            "Eligible orders",
            "Distinct invoices with at least one sales line.",
            "Invoice",
            "Return-only invoices",
        ),
        _definition(
            "Average order value",
            "Net sales divided by eligible orders.",
            "Period",
            "Periods without orders",
        ),
        _definition(
            "Unique customers",
            "Distinct identifiable customers with a sales line.",
            "Customer",
            "Anonymous sales and return-only customers",
        ),
        _definition(
            "Sales growth",
            "Net sales change against the immediately preceding equal-length period.",
            "Period",
            "Periods with no positive prior net sales",
        ),
    ],
    ReportKind.CUSTOMERS: [
        _definition(
            "Identifiable customers",
            "Distinct dataset-scoped customers with at least one sales line.",
            "Customer",
            "Anonymous sales and return-only customers",
        ),
        _definition(
            "Repeat purchase rate",
            "Customers with two or more distinct sales invoices divided by identifiable customers.",
            "Customer",
            "Customers with one invoice",
        ),
        _definition(
            "Historical customer value",
            "Observed net sales to date, not a predicted lifetime value.",
            "Customer to period",
            "Anonymous lines",
        ),
        _definition(
            "Month-1 retention",
            "Size-weighted share of eligible first-purchase cohorts buying in month 1.",
            "Cohort",
            "Returns do not count as activity",
        ),
        _definition(
            "RFM",
            "Recency, frequency and monetary scores relative to the selected customers.",
            "Customer",
            "Anonymous customers",
        ),
    ],
    ReportKind.PRODUCTS: [
        _definition(
            "Product net sales",
            "Sales net amounts plus return net amounts for the product.",
            "Product to period",
            "Rejected rows",
        ),
        _definition(
            "Units",
            "Sales quantity plus negative return quantity.",
            "Product to period",
            "Rejected rows",
        ),
        _definition(
            "Revenue share",
            "Product net sales divided by total net sales in the range.",
            "Product to period",
            "No share when total net sales are not positive",
        ),
        _definition(
            "Orders",
            "Distinct sales invoices containing the product.",
            "Product to period",
            "Return-only invoices",
        ),
        _definition(
            "Product change",
            "Net sales change against the preceding equal-length period.",
            "Product",
            "No change when prior net sales are not positive",
        ),
        _definition(
            "Direction",
            "Fixed -20%/+20% presentation heuristic: declining, growing or stable.",
            "Product",
            "Not a statistical test",
        ),
    ],
}

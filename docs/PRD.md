# Product requirements

The governing document is **RetailLens — Business Intelligence & Retail
Analytics Platform, AI Coding Agent Specification v1.0**. This file records
how the repository maps to it and where the specification is deliberately
deferred.

## Scope of the initial product

Multi-user retail BI: users belong to an organisation, upload a CSV of
transactions, map columns to the standard transaction model, review
data-quality results, process the dataset, and analyse sales, customer,
product and geographic performance, with forecasts, anomaly detection and
exportable reports.

## Explicit non-goals

- ERP/POS functionality, real-time streaming, microservices.
- Profit, margin or inventory measures: the reference dataset has no cost or
  inventory data, so these must not be computed or implied.
- Billing/subscriptions.
- Analytics claims that are not derived from computed evidence.

## Functional requirements map

| ID | Area | Owning milestone | Backend app |
| --- | --- | --- | --- |
| FR01 | Authentication, users, roles, tenancy | M2 | `accounts`, `organisations` |
| FR02 | Dataset upload, schema inspection, mapping | M3 | `datasets` |
| FR03 | Repeatable ETL, raw preservation, quality | M3–M4 | `ingestion` |
| FR04 | Dashboard KPIs and trends | M5–M6 | `analytics` |
| FR05 | Customer analytics (RFM, cohorts, retention) | M7 | `customers` |
| FR06 | Product analytics | M7 | `analytics` |
| FR07 | Forecasting and anomaly detection | M8 | `forecasting` |
| FR08 | Reports and exports | M9 | `reporting` |
| FR09 | Settings and preferences | M2 | `accounts`, `organisations` |

## Principles enforced in code review

Every displayed metric needs a definition, a grain, an exclusion rule and a
single authoritative implementation. Empty, loading, partial and error
states are explicit. Placeholder numbers are prohibited.

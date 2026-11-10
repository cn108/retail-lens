# System design and architecture

Modular monolith: one Django deployment, one Celery worker pool, one
Angular build, clear internal boundaries.

## Components

| Component | Location | Responsibility |
| --- | --- | --- |
| Angular presentation | `frontend/src/app` | Navigation, upload flow, filters, dashboards, reports, settings |
| API layer | `backend/config` | Settings, URLs, error envelope, health, OpenAPI schema |
| Domain apps | `backend/apps/*` | One bounded context each; see below |
| Analytics services | `backend/apps/analytics`, `analytics/metrics` | Reusable, tested metric implementations |
| Ingestion/ETL | `backend/apps/ingestion` | File validation, mapping, standardisation, quality checks, loading |
| Persistence | PostgreSQL | Metadata, raw records, warehouse tables |
| Worker | Celery | Imports, ETL, forecasts, report generation |

## Application boundaries

| App | Owns | Must not |
| --- | --- | --- |
| `accounts` | User model, authentication, profiles | Know about datasets |
| `organisations` | Organisations, membership, roles, settings | Query analytics tables |
| `datasets` | Dataset metadata, imports, column mappings | Contain analytical formulas |
| `ingestion` | Raw preservation, validation, ETL, warehouse loading | Serve HTTP responses directly |
| `analytics` | KPI and aggregation services | Read request objects |
| `customers` | RFM, cohorts, retention, CLV | Duplicate KPI formulas from `analytics` |
| `forecasting` | Model training, evaluation, anomaly detection | Write to warehouse facts |
| `reporting` | Saved reports, export jobs | Recompute metrics with different formulas |

Rules: views stay thin (validation plus serialisation); formulas live in
`services.py` modules so the API, notebooks and Power BI share one
definition; cross-app access goes through service functions, not direct
model imports.

## Request and job flow

```
Angular -> DRF /api/v1/... -> service -> PostgreSQL
                                  \-> Celery task (imports, ETL, forecasts)
                                       worker -> PostgreSQL, artefacts
```

Long-running work returns a job resource with `queued`, `running`,
`succeeded`, `failed` or `cancelled`; no request blocks on an import or a
model run.

## Environment configuration

All values come from environment variables (`.env` locally, CI secrets or
the platform's secret store in deployment). Defaults exist for local
development only.

| Variable | Purpose | Local default |
| --- | --- | --- |
| `DJANGO_SETTINGS_MODULE` | Settings module | `config.settings.dev` |
| `DJANGO_SECRET_KEY` | Signing key; mandatory in production | insecure placeholder |
| `DJANGO_DEBUG` | Debug mode | `true` |
| `DJANGO_ALLOWED_HOSTS` | Allowed hosts | localhost, 127.0.0.1, backend |
| `LOG_LEVEL` | Root logger level | `INFO` |
| `POSTGRES_DB` / `_USER` / `_PASSWORD` | Database credentials | `retaillens` |
| `POSTGRES_HOST` / `_PORT` | Database address | `db` / `5432` |
| `CELERY_BROKER_URL` | Task queue | `redis://redis:6379/0` |
| `CELERY_RESULT_BACKEND` | Task results | `redis://redis:6379/1` |
| `CORS_ALLOWED_ORIGINS` | Angular dev origin allow-list | `http://localhost:4200` |
| `CSRF_TRUSTED_ORIGINS` | Origins allowed to submit unsafe requests | `http://localhost:4200` |
| `SESSION_COOKIE_AGE` | Session lifetime in seconds | 14 days |
| `MAX_UPLOAD_BYTES` | Hard upload ceiling | 50 MiB |

`config/settings/base.py` is environment-agnostic; `dev.py` relaxes hosts
and errors; `prod.py` enables HTTPS, HSTS, secure cookies and clickjacking
protection.

## Initial database configuration

PostgreSQL 17, database `retaillens`, owned by a non-superuser role of the
same name. Connection reuse is set with `CONN_MAX_AGE=60`. All schema
changes go through Django migrations. The first migration defines the custom
email-based `accounts.User`; the warehouse schema is designed in
`DATABASE_DESIGN.md` and added in M3 and M4.

## Docker Compose services

| Service | Image / build | Port | Purpose |
| --- | --- | --- | --- |
| `db` | `postgres:17-alpine` | 5432 | PostgreSQL with a `pg_isready` healthcheck |
| `redis` | `redis:7-alpine` | 6379 | Celery broker and result backend |
| `backend` | `backend` dev target | 8000 | Migrate, then Django dev server; HTTP healthcheck |
| `worker` | `backend` dev target | none | `celery -A config worker` |
| `frontend` | `frontend` dev target | 4200 | `ng serve` with polling for bind mounts |

`backend` and `worker` wait for a healthy `db` and `redis`; `frontend` waits
for a healthy `backend`. Production images exist as separate build targets
(`prod`) but Compose does not start them.

## Continuous integration

`.github/workflows/ci.yml` runs on push and pull request:

- **Backend**: Python 3.13 with real PostgreSQL and Redis services;
  `ruff check` and `ruff format --check`; `manage.py check`;
  `makemigrations --check` so schema changes must be committed; `pytest`.
- **Frontend**: Node 22; `npm ci`; production build; unit tests.

## Authentication, roles and tenancy

Authentication is a Django session cookie. The Angular dev server proxies
`/api` to Django, so the browser sees one origin, the cookie is first-party
and Django's CSRF check applies to every unsafe request; the client echoes
the token issued by `GET /api/v1/auth/csrf`. `prod.py` adds `Secure` cookies
and HTTPS redirects.

| Role | Rank | Capabilities |
| --- | --- | --- |
| `owner` | 40 | All admin capabilities plus granting/revoking `owner` |
| `admin` | 30 | Edit organisation settings, add/remove members, change non-owner roles |
| `analyst` | 20 | Read organisation data; analytical work from M5 |
| `viewer` | 10 | Read organisation data |

`organisations.Membership` is the only source of truth for access. A request
resolves its organisation through `services.active_membership_for`, which
accepts a preferred default or an `X-Organisation-Id` header **only** if a
membership exists; otherwise it answers 404 so foreign organisations are not
disclosed. Role checks live in `services.require_role` and are exercised by
the tests that replace the old tenancy placeholder. The last owner of an
organisation cannot be demoted or removed, and removing a member clears their
default organisation.

## Dataset upload and mapping (M3)

```
Angular -> POST /datasets (multipart)
        -> ingestion.inspect_csv  (encoding, delimiter, column profiles)
        -> datasets.Dataset + DatasetImport + DatasetColumn
        -> PUT /datasets/{id}/mapping  (validated against canonical fields)
```

The uploaded file is written under `MEDIA_ROOT` (`backend/media` locally) and
is never served directly; `DatasetImport` keeps its checksum, size, encoding,
delimiter, row and column counts and inspection warnings. Re-uploading an
identical file into the same organisation is refused with 409.

Inspection is streaming: only the first 1,000 non-empty rows are profiled for
type inference while every row is counted. Detected types are `text`,
`integer`, `decimal`, `date` and `boolean`. Date parsing accepts ISO,
DD/MM/YYYY, MM/DD/YYYY, DD-MM-YYYY and common timestamp forms; day-first is
preferred and the UI warns that month-first sources must be cleaned first.

Mappings are stored on `DatasetColumn.canonical_field`. The service treats a
save as a full replacement: omitted columns become unmapped, each canonical
field may be used once, the field must accept the detected type, and the
required fields (`invoice_id`, `invoice_date`, `product_code`, `quantity`,
`unit_price`) must all be present. A rejected save changes nothing. Only then
does the dataset move from `draft` to `mapped`, which is the contract the ETL
consumes.

The canonical vocabulary and type rules live in `apps/ingestion/canonical.py`;
the inspector lives in `apps/ingestion/inspection.py`. `datasets` owns
metadata and mappings and contains no analytical formulas.

## Processing and warehouse (M4)

```
Angular -> POST /datasets/{id}/process
        -> ingestion.services.start_processing
        -> ProcessingLog (queued) + dataset status processing
        -> Celery ingestion.process_dataset
        -> ingestion.etl.run_processing
             raw_transactions      every source row, verbatim
             data_quality_issues    one per rejected row and reason
             dim_* + fact_sales / fact_returns   one transaction
```

Only `ingestion` writes warehouse tables; the datasets API reads through
`ingestion.services`, which returns plain payloads. A run is refused with 400
if the required mapping is incomplete, and with 409 if the dataset already has
a queued or running run. The task name is `ingestion.process_dataset`; the
worker must be restarted after the task module changes because Celery
autodiscovers tasks at startup.

Validation happens per row. A row is rejected (but still preserved raw) when
the invoice number or product code is missing, the date cannot be parsed, the
quantity is not a whole number, the price or discount is not a non-negative
decimal, the return flag is not a boolean, or its line identifier repeats
within the invoice. The mapped `line_id` is authoritative; without one the
source row number keeps the line unique.

Returns are lines whose mapped flag is truthy or whose quantity is negative;
the quantity is normalised to `-abs(quantity)` and the row goes to
`fact_returns`. Sales keep their positive quantity in `fact_sales`. Discounts
reduce the absolute line amount (`gross - discount` for sales, `gross +
discount` for returns), so net sales add returns exactly once.

Reprocessing deletes the dataset's previous raw, dimension and fact rows,
then reloads them inside the same transaction as the new run. A failure rolls
back the curated tables, records `error_message` on the run and sets the
dataset to `failed`; the previous run's warehouse output is therefore gone
only if the new transaction committed. `processing_logs` keeps the run
history, while `data_quality_issues` reflects the latest run only.

## Sales analytics (M5)

```
Angular Sales -> GET /analytics/sales/summary
             -> GET /analytics/sales/trend?granularity=day|week|month
             -> analytics.views (membership + parameter validation)
             -> analytics.services (metric definitions)
             -> fact_sales / fact_returns joined to dim_date
```

The analytics app never reads request objects; views resolve the active
membership through `organisations.services.active_membership_for`, validate
the optional `dataset`, `date_from`, `date_to` and `granularity` parameters,
and pass plain values to the service. Any member, including a viewer, can read
analytics; no write endpoint exists.

Every query is scoped to the membership's organisation. A dataset filter is
verified against that organisation first, so a foreign id answers 404 rather
than an empty result. Metrics aggregate facts directly, which means only
processed datasets contribute and a failed reprocess that rolled back leaves
the previous curated rows in place.

Metric definitions, exclusions and missing-value rules live in
`docs/ANALYTICAL_METHODOLOGY.md`; the service is the single implementation.
Money is returned as fixed-point strings with 4 decimal places and percentages
as 2 decimal places, so no binary floating-point rounding happens in the API.

`summary` returns gross sales, net sales, eligible orders, average order value,
unique customers and sales growth against the immediately preceding period of
equal length, plus the prior net sales and the contributing datasets. `trend`
returns net sales and distinct invoices per day, ISO week or month. Buckets
with no facts are omitted rather than zero-filled.

## Angular dashboard (M6)

```
Dashboard component
  -> AnalyticsService.summary() / .trend()   (M5 endpoints)
  -> DatasetsService.list()                  (scope and data confidence)
  -> AnalysisScopeService                    (shared URL-backed filters)
  -> buildTrendChart(points, currency)       (pure SVG geometry)
```

The dashboard owns no new backend contract: it presents the M5 summary and
trend, so metric definitions remain in `analytics.services`. Dataset, date and
granularity controls trigger one request pair; a request counter discards
stale responses when filters change quickly. An `effect` watches the active
organisation so switching organisation reloads the scope and overview instead
of leaving another organisation's metrics on screen.

The dashboard, Sales, Customers and Products all use one
`AnalysisScopeService`. It applies dataset/date changes immediately, mirrors
the applied scope into the URL, stores it per organisation in session storage
and preserves it across navigation. The shared `AnalysisFilterBar` provides
the dataset and date controls with presets; the Sales, Customer and Product
pages consume the same scope rather than maintaining independent copies. A
quick report action creates a report from the current scope, optionally
queueing a CSV or PDF export.

The app shell owns a global `CommandPalette`, opened with Ctrl/Cmd+K or the
search controls. It filters static pages plus the organisation's saved-report
and dataset lists in the browser, and searches customers and products through
their organisation-scoped analysis endpoints after a short debounce. RFM and
product performance accept a `search` parameter that narrows returned rows
without changing segment sizes or summary totals. Selecting a customer or
product opens `/customers` or `/products` with its dataset and a `customer` or
`product` focus parameter; the page loads the matching row and offers a "show
all" action. General analysis pages keep the current dataset and date scope
but remove any focused record parameter. Reports, datasets and other pages
open at their own paths without analysis filters. The palette uses
listbox/option semantics, arrow-key navigation, Escape to close and explicit
loading, partial-error and empty states.

The chart is an inline SVG line/area chart with an always-included zero
baseline, up to four x-axis labels, compact currency ticks and native title
tooltips. Its geometry is a pure function (`features/dashboard/trend-chart.ts`)
with unit tests, and a visually hidden table carries the same periods for
screen readers. No charting dependency is added.

The page has distinct loading, error, no-data and data states. The no-data
panel distinguishes an empty warehouse from an empty filtered range. Growth
is rendered as "no prior period" when the API returns null. A data-confidence
panel shows the latest processed timestamp, rejected source rows and open
quality issues for the ready datasets; service health moved to Settings for
owner and admin users. Loading states use skeleton cards rather than a bare
message.

## Customer analytics (M7)

```
Customers page
  -> CustomersService.summary() / .rfm() / .retention()
  -> /customers/... views (membership + parameter validation)
  -> customers.services
  -> analytics.services.facts_for / resolve_period
  -> facts, dim_customer, dim_date
```

The `customers` app owns RFM, repeat purchase, observed historical value and
cohort retention; it reuses the sales app's fact-scope and period helpers
rather than duplicating them. `analytics` remains the owner of sales KPIs and
now product performance. Both apps read warehouse tables and never write them.

RFM scores are percentile bands within the selected customers; a single
distinct value receives the neutral score 3 and ties share a score. Segments
are assigned by ordered rules in `customers.services` (champion, loyal,
potential, at risk, hibernating, occasional), not by a model. Cohorts are based
on each customer's all-time first sales invoice, retention counts sales
activity only, and month 0 is 100% by construction. The full register is in
`docs/ANALYTICAL_METHODOLOGY.md`.

All three customer endpoints are read-only, organisation-scoped and available
to every member. They accept the same optional dataset and inclusive ISO date
filters as the sales endpoints. A user with no organisation gets 404; invalid
dates, a reversed range or a foreign dataset never returns a partial result.

## Product analytics (M7)

```
Products page
  -> ProductsService.performance()
  -> ProductPerformanceView
  -> analytics.services.product_performance
```

Products are ranked by net sales with gross sales, units, orders, returned
units and revenue share. Change compares with the immediately preceding
equal-length period. Direction is an explicit ±20% presentation heuristic,
not a significance test: `declining`, `growing`, `stable`, `new` (positive net
sales with no prior sales) or `returns` (negative activity with no prior
sales). Categories are never inferred because the source has no category
column.

The response returns at most 50 rows by default (200 maximum) while summary
totals, product count and declining count cover every product in the range.
The page filters its visible rows client-side by code, description or dataset.

## Forecasting and anomaly detection (M8)

```
Forecasting page
  -> ForecastingService.list() / .create() / .get()
  -> /forecasting/runs (membership; analyst+ to create)
  -> forecasting.services.start_forecast
       -> monthly_series (facts aggregated to calendar months)
       -> ForecastRun (history snapshot, status queued)
       -> Celery forecasting.run_forecast
            -> forecasting.forecast.forecast_monthly
            -> ForecastPoint and ForecastAnomaly rows
```

The `forecasting` app owns only derived outputs and never writes the
warehouse. It reuses the ingestion fact tables through a monthly aggregation:
net sales per calendar month, with returns subtracted and months inside the
observed range that have no facts filled with zero. The organisation scopes
every query; an optional dataset filter narrows the series.

Creating a run requires analyst or above and at least 12 monthly periods;
otherwise the request fails with 400 before a row is written. One queued or
running run per organisation is allowed, enforced under a row lock with 409.
A broker failure marks the run failed and returns 503. The run is the job
resource: `POST` returns 202 with its status, and `GET` returns the detail
(with history, points and anomalies) so the page can poll every 2 seconds.
Reading runs is available to every member and is organisation-scoped in the
query, so a run id from another organisation is a 404.

The worker evaluates a Holt linear trend against a seasonal-naive baseline on
a chronological 60/20/20 split, selects `alpha`/`beta` on validation MAE,
reports test MAE/RMSE for both candidates, and stores the input history,
versions, split sizes, parameters and interval rule on the run. Anomalies are
univariate level outliers in the observed history (Tukey fences with a mean ±
3σ fallback). The formulas and limitations are in
`docs/ANALYTICAL_METHODOLOGY.md`; the tables are in `docs/DATABASE_DESIGN.md`.

## Saved reports and exports (M9)

```
Reports page
  -> ReportingService.list() / .create() / .update() / .get() / .createExport()
  -> /reports and /reports/{id}/exports (membership; analyst+ to write)
  -> reporting.services.create_report / update_report
       -> SavedReport (kind, dataset, optional dates)
  -> reporting.services.start_export
       -> ReportJob (queued)
       -> Celery reporting.generate_export
            -> reporting.services.report_payload
                 -> analytics.services / customers.services
            -> exporters.render_csv / render_pdf
            -> generated file under MEDIA_ROOT
```

A saved report stores its kind, optional processed dataset and optional date
range. A null dataset means every processed dataset in the organisation. It
does not store numbers: the report payload is recomputed from the same metric
services as the dashboards, and the response carries the metric definitions,
grain and exclusions alongside the tables. The three kinds are sales, customer
and product performance. Tables are capped at 100 rows while summary values
cover every row in the selection. Analysts can update the name, kind, dataset
and dates of a saved report (`PATCH /reports/{id}`); existing export files
remain attached to the report. The Reports page and the analysis pages also
support duplicate and share-by-URL flows.

The organization-wide export feed (`GET /reports/exports`) powers the app-shell
Activity panel alongside dataset processing and forecast runs. The dataset
summary adds `last_processed_at`, `last_run_status`, `rows_rejected` and
`quality_issue_count` for the dashboard confidence card and the dataset list.

Exports are job resources. Starting one requires analyst or above, locks the
report row, refuses a second queued or running export for that report with
409, and returns 202. A broker failure marks the job failed and answers 503.
The worker renders CSV or PDF, stores the file under `MEDIA_ROOT` and records
its filename, row count and size on the job; failures keep the error message
and no file. Downloads are authenticated and organisation-scoped through the
report, never served directly from the media directory.

CSV uses a UTF-8 BOM and neutralises source labels that begin like formulas.
PDF uses ReportLab's built-in fonts, escaped text, repeated table headers and
page numbers. Files are removed when a report is deleted, which happens
through the service or by cascading from its dataset.

## Milestone status

M9 is complete: organisation-scoped saved reports and queued CSV/PDF exports
sit alongside M8 forecasting and the earlier analytics pages. The Reports page
saves or edits a metric view, shows its summary, tables and definitions,
exposes its export history, polls active jobs and downloads completed files.
The M9 usability pass adds a shared URL-backed analysis scope, date presets,
quick save/export actions, report duplication and sharing, a global Activity
panel and data-confidence indicators. Datasets, analytics, forecasts and
reports remain organisation-scoped by the same membership service as every
other endpoint.

Known limitations at M9:

- Predicted CLV is not implemented. The customer value shown is observed net
  sales to date and is labelled as such.
- Geographic performance is not implemented; `dim_geography` is loaded but has
  no analytics API or page.
- Product categories are not inferred; products are identified by source code
  and description only.
- Product change direction is a fixed ±20% heuristic with no seasonality
  adjustment or statistical test.
- RFM scores are relative to the selected customers, so they change when the
  date range or dataset changes. Small selections can produce tied or neutral
  scores.
- Retention month 0 is 100% by definition, and the latest month can be
  partial. Cohorts are limited to the 12 newest and activity means a sales
  invoice, not a return.
- Identity is dataset-scoped: the same invoice number, customer id or product
  code in two datasets is counted twice. There is no cross-dataset merge key.
- No currency conversion: fact amounts are assumed to be in the organisation's
  currency, and the warehouse stores no per-line currency.
- Forecasts need at least 12 monthly periods and are monthly only; shorter or
  newly onboarded datasets return 400.
- The Holt model has no seasonal term, promotion, price, stock-out or holiday
  inputs. The seasonal-naive baseline is a comparator, not a model input.
- Forecast intervals are a constant ±1.96 × test RMSE band, not calibrated
  prediction intervals, and lower bounds are not truncated at zero.
- Forecast and anomaly results are snapshots on the run. Rerunning after data
  changes creates a new run; earlier runs keep their stored history and output.
- Anomalies are level outliers against the whole history, not changepoints,
  and do not alter the forecast.
- One forecast run per organisation may be queued or running at a time.
- Saved reports store filters, not point-in-time results. Opening or exporting
  after a warehouse change shows current numbers.
- Report editing changes the stored filters; existing export files are kept
  and new exports use the updated filters.
- Global cross-entity search and command-palette navigation are not
  implemented; navigation is page-based.
- Email invitations and scheduled report delivery are not implemented.
- Report tables are limited to 100 rows; the export contains those rows, not
  every product or customer in the selection. Summary totals still cover the
  full selection.
- Exports are generated on request only: there are no schedules, email
  delivery or background refresh of saved reports.
- CSV is UTF-8 with a BOM; Excel imports it directly, but there is no native
  `.xlsx` writer.
- PDF uses the built-in Helvetica font, so characters outside CP1252 are
  replaced rather than embedded from a Unicode font.
- Report payloads contain computed tables and metric definitions, not
  generated narrative findings or recommendations.
- Deleting a report removes its exports; deleting its dataset removes the
  reports and exports too.
- Sales growth is unavailable unless the preceding equal-length period had
  positive net sales; the API returns null and the dashboard says so.
- Analytics are recomputed per request; there is no cached or materialised
  metric layer.
- Only one import per dataset is active; re-uploading a corrected file creates
  a new dataset rather than a new version.
- CSV only; Excel and JSON uploads are out of scope.
- A credit-note document type is not modelled: returns are recognised by the
  return flag or a negative quantity on a sales-shaped row.
- Quality issues are replaced on reprocess; run history is kept but its issues
  are not versioned.
- People must already have an account before they can be added to an
  organisation; email invitations and password reset are not implemented.
- A user's role is organisation-wide; dataset-level grants are not implemented.
- The Angular dev server proxies `/api` (`frontend/proxy.conf.json`); bypassing
  the proxy requires the CORS and CSRF allow-lists.

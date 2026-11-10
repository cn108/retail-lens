# Database and analytical warehouse design

Status: **implemented through M9 (metadata, raw rows, warehouse, quality,
processing history, forecast outputs, saved reports and export jobs).** Grain
decisions were recorded here before the ETL was written, as the specification
requires.

## Ownership and tenancy

Every user-owned row carries an explicit organisation scope. Access is
enforced in querysets and service methods, not in the UI.

M2 implements the identity group: `organisations` (name, slug, currency,
time zone, retention), `organisation_members` (unique per organisation and
user, with the role) and `user_preferences` (the default organisation). Later
tables add an `organisation_id` foreign key and index it.

## Table groups

| Group | Tables | Purpose |
| --- | --- | --- |
| Identity | `users`, `organisations`, `organisation_members`, `user_preferences` | Implemented in M2: authentication, membership, roles, preferences |
| Dataset management | `datasets`, `dataset_imports`, `dataset_columns`, `data_quality_issues`, `processing_logs` | Metadata, import lifecycle, mappings, quality, audit |
| Raw source | `raw_transactions` | Source rows preserved verbatim with import references |
| Dimensions | `dim_date`, `dim_customer`, `dim_product`, `dim_geography` | Conformed descriptive entities |
| Facts | `fact_sales`, `fact_returns` | Transactional measures at documented grain |
| Forecasting | `forecast_runs`, `forecast_points`, `forecast_anomalies` | Run audit and methodology, monthly predictions, historical anomalies (M8) |
| Reporting | `saved_reports`, `report_jobs` | Saved metric views, export job status and generated files (M9) |

M5–M7 sales, customer and product metrics are computed from the facts and
dimensions on request; they add no tables. M8 adds the three forecast tables,
which store derived outputs and the audit of the run that produced them. M9
adds saved report definitions and export jobs. `analytical_insights` is not
implemented: reports contain computed tables and definitions, not generated
narrative findings.

## Grain, decided before ETL

- `fact_sales` — one row per positive-quantity invoice line from the source
  dataset. Keys: `sales_fact_key` (surrogate), `date_key`, `customer_key`,
  `product_key`, `geography_key`, `dataset_id`. Measures: `quantity`
  (constrained > 0), `unit_price`, `gross_line_amount`, `discount_amount`
  (nullable unless supplied), `net_line_amount`. Lineage: `import_id`,
  `source_invoice_id`, `source_line_identifier`, `source_row_number`.
- `fact_returns` — one row per returned or credited line, stored separately
  with `quantity` constrained < 0 and linked to its source invoice. A line is
  a return when the mapped return flag is truthy or the quantity is negative;
  its quantity is normalised to `-abs(quantity)` so net sales subtract each
  return exactly once.
- `raw_transactions` — one row per physical source row, unmodified, including
  rows validation rejects. Unique on `(dataset, row_number)`.
- `dim_customer` — one row per distinct source customer identifier within a
  dataset. Anonymous transactions keep a null customer key; no customers are
  invented.
- `dim_product` — one row per distinct source stock code within a dataset;
  the first non-empty description seen is kept. `category` stays null unless
  supplied or derived by a documented mapping.
- `dim_date` — one global row per calendar day, shared by every dataset, with
  year, quarter, month, day, ISO year/week and ISO day of week.
- `dim_geography` — one row per distinct source country label within a
  dataset.

A line is identified by the mapped `line_id` when present; otherwise the
source row number is used (`row-{n}`), keeping
`(dataset, source_invoice_id, source_line_identifier)` unique. A repeated
line identifier within one invoice is rejected as `duplicate_line`.

Discounts reduce the absolute line amount: `net = gross - discount` for sales
and `net = gross + discount` for returns (gross itself is negative there), so
a return with a discount does not over-refund.

## Integrity and performance

Foreign keys, check constraints (quantity sign rules per fact table),
not-null constraints on keys, and uniqueness keys that make reprocessing
idempotent — for example a unique constraint over `dataset_id`,
`source_invoice_id` and `source_line_identifier`. Indexes on date, dataset,
organisation and dimension keys. Imports and warehouse loads run in a
transaction; a failed import leaves no partial curated rows.

## Dataset management (M3)

- `datasets` — one row per uploaded dataset: organisation, name, status
  (`draft`, `mapped`, `processing`, `ready` or `failed`), creator and the
  current import. Organisation is indexed by the foreign key and enforced in
  every query.
- `dataset_imports` — one row per uploaded file: storage path, original name,
  SHA-256 checksum, size, encoding, delimiter, row and column counts,
  inspection warnings, status and creator. An identical checksum within an
  organisation is refused rather than stored twice.
- `dataset_columns` — one row per source column per import, at a fixed
  position: source name, inferred type, null count, sample values and the
  canonical field it maps to. Unique on `(import, position)` and
  `(import, source_name)`.

All three cascade from the dataset, so deleting it removes the metadata and
its file.

## Processing and warehouse (M4)

- `processing_logs` — one row per processing attempt: dataset, status
  (`queued`, `running`, `succeeded`, `failed`), start/finish timestamps, rows
  read/loaded/rejected, a JSON warehouse summary, error message and creator.
  Indexed on `(dataset, -created_at)`; it is the job resource the API exposes.
- `data_quality_issues` — one row per rejected row and reason: dataset,
  optional run, source row number, code, message, source column and raw value.
  Indexed on `(dataset, row_number)`; reflects the latest run because a
  reprocess replaces the dataset's issues.
- `raw_transactions` — dataset, import, row number and the original payload as
  a JSON object keyed by source column name.
- `dim_date` — global and unique on `date`.
- `dim_customer`, `dim_product`, `dim_geography` — dataset-scoped, unique on
  the dataset plus the source identifier/label.
- `fact_sales`, `fact_returns` — dataset and import scoped, with a unique
  `(dataset, source_invoice_id, source_line_identifier)` line key, quantity
  sign checks and an index on `(dataset, date_key)`.

Deleting a dataset cascades to its imports, columns, raw rows, dimensions,
facts, issues, processing runs, saved reports and their export jobs. Export
files are removed when their job is deleted. `dim_date` rows are shared and
survive dataset deletion.

## Forecasting (M8)

- `forecast_runs` — one row per requested forecast and the job resource the
  API exposes: organisation, optional dataset, status (`queued`, `running`,
  `succeeded`, `failed`), month granularity, horizon (1–12), model and baseline
  versions, training start and end, the monthly history snapshot as JSON, the
  metrics JSON, the anomaly method and count, an error message, start/finish
  timestamps, creator and creation time. Indexed on
  `(organisation, -created_at)` and `(dataset, -created_at)`. Deleting the
  organisation cascades; deleting a dataset sets its link to null so the run
  audit survives; deleting the creator leaves it null.
- `forecast_points` — one row per forecast month: run, target date, predicted
  amount and lower/upper interval bounds (numeric 14,4). Unique on
  `(run, target_date)`, ordered by target date and cascaded from the run.
- `forecast_anomalies` — one row per anomaly found in the observed history:
  run, observed date and amount, expected (median) amount, deviation, score
  (numeric 12,3) and direction (`above` or `below`). Unique on
  `(run, observed_date)`, ordered by observed date and cascaded from the run.

The run table keeps the exact input series, so a result remains reproducible
after the warehouse changes. Points and anomalies are rewritten inside the
transaction that marks a run succeeded; a failed run keeps neither. The JSON
shapes are defined in `docs/DATA_DICTIONARY.md` and the formulas in
`docs/ANALYTICAL_METHODOLOGY.md`.

## Reporting (M9)

- `saved_reports` — one row per saved metric view: organisation, optional
  dataset (null means all processed datasets), name, kind (`sales`,
  `customers`, `products`), optional inclusive `date_from` and `date_to`,
  creator and timestamps. Indexed on `(organisation, -created_at)`. A report
  tied to one dataset is removed with that dataset, so it cannot silently
  widen its scope; an all-data report has no dataset link and remains. The
  organisation cascades and the creator is set null.
- `report_jobs` — one row per requested export: report, format (`csv` or
  `pdf`), status (`queued`, `running`, `succeeded`, `failed`), stored file,
  generated filename, row count, byte size, error message, start/finish
  timestamps, creator and creation time. Indexed on `(report, -created_at)`;
  it is the job resource the API exposes. The report cascades; the creator is
  set null. One queued or running job per report is enforced by the service
  under a report row lock.

A saved report stores filters and a metric family, not a result snapshot. Its
filters can be updated by an analyst, but its content is still recomputed from
the shared metric services whenever it is read or exported, so it cannot drift
from the dashboards. Export files live under
`MEDIA_ROOT` and are never served directly; a `post_delete` hook removes the
stored file when a job is deleted, including a cascade from its report or
dataset. The payload shape and metric definitions are documented in
`docs/DATA_DICTIONARY.md` and `docs/ANALYTICAL_METHODOLOGY.md`.

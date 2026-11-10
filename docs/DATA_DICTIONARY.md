# Data dictionary

Status: **dataset, mapping, processing, warehouse, forecast and report fields
documented** (M3–M9). Derived sales, customer and product metrics (M5–M7)
have no stored columns; their definitions live in
`ANALYTICAL_METHODOLOGY.md`. Every field that appears in the product UI is
listed here.

Each entry records the table, column, type, nullability, source and the
behaviour that consumes it.

## Dataset management (M3)

### `datasets`

| Column | Type | Null | Source | Used by |
| --- | --- | --- | --- | --- |
| `id` | UUID | no | generated | API resource id |
| `organisation_id` | UUID FK `organisations` | no | caller's active membership | every dataset query |
| `name` | varchar(255) | no | upload form, else filename stem | list and detail headings |
| `status` | varchar(16) | no | `draft`, `mapped`, `processing`, `ready` or `failed` | upload, mapping and processing screens |
| `created_by_id` | UUID FK `users` | yes | uploading user | detail attribution; null after user deletion |
| `current_import_id` | UUID FK `dataset_imports` | yes | latest inspected import | schema, row counts, mapping |
| `created_at`, `updated_at` | timestamptz | no | automatic | detail metadata |

The dataset API also exposes derived summary fields from its latest
processing run and current quality issues: `last_processed_at`,
`last_run_status`, `rows_rejected` and `quality_issue_count`. These power the
dashboard confidence card and the dataset list; they are not stored on the
`datasets` row.

### `dataset_imports`

| Column | Type | Null | Source | Used by |
| --- | --- | --- | --- | --- |
| `id` | UUID | no | generated | import audit |
| `dataset_id` | UUID FK `datasets` | no | upload | cascade source |
| `file` | varchar(255) | no | uploaded file under `MEDIA_ROOT` | re-read by every processing run |
| `original_filename` | varchar(255) | no | upload | detail header |
| `content_type` | varchar(120) | yes | browser content type | audit only |
| `size_bytes` | bigint | no | upload | size limit enforcement |
| `checksum_sha256` | varchar(64) | no | computed while streaming the upload | duplicate detection within an organisation |
| `encoding` | varchar(32) | no | detected (`utf-8`, `utf-8-sig`, `cp1252`, `latin-1`) | detail metadata |
| `delimiter` | varchar(1) | no | detected or supplied (`,`, `;`, tab, `|`) | re-reading the file during processing |
| `row_count` | integer | no | counted during inspection (blank lines excluded) | list and detail |
| `column_count` | smallint | no | header width | list and detail |
| `warnings` | jsonb list | no | inspection (width mismatches, date order, mixed-type values) | amber warning list |
| `status` | varchar(16) | no | `inspected` or `failed` | import audit |
| `error_message` | text | no (blank allowed) | failed inspection | audit |
| `created_at` | timestamptz | no | automatic | detail metadata |

### `dataset_columns`

| Column | Type | Null | Source | Used by |
| --- | --- | --- | --- | --- |
| `id` | UUID | no | generated | mapping payload key |
| `import_record_id` | UUID FK `dataset_imports` | no | upload | cascade |
| `position` | smallint | no | header order, zero-based | display order |
| `source_name` | varchar(255) | no | trimmed header | mapping table |
| `inferred_type` | varchar(16) | no | inspection (`text`, `integer`, `decimal`, `date`, `boolean`) | type compatibility |
| `canonical_field` | varchar(64) | yes (blank means unmapped) | saved mapping | mapping completeness |
| `null_count` | integer | no | inspection (empty values in profiled rows) | mapping table |
| `sample_values` | jsonb list | no | up to three distinct non-empty examples | mapping table |

Constraints: unique `(import_record, position)` and unique
`(import_record, source_name)`.

## Canonical transaction fields

A source column may map to one field, and only if the field accepts the
detected type. These definitions live in `apps/ingestion/canonical.py` and are
the contract the ETL loads against.

| Key | Label | Required | Accepts | Meaning |
| --- | --- | --- | --- | --- |
| `invoice_id` | Invoice number | yes | text, integer | Identifier shared by every line of one invoice |
| `line_id` | Line number | no | text, integer | Identifier unique within the invoice; de-duplicates lines |
| `invoice_date` | Invoice date | yes | date | Date the sale took place |
| `customer_id` | Customer ID | no | text, integer | Source customer identifier; blank is anonymous |
| `product_code` | Product code | yes | text, integer | Stock keeping unit or SKU |
| `product_description` | Description | no | text | Product name or description |
| `quantity` | Quantity | yes | integer | Units sold; negative values are returns |
| `unit_price` | Unit price | yes | decimal, integer | Price per unit in the organisation currency |
| `discount` | Discount | no | decimal, integer | Line discount, only when supplied |
| `country` | Country | no | text | Customer country label |
| `is_return` | Return flag | no | boolean, integer, text | States explicitly that the line is a return |

## Type inference

- Empty values are counted as null and ignored when deciding a type.
- `integer` — values match an optional sign followed by digits.
- `decimal` — values match a decimal number (integers are a subset).
- `date` — values parse as ISO date/time, DD/MM/YYYY, MM/DD/YYYY,
  DD-MM-YYYY, DD.MM.YYYY or a common timestamp form. Day-first is preferred;
  the UI warns when a source may be month-first.
- `boolean` — values are true/false, yes/no or y/n.
- A type is accepted when at least 90% of non-empty profiled values match, or
  all but one value in a smaller file. The inspector warns about the
  non-conforming values; those rows are rejected during processing.
- Columns with no values, or with mixed values that match no type, are `text`.
- An all-empty column may be mapped to any canonical field; it contributes no
  values.

## Processing (M4)

### `processing_logs`

| Column | Type | Null | Source | Used by |
| --- | --- | --- | --- | --- |
| `id` | UUID | no | generated | run resource id |
| `dataset_id` | UUID FK `datasets` | no | queued run | history and polling |
| `status` | varchar(16) | no | `queued`, `running`, `succeeded`, `failed` | processing panel |
| `started_at`, `finished_at` | timestamptz | yes | worker | run timing |
| `rows_read` | integer | no | every non-empty data row | summary |
| `rows_loaded` | integer | no | sales plus return rows written | summary |
| `rows_rejected` | integer | no | rows with a quality issue | summary |
| `summary` | jsonb | no | warehouse counts after loading | summary detail |
| `error_message` | text | no (blank allowed) | failure reason | failed panel |
| `created_by_id` | UUID FK `users` | yes | requesting user | audit; null after user deletion |
| `created_at` | timestamptz | no | automatic | ordering |

### `data_quality_issues`

| Column | Type | Null | Source | Used by |
| --- | --- | --- | --- | --- |
| `id` | UUID | no | generated | issue row key |
| `dataset_id` | UUID FK `datasets` | no | processing | issues table |
| `processing_run_id` | UUID FK `processing_logs` | yes | producing run | audit; null if the run row is removed |
| `row_number` | integer | no | 1-based position among data rows | issues table |
| `code` | varchar(32) | no | see codes below | issues table |
| `message` | varchar(255) | no | human-readable reason | issues table |
| `source_column` | varchar(255) | no (blank allowed) | canonical field involved | diagnosis |
| `raw_value` | text | no (blank allowed) | offending raw value (max 500 chars) | diagnosis |
| `created_at` | timestamptz | no | automatic | ordering |

Issue codes: `missing_invoice`, `invalid_date`, `missing_product`,
`invalid_quantity`, `invalid_price`, `invalid_discount`,
`invalid_return_flag`, `duplicate_line`.

### `raw_transactions`

| Column | Type | Null | Source | Used by |
| --- | --- | --- | --- | --- |
| `id` | bigint | no | generated | row key |
| `dataset_id` | UUID FK `datasets` | no | processing | provenance |
| `import_record_id` | UUID FK `dataset_imports` | no | current import | provenance |
| `row_number` | integer | no | 1-based position among data rows | reconciliation with issues |
| `payload` | jsonb | no | source column name to raw value | verbatim source row |
| `created_at` | timestamptz | no | automatic | audit |

Unique on `(dataset, row_number)`.

## Warehouse dimensions (M4)

### `dim_date`

Global, one row per calendar day, shared by all datasets.

| Column | Type | Null | Source | Used by |
| --- | --- | --- | --- | --- |
| `id` | bigint | no | generated | fact `date_key` |
| `date` | date | no | invoice date (unique) | daily grain |
| `year`, `quarter`, `month`, `day` | smallint | no | calendar | time grouping |
| `iso_year`, `iso_week` | smallint | no | ISO calendar | weekly reporting |
| `day_of_week` | smallint | no | ISO weekday, 1 = Monday | weekday analysis |

### `dim_customer`

Dataset-scoped; anonymous lines have a null customer key.

| Column | Type | Null | Source | Used by |
| --- | --- | --- | --- | --- |
| `id` | bigint | no | generated | fact `customer_key` |
| `dataset_id` | UUID FK `datasets` | no | processing | tenancy |
| `source_customer_id` | varchar(128) | no | mapped customer id | customer analysis |
| `created_at` | timestamptz | no | automatic | audit |

Unique on `(dataset, source_customer_id)`.

### `dim_product`

| Column | Type | Null | Source | Used by |
| --- | --- | --- | --- | --- |
| `id` | bigint | no | generated | fact `product_key` |
| `dataset_id` | UUID FK `datasets` | no | processing | tenancy |
| `source_product_code` | varchar(128) | no | mapped product code | product analysis |
| `description` | varchar(255) | no (blank allowed) | first mapped description seen | product labels |
| `created_at` | timestamptz | no | automatic | audit |

Unique on `(dataset, source_product_code)`.

### `dim_geography`

| Column | Type | Null | Source | Used by |
| --- | --- | --- | --- | --- |
| `id` | bigint | no | generated | fact `geography_key` |
| `dataset_id` | UUID FK `datasets` | no | processing | tenancy |
| `country` | varchar(128) | no | mapped country label | geographic analysis |
| `created_at` | timestamptz | no | automatic | audit |

Unique on `(dataset, country)`.

## Warehouse facts (M4)

Both fact tables share the same lineage and measure shape; the quantity sign
and table differ.

| Column | Type | Null | Source | Used by |
| --- | --- | --- | --- | --- |
| `id` | bigint | no | generated | line key |
| `dataset_id` | UUID FK `datasets` | no | processing | tenancy |
| `import_record_id` | UUID FK `dataset_imports` | no | current import | lineage |
| `date_key` | bigint FK `dim_date` | no | invoice date | time analysis |
| `customer_key` | bigint FK `dim_customer` | yes | blank customer id stays null | customer analysis |
| `product_key` | bigint FK `dim_product` | no | product code | product analysis |
| `geography_key` | bigint FK `dim_geography` | yes | blank country stays null | geographic analysis |
| `quantity` | integer | no | mapped quantity; returns normalised to `-abs` | units; `fact_sales` > 0, `fact_returns` < 0 |
| `unit_price` | numeric(12,4) | no | mapped unit price | pricing |
| `gross_line_amount` | numeric(14,4) | no | `unit_price * quantity` | gross revenue |
| `discount_amount` | numeric(14,4) | yes | mapped discount, null when absent | discount analysis |
| `net_line_amount` | numeric(14,4) | no | `gross - discount` for sales, `gross + discount` for returns | net revenue |
| `source_invoice_id` | varchar(128) | no | mapped invoice number | lineage and grouping |
| `source_line_identifier` | varchar(128) | no | mapped line id, else `row-{n}` | line identity |
| `source_row_number` | integer | no | 1-based source position | drill-back to raw rows |
| `created_at` | timestamptz | no | automatic | audit |

Unique on `(dataset, source_invoice_id, source_line_identifier)` in each
table; indexed on `(dataset, date_key)`.

## Forecasting (M8)

### `forecast_runs`

| Column | Type | Null | Source | Used by |
| --- | --- | --- | --- | --- |
| `id` | UUID | no | generated | run key and API resource |
| `organisation_id` | UUID FK `organisations` | no | active membership | tenancy |
| `dataset_id` | UUID FK `datasets` | yes | optional request filter; null means every processed dataset | scope and audit; set null if the dataset is deleted |
| `status` | varchar(16) | no | `queued`, `running`, `succeeded`, `failed` | job state |
| `granularity` | varchar(16) | no | fixed `month` | input grain |
| `horizon` | smallint | no | request, 1–12 | number of forecast months |
| `model_name` | varchar(64) | no | `Holt linear trend` | methodology |
| `model_version` | varchar(64) | no | `holt-linear-v1` | methodology |
| `training_start` | date | yes | first monthly period in the snapshot | training range |
| `training_end` | date | yes | last observed monthly period | training range |
| `history` | jsonb | no | `[{"period": "YYYY-MM-01", "amount": "1234.0000"}]` | reproducibility |
| `metrics` | jsonb | no | model and baseline MAE/RMSE, improvement, split counts, `alpha`, `beta`, interval rule, minimum history | accuracy and methodology |
| `anomaly_method` | varchar(128) | no | `Tukey IQR fences (mean ± 3σ fallback)` | methodology |
| `anomaly_count` | integer | no | number of stored anomalies | summary |
| `error_message` | text | no | failure reason (empty when successful) | failure state |
| `started_at` | timestamptz | yes | worker | audit |
| `finished_at` | timestamptz | yes | worker | audit |
| `created_by_id` | UUID FK `users` | yes | requesting user; null if the account is deleted | audit |
| `created_at` | timestamptz | no | automatic | ordering |

Indexed on `(organisation, -created_at)` and `(dataset, -created_at)`. One run
per organisation may be queued or running at a time. The metrics JSON has the
shape `{model: {name, version, mae, rmse}, baseline: {...},
improvement_percent, split: {training_periods, validation_periods,
test_periods}, alpha, beta, interval, minimum_history_months}`;
`improvement_percent` is null when the baseline RMSE is zero.

### `forecast_points`

| Column | Type | Null | Source | Used by |
| --- | --- | --- | --- | --- |
| `id` | bigint | no | generated | row key |
| `run_id` | UUID FK `forecast_runs` | no | parent run | grouping; cascades |
| `target_date` | date | no | first day of the forecast month | forecast table and chart |
| `predicted_amount` | numeric(14,4) | no | model point forecast | forecast |
| `lower_bound` | numeric(14,4) | no | prediction − 1.96 × test RMSE | interval |
| `upper_bound` | numeric(14,4) | no | prediction + 1.96 × test RMSE | interval |

Unique on `(run, target_date)`; ordered by target date.

### `forecast_anomalies`

| Column | Type | Null | Source | Used by |
| --- | --- | --- | --- | --- |
| `id` | bigint | no | generated | row key |
| `run_id` | UUID FK `forecast_runs` | no | parent run | grouping; cascades |
| `observed_date` | date | no | month containing the outlier | anomaly table |
| `observed_amount` | numeric(14,4) | no | net sales in that month | anomaly |
| `expected_amount` | numeric(14,4) | no | median of the history | comparison |
| `deviation_amount` | numeric(14,4) | no | observed − expected; signed | anomaly |
| `score` | numeric(12,3) | no | (observed − median) ÷ fence scale | severity |
| `direction` | varchar(8) | no | `above` or `below` the median | presentation |

Unique on `(run, observed_date)`; ordered by observed date.

## Reporting (M9)

### `saved_reports`

| Column | Type | Null | Source | Used by |
| --- | --- | --- | --- | --- |
| `id` | UUID | no | generated | report resource id |
| `organisation_id` | UUID FK `organisations` | no | active membership | tenancy; cascades |
| `dataset_id` | UUID FK `datasets` | yes | chosen processed dataset; null means all | scope; a scoped report is removed with its dataset |
| `name` | varchar(200) | no | save form | list and report heading |
| `kind` | varchar(16) | no | `sales`, `customers` or `products` | metric family and definitions |
| `date_from`, `date_to` | date | yes | optional inclusive filters | scope; empty means the dataset's observed range |
| `created_by_id` | UUID FK `users` | yes | saving user; null after deletion | attribution |
| `created_at`, `updated_at` | timestamptz | no | automatic | ordering and detail metadata |

Indexed on `(organisation, -created_at)`. The report stores filters, not
numbers: its payload is recomputed from the shared metric services on every
read and export.

### `report_jobs`

| Column | Type | Null | Source | Used by |
| --- | --- | --- | --- | --- |
| `id` | UUID | no | generated | export job resource id |
| `report_id` | UUID FK `saved_reports` | no | requested export | grouping; cascades |
| `format` | varchar(8) | no | `csv` or `pdf` | renderer selection and file type |
| `status` | varchar(16) | no | `queued`, `running`, `succeeded` or `failed` | polling and download gating |
| `file` | varchar(255) | no (blank while queued/failed) | generated artefact under `MEDIA_ROOT` | authenticated download; removed when the job is deleted |
| `filename` | varchar(255) | no (blank until generated) | safe report name plus date and extension | download filename |
| `row_count` | integer | no | total rows across exported tables | export summary |
| `size_bytes` | bigint | no | generated file size | export summary |
| `error_message` | text | no (blank when successful) | generation or queue failure | failed state |
| `started_at`, `finished_at` | timestamptz | yes | worker | export timing |
| `created_by_id` | UUID FK `users` | yes | requesting user; null after deletion | audit |
| `created_at` | timestamptz | no | automatic | ordering |

Indexed on `(report, -created_at)`. One queued or running job per report is
enforced by the service under a report row lock. Files are stored under
`media/reports/{organisation}/{report}/` with a random name; the original
report name is kept only in `filename` for the browser download.

### Report payload

`GET /reports/{id}` and the exporters share one payload:
`{id, name, kind, kind_label, dataset, date_from, date_to, created_by,
created_at, updated_at, generated_at, organisation_name, currency, has_data,
period, comparison, summary, sections, definitions, notes}`. `summary` is a
list of `{label, value, format, note}`; `sections` is a list of `{key, title,
description, columns, rows}` where each column has `{key, label, format}` and
formats are `text`, `money`, `number` or `percent`; `definitions` is a list of
`{metric, definition, grain, exclusions}`. Tables are capped at 100 rows and
`has_data: false` means no processed facts matched the filters.

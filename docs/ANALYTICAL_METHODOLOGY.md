# Analytical methodology

Status: **sales, customer and product metrics (M5–M7), forecasting (M8) and
saved reports (M9) implemented.** This file is the authoritative register for
every displayed measure. Each entry states its definition, formula, grain,
scope, exclusions, missing-value treatment and implementation.

All sales measures read `fact_sales` and `fact_returns` from the M4 warehouse.
Rejected source rows never reach the facts: they are preserved in
`raw_transactions` and explained in `data_quality_issues`. Dates are invoice
dates (`dim_date.date`), not ingestion timestamps, and fact line amounts are
stored in the organisation's currency without conversion.

## Scope and identity

- An organisation's facts only. An optional dataset filter must belong to that
  organisation or the API answers 404.
- Identity is dataset-scoped, matching the warehouse: an invoice number and a
  customer identifier are unique within their dataset, not across datasets.
  Aggregating two datasets therefore counts the same invoice number or
  customer id twice. This is deliberate; merging identities needs a documented
  cross-dataset key that the source does not provide.
- Returns are stored once, with negative measures, in `fact_returns` and are
  never deducted a second time.

## Implemented sales metrics (M5)

Implemented in `backend/apps/analytics/services.py` and exposed by
`GET /api/v1/analytics/sales/summary` and `.../trend`.

| Metric | Definition and formula | Grain | Exclusions | Missing-value treatment |
| --- | --- | --- | --- | --- |
| Gross sales | `SUM(fact_sales.gross_line_amount)` — unit price × quantity before discounts | Line to selected period | Returns; rejected rows | `0.0000` when no sales |
| Net sales | `SUM(fact_sales.net_line_amount) + SUM(fact_returns.net_line_amount)` | Line to selected period | Rejected rows | `0.0000`; returns alone give a negative value |
| Eligible orders | Count of distinct `(dataset_id, source_invoice_id)` pairs in `fact_sales` | Invoice | Invoices with only return lines; anonymous customers are still eligible | `0` when no sales |
| Average order value | `net_sales / eligible_orders`, rounded half-up to 4 dp | Period | Same as its inputs | `null` when there are no orders |
| Unique customers | Count of distinct `(dataset_id, customer_key)` pairs on sales lines | Customer | Null customer keys (anonymous sales) | `0`; return-only customers are not counted |
| Sales growth | `(current_net_sales − previous_net_sales) / previous_net_sales × 100`, rounded half-up to 2 dp | Period versus the immediately preceding period of the same number of days | Periods with no positive prior net sales | `null` — the UI shows "Not available" — when prior net sales ≤ 0 or the current period has no data |
| Net sales trend | Net sales per calendar bucket, with distinct invoices per bucket | Day, ISO week (Monday start) or month | Same as net sales | Buckets with no facts are omitted, not zero-filled; a bucket can be partial at a range edge |

Gross sales and net sales differ by discounts and returns. For a sale with a
discount, `net = gross − discount`; for a return, `gross` is negative and
`net = gross + discount`, so a discounted return does not over-refund.

## States

- No facts at all: `has_data: false`, zero amounts, null averages and growth,
  empty trend points and an empty dataset list.
- Facts but no orders (returns only): `has_data: true`, negative net sales, no
  average order value and no unique customers.
- Invalid dates, reversed ranges, unknown granularity or a foreign dataset:
  HTTP 400/404; no partial payload is returned.

## Implemented customer metrics (M7)

Implemented in `backend/apps/customers/services.py` and exposed by
`GET /api/v1/customers/summary`, `.../rfm` and `.../retention`.

A customer is a dataset-scoped `dim_customer` row with at least one **sales**
line in the selected range. Anonymous lines never enter customer measures,
and the same source customer id in two datasets is two customers. Returns
reduce a customer's monetary value but do not make a customer identifiable on
their own.

| Metric | Definition and formula | Grain | Exclusions | Missing-value treatment |
| --- | --- | --- | --- | --- |
| Identifiable customers | Count of distinct `(dataset, customer)` pairs with a sales line | Customer | Null customer keys; return-only customers | `0`; summary `has_data: false` |
| Repeat customers | Identifiable customers with at least two distinct sales invoices | Customer | Same as above | `0` |
| Repeat purchase rate | Repeat customers ÷ identifiable customers × 100 | Period | Same as above | `null` when there are no identifiable customers |
| Average orders | Distinct sales invoices ÷ identifiable customers | Period | Same as above | `null` without customers; two decimal places |
| Historical customer value | Sum of sales net amounts plus return net amounts for identifiable customers | Customer to period | Anonymous lines | `0.0000`; may be negative if returns exceed sales |
| Average historical value | Historical value ÷ identifiable customers | Period | Same as above | `null` without customers |
| RFM | Recency, frequency and monetary scores below | Customer | Same as above | Customers with one distinct value per measure receive the neutral score 3 |

Historical customer value is **observed** net revenue, not a predicted CLV.
No future-value model, horizon or survival assumption is implemented in M7.

### RFM definitions

- **Recency (R):** days from the customer's last sales invoice to the end of
the selected range. Lower is better.
- **Frequency (F):** distinct sales invoices in the range.
- **Monetary (M):** net sales (sales after discounts plus returns) in the range.
- **Scores:** each measure is ranked across the selected customers and split
  into percentile bands scored 1–5. Ties share a score. When a measure has a
  single distinct value every customer receives 3. Scores are relative to the
  current selection, not fixed pound thresholds.
- **Segments**, evaluated in this order:
  1. `champion` — R ≥ 4, F ≥ 4 and M ≥ 4.
  2. `loyal` — F ≥ 4 and R ≥ 3.
  3. `potential` — R ≥ 4 (and not already champion or loyal).
  4. `at_risk` — R ≤ 2 and (F ≥ 3 or M ≥ 3).
  5. `hibernating` — R ≤ 2 (and not already at risk).
  6. `occasional` — everything else, including neutral 3/3/3 scores.

### Cohorts and retention

- A customer's cohort is the calendar month of their **first sales invoice in
  all available history**, not merely the first invoice in the selected range.
- Cohort size is the number of customers whose first invoice falls in that
  month and inside the selected range.
- Retention at month offset *k* is the share of the cohort with at least one
  sales invoice in the calendar month *k* months after the cohort month. Month
  0 is therefore 100% by construction. Returns do not count as activity.
- `month_1_retention` is the size-weighted share of eligible cohorts (those
  with at least one observed following month) that purchased in month 1.
- The response returns the 12 newest cohorts, newest first, with every monthly
  column observed up to the selected range end.

## Implemented product metrics (M7)

Implemented in `backend/apps/analytics/services.py` and exposed by
`GET /api/v1/analytics/products/performance`.

A product is a dataset-scoped `dim_product` row with any sales or return line
in the range. Anonymous customers are included; products are about lines, not
customers. Categories are never inferred because the source has no category
field.

| Metric | Definition and formula | Grain | Exclusions | Missing-value treatment |
| --- | --- | --- | --- | --- |
| Product net sales | Sum of sales net amounts plus return net amounts | Product to period | Rejected rows | `0.0000`; negative for return-only products |
| Product gross sales | Sum of sales gross amounts | Product to period | Returns | `0.0000` |
| Units | Sales quantity plus return quantity (negative) | Product to period | — | `0` |
| Orders | Distinct sales invoices containing the product | Product to period | Return-only invoices | `0` |
| Revenue share | Product net sales ÷ total net sales in range × 100 | Product to period | — | `null` when total net sales ≤ 0 |
| Product change | `(current net − prior net) ÷ prior net × 100` against the immediately preceding equal-length period | Product | Products with prior net ≤ 0 | `null` when prior net ≤ 0 |
| Direction | `declining` at −20% or worse, `growing` at +20% or better, `stable` otherwise; `new` when prior net ≤ 0 and current net > 0; `returns` when prior net ≤ 0 and current net < 0 | Product | — | `stable` when both are zero |

Direction is a presentation heuristic with a fixed ±20% threshold, not a
statistical significance test. Top-product share uses the largest product net
sales and is `null` when total net sales are not positive.

## Planned metrics (not implemented)

| Metric | Owner | Open decisions |
| --- | --- | --- |
| Predicted CLV | not scheduled | Model assumptions and horizon; M7 reports observed historical value only |
| Geographic performance | later | Country normalisation and a geographic page |

## Forecasting (M8)

Forecasts are monthly net sales (sales plus negative returns) evaluated on a
strictly chronological train/validation/test split against a seasonal-naive
baseline. Every run records the input history, horizon, model and baseline
versions, split sizes, selected smoothing parameters and both test errors.

### Input series

| Item | Definition |
| --- | --- |
| Grain | Calendar month of invoice date |
| Measure | Net sales: sum of `fact_sales.net_line_amount` plus sum of `fact_returns.net_line_amount` (returns are negative) |
| Scope | The caller's organisation; optionally one dataset, otherwise every processed dataset in the organisation |
| Range | First to last month containing a sales or return fact, inclusive |
| Missing months | Months with no fact rows inside the range are filled with `0`; months before the first or after the last observation are never invented |
| Exclusions | Source rows rejected during processing (absent from the facts); no currency conversion |
| Minimum history | 12 monthly periods; a shorter series is refused with HTTP 400 before a run is created |

Because the range is bounded by observed facts, a trailing zero-filled month
cannot be added just because the calendar advanced. A month with genuinely no
business activity is treated as zero net sales.

### Chronological split

For `n` monthly periods:

| Slice | Periods |
| --- | --- |
| Training | `max(3, floor(0.6 × n))` |
| Validation | from the end of training to `min(n − 1, max(train + 1, floor(0.8 × n)))` |
| Test | the remaining periods to `n` |

Training periods fit the model, validation periods select the smoothing
parameters, and test periods are never used for either. The model is refit on
training plus validation before the test error is measured; the final forecast
refits on the full history. For 24 months this yields 14 training, 5
validation and 5 test periods.

### Model and baseline

| Role | Name and version | Rule |
| --- | --- | --- |
| Model | Holt linear trend `holt-linear-v1` | `level_t = α·y_t + (1−α)(level_{t−1} + trend_{t−1})`; `trend_t = β(level_t − level_{t−1}) + (1−β)·trend_{t−1}`; forecast `level_T + h·trend_T`, with `level_1 = y_1` and `trend_1 = y_2 − y_1` |
| Baseline | Seasonal naive `seasonal-naive-v1` | The value 12 months before the target month; the last observed value when 12 months of history are not available |

`α` and `β` are chosen from `{0.1, 0.3, 0.5, 0.7, 0.9}` by lowest validation
MAE (ties keep the first in that order). The chosen values are stored on the
run. The model has no seasonal term; the seasonal-naive baseline is the
seasonality comparator, not an input to the model.

### Reported accuracy

| Metric | Definition |
| --- | --- |
| MAE | Mean absolute error on the test periods, reported separately for model and baseline |
| RMSE | Square root of the mean squared error on the test periods, reported separately for model and baseline |
| Improvement | `(baseline RMSE − model RMSE) ÷ baseline RMSE × 100`; `null` when baseline RMSE is 0 |
| 95% interval | Point forecast ± `1.96 × test RMSE`; a residual-based band, not a model-uncertainty interval |

Bounds are not truncated at zero, so a negative lower bound is shown as such.
The interval width is constant across the horizon because the model does not
propagate parameter uncertainty.

### Anomaly detection

Anomalies are level outliers in the observed history, computed independently
of the forecast:

1. Require at least 6 monthly periods, otherwise none are reported.
2. The expected value is the median of the history.
3. Compute Q1 and Q3 with the inclusive quartile method and `IQR = Q3 − Q1`.
4. Fences are `Q1 − 1.5·IQR` and `Q3 + 1.5·IQR`. If the IQR is zero, fall back
   to `mean ± 3 × population standard deviation`; if the deviation is also
   zero, report none.
5. A month strictly outside the fences is an anomaly. Direction is `above` or
   `below` the median; score is `(observed − median) ÷ scale`, where scale is
   the IQR or the fallback standard deviation.

Anomalies are stored with the run, so rerunning after the data changes can
produce a different set; each run keeps its own result.

### Recorded methodology

Every forecast run stores the monthly history snapshot, `granularity=month`,
the horizon (1–12 months), training start and end, model and baseline name and
version, the train/validation/test counts, `alpha`, `beta`, test MAE and RMSE
for both candidates, the improvement percentage, the interval rule, the
minimum history and the anomaly method. The run is therefore reproducible from
its stored inputs even after the warehouse changes.

### States and failure behaviour

| State | Behaviour |
| --- | --- |
| No runs | Empty state explains the 12-month requirement and links to datasets |
| Insufficient history | HTTP 400 with the available and required month counts; no run row is created |
| Run already active | HTTP 409 while another run for the organisation is queued or running |
| Queue unavailable | HTTP 503 and the run row is marked failed with a queue error |
| Queued or running | The run resource is returned with 202; the page polls every 2 seconds |
| Failed | The stored error message is shown; metrics and points are absent |
| Succeeded | Metrics, chart, forecast points and anomalies are shown |

### Limits of the method

- Holt's linear trend extrapolates the latest level and slope; it does not
  learn seasonality, promotions, price changes, stock-outs or holidays.
- The interval is a flat residual band based on test RMSE, not a calibrated
  prediction interval.
- Anomalies describe unusual monthly levels relative to the whole history;
  they are not changepoints and do not adjust the forecast.
- Monthly is the only grain, and at least 12 months are required, so short or
  newly onboarded datasets cannot be forecast.
- Amounts are assumed to share the organisation currency and are not converted.
- One forecast run per organisation may be active at a time.

## Reporting (M9)

A saved report is a reusable view over the metrics above, not a new measure and
not a stored result. It records one organisation, an optional processed
dataset (null means every processed dataset), an optional inclusive date range
and one kind. Opening or exporting it recomputes
the summary and tables from the same `analytics.services` and
`customers.services` functions used by the dashboards, so a report cannot
introduce a second formula. Every report payload includes the metric
definitions, grain and exclusions listed earlier in this file.

| Kind | Summary | Tables |
| --- | --- | --- |
| Sales performance | Net sales, gross sales, eligible orders, average order value, unique customers, sales growth | Calendar-month net sales with gross sales and orders; top products by net sales |
| Customer performance | Identifiable customers, repeat purchase rate, historical customer value, month-1 retention | RFM segment distribution; customers by net sales with segment labels |
| Product performance | Net sales, products sold, top product share, declining products | Product net sales, units, orders and revenue share |

Filters follow the existing metric rules. A missing `date_from` or `date_to`
resolves to the first or last observed fact date for the selected dataset; a
reversed range is rejected with HTTP 400 before the report is saved. The
dataset must belong to the caller's organisation. Customer and product
identity remains dataset-scoped, returns remain negative measures, and no
currency conversion is applied.

Exports consume the exact API payload. Tables are capped at 100 rows while
summary values cover the full selection. CSV writes the summary, each table
and the definitions with a UTF-8 BOM; text labels beginning with `=`, `+`, `-`
or `@` are prefixed with an apostrophe to prevent spreadsheet formula
injection (numeric values are not changed). PDF renders the same content with
ReportLab, using the built-in Helvetica font, repeated table headers, page
numbers and escaped text.

| State | Behaviour |
| --- | --- |
| No saved reports | Empty state explains creating a report from a processed dataset |
| No matching facts | `has_data: false`, zero/null summary values, empty tables; export still succeeds and documents the empty selection |
| Export queued or running | 202 job resource; the page polls every 2 seconds |
| Export already active | HTTP 409 while another export for the report is queued or running |
| Export failed | Job keeps the error message and no file; the page shows it |
| Export succeeded | Authenticated download with the generated filename |

Reports are definitions, not point-in-time snapshots: a later export reflects
the warehouse at that moment. There are no scheduled reports, email delivery,
narrative findings, `.xlsx` output or custom report builder. PDF text outside
CP1252 is replaced because no Unicode font is embedded.

## Prohibited

No profit or margin metrics without cost data. No inferred categories,
inventory or demographics. No fabricated insights, no zero-filled trend
periods, and no placeholder numbers.

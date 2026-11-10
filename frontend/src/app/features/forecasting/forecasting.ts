import { Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { apiErrorMessage } from '../../core/api/api-error';
import { DatasetSummary, DatasetsService } from '../../core/api/datasets.service';
import {
  ForecastAnomaly,
  ForecastRun,
  ForecastRunDetail,
  ForecastStatus,
  ForecastingService,
} from '../../core/api/forecasting.service';
import { AuthService } from '../../core/auth/auth.service';
import { formatMoney, formatPercent } from '../../core/formatting';
import { ForecastChart, buildForecastChart } from './forecast-chart';

const HORIZONS = [3, 6, 12] as const;

@Component({
  selector: 'app-forecasting',
  imports: [RouterLink],
  template: `
    <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
          Forecasts and anomalies
        </p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
          Forecasting
        </h1>
        <p class="mt-2 max-w-2xl text-sm text-slate-600">
          Monthly net sales forecast with a chronological train/validation/test split. Each run
          reports test error for the model and a seasonal-naive baseline, plus anomalies in the
          observed history.
        </p>
      </div>
      @if (detail(); as run) {
        <p class="text-right text-sm text-slate-600">
          {{ run.dataset?.name || 'All processed data' }}
          <span class="block text-xs text-slate-500">
            {{ run.horizon }}-month horizon · {{ run.model_version }}
          </span>
        </p>
      }
    </header>

    <section class="rounded-2xl border border-slate-200 bg-white p-5">
      <div class="flex flex-wrap items-end gap-3">
        <label class="block min-w-52 flex-1">
          <span class="text-xs font-medium uppercase tracking-wide text-slate-500">Dataset</span>
          <select
            [value]="datasetId()"
            [disabled]="creating()"
            (change)="datasetChanged($event)"
            class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">All processed datasets</option>
            @for (dataset of availableDatasets(); track dataset.id) {
              <option [value]="dataset.id" [selected]="dataset.id === datasetId()">
                {{ dataset.name }}
              </option>
            }
          </select>
        </label>
        <label class="block">
          <span class="text-xs font-medium uppercase tracking-wide text-slate-500">Horizon</span>
          <select
            [value]="horizon()"
            [disabled]="creating()"
            (change)="horizonChanged($event)"
            class="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            @for (option of horizons; track option) {
              <option [value]="option" [selected]="option === horizon()">
                {{ option }} months
              </option>
            }
          </select>
        </label>
        @if (canRun()) {
          <button
            type="button"
            [disabled]="creating()"
            class="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
            (click)="runForecast()"
          >
            {{ creating() ? 'Starting…' : 'Run forecast' }}
          </button>
        } @else {
          <p class="pb-2 text-xs text-slate-500">
            Your role can view forecasts but not start a run.
          </p>
        }
      </div>
      <p class="mt-2 text-xs text-slate-500">
        At least 12 monthly periods are required. Runs are queued and evaluated in the background;
        this page updates itself.
      </p>
    </section>

    @if (error(); as message) {
      <p role="alert" class="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
        {{ message }}
      </p>
    }

    @if (loadingRuns()) {
      <p class="mt-6 text-sm text-slate-500">Loading forecast runs…</p>
    } @else if (!runs().length) {
      <section
        class="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"
      >
        <h2 class="text-lg font-semibold text-slate-900">No forecasts yet</h2>
        <p class="mx-auto mt-2 max-w-xl text-sm text-slate-600">
          Forecasts need processed sales history with at least 12 monthly periods. Choose a dataset
          and horizon, then start a run.
        </p>
        <a
          routerLink="/datasets"
          class="mt-4 inline-block rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Go to datasets
        </a>
      </section>
    } @else {
      <section
        class="mt-6 flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-5"
      >
        <label class="block min-w-72 flex-1">
          <span class="text-xs font-medium uppercase tracking-wide text-slate-500">Run</span>
          <select
            [value]="selectedRunId()"
            (change)="runChanged($event)"
            class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            @for (run of runs(); track run.id) {
              <option [value]="run.id" [selected]="run.id === selectedRunId()">
                {{ runLabel(run) }}
              </option>
            }
          </select>
        </label>
        @if (selectedRun(); as run) {
          <span [class]="statusClass(run.status)">{{ statusLabel(run.status) }}</span>
        }
      </section>

      @if (loadingDetail() && !detail()) {
        <p class="mt-6 text-sm text-slate-500">Loading the forecast run…</p>
      } @else if (detailError(); as message) {
        <p role="alert" class="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {{ message }}
        </p>
      } @else if (detail(); as run) {
        <section class="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="text-sm font-semibold text-slate-900">Methodology</h2>
              <p class="mt-1 max-w-2xl text-sm text-slate-600">
                {{ run.model_name }} ({{ run.model_version }}) on monthly net sales, including
                negative returns. The test window is the last slice of history and was not used to
                fit the model.
              </p>
            </div>
            <span [class]="statusClass(run.status)">{{ statusLabel(run.status) }}</span>
          </div>
          <dl class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div class="rounded-xl bg-slate-50 p-3">
              <dt class="text-xs uppercase tracking-wide text-slate-500">Training range</dt>
              <dd class="mt-1 font-medium text-slate-900">{{ trainingRange(run) }}</dd>
            </div>
            <div class="rounded-xl bg-slate-50 p-3">
              <dt class="text-xs uppercase tracking-wide text-slate-500">Forecast horizon</dt>
              <dd class="mt-1 font-medium text-slate-900">{{ run.horizon }} months</dd>
            </div>
            <div class="rounded-xl bg-slate-50 p-3">
              <dt class="text-xs uppercase tracking-wide text-slate-500">Anomaly method</dt>
              <dd class="mt-1 font-medium text-slate-900">{{ run.anomaly_method }}</dd>
            </div>
            <div class="rounded-xl bg-slate-50 p-3">
              <dt class="text-xs uppercase tracking-wide text-slate-500">Started</dt>
              <dd class="mt-1 font-medium text-slate-900">
                {{ dateTime(run.started_at || run.created_at) }}
              </dd>
            </div>
          </dl>
        </section>

        @if (run.status === 'failed') {
          <section class="mt-6 rounded-2xl border border-red-200 bg-red-50 p-6">
            <h2 class="text-sm font-semibold text-red-900">This run failed</h2>
            <p class="mt-1 text-sm text-red-800">
              {{ run.error_message || 'The forecast could not be evaluated.' }}
            </p>
          </section>
        } @else if (run.status === 'queued' || run.status === 'running') {
          <section class="mt-6 rounded-2xl border border-sky-200 bg-sky-50 p-6">
            <h2 class="text-sm font-semibold text-sky-900">
              {{ run.status === 'queued' ? 'Forecast queued' : 'Forecast running' }}
            </h2>
            <p class="mt-1 text-sm text-sky-800">
              {{ run.history.length }} monthly periods were captured for this run. Results will
              appear here automatically.
            </p>
          </section>
        } @else {
          @if (run.metrics; as metrics) {
            <section class="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <article class="rounded-2xl border border-slate-200 bg-white p-5">
                <p class="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Model test MAE
                </p>
                <p class="mt-2 text-2xl font-semibold text-slate-900">
                  {{ money(metrics.model.mae) }}
                </p>
                <p class="mt-1 text-xs text-slate-500">
                  Baseline {{ money(metrics.baseline.mae) }}
                </p>
              </article>
              <article class="rounded-2xl border border-slate-200 bg-white p-5">
                <p class="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Model test RMSE
                </p>
                <p class="mt-2 text-2xl font-semibold text-slate-900">
                  {{ money(metrics.model.rmse) }}
                </p>
                <p class="mt-1 text-xs text-slate-500">
                  Baseline {{ money(metrics.baseline.rmse) }}
                </p>
              </article>
              <article class="rounded-2xl border border-slate-200 bg-white p-5">
                <p class="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Improvement vs baseline
                </p>
                <p class="mt-2 text-2xl font-semibold text-slate-900">
                  {{ improvement(metrics.improvement_percent) }}
                </p>
                <p class="mt-1 text-xs text-slate-500">
                  RMSE reduction on the test window; negative means the baseline won.
                </p>
              </article>
              <article class="rounded-2xl border border-slate-200 bg-white p-5">
                <p class="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Anomalies in history
                </p>
                <p
                  class="mt-2 text-2xl font-semibold"
                  [class]="run.anomaly_count ? 'text-amber-700' : 'text-slate-900'"
                >
                  {{ run.anomaly_count }}
                </p>
                <p class="mt-1 text-xs text-slate-500">
                  {{ metrics.split.training_periods }} train ·
                  {{ metrics.split.validation_periods }} validate ·
                  {{ metrics.split.test_periods }} test
                </p>
              </article>
            </section>

            <section class="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 class="text-sm font-semibold text-slate-900">Observed and forecast</h2>
                  <p class="mt-1 text-sm text-slate-600">
                    Net sales per month with the forecast and its 95% interval.
                  </p>
                </div>
                <ul class="flex flex-wrap gap-4 text-xs text-slate-600">
                  <li class="flex items-center gap-2">
                    <span class="inline-block h-0.5 w-5 bg-slate-600"></span> Observed
                  </li>
                  <li class="flex items-center gap-2">
                    <span
                      class="inline-block h-0.5 w-5 border-t-2 border-dashed border-teal-700"
                    ></span>
                    Forecast
                  </li>
                  <li class="flex items-center gap-2">
                    <span class="inline-block h-3 w-5 bg-teal-100"></span> 95% interval
                  </li>
                </ul>
              </div>

              @if (chart(); as view) {
                <svg
                  [attr.viewBox]="'0 0 ' + view.width + ' ' + view.height"
                  class="mt-4 h-72 w-full"
                  role="img"
                  aria-label="Observed monthly net sales and the forecast with its interval"
                >
                  @for (tick of view.ticks; track $index) {
                    <line
                      [attr.x1]="view.left"
                      [attr.x2]="view.right"
                      [attr.y1]="tick.y"
                      [attr.y2]="tick.y"
                      stroke="#e2e8f0"
                      stroke-dasharray="4 4"
                    />
                    <text
                      [attr.x]="view.left - 8"
                      [attr.y]="tick.y + 4"
                      text-anchor="end"
                      fill="#94a3b8"
                      font-size="10"
                    >
                      {{ tick.label }}
                    </text>
                  }
                  @if (view.band) {
                    <path [attr.d]="view.band" fill="#99f6e4" fill-opacity="0.4" stroke="none" />
                  }
                  @if (view.historyLine) {
                    <path
                      [attr.d]="view.historyLine"
                      fill="none"
                      stroke="#475569"
                      stroke-width="2"
                    />
                  }
                  @if (view.forecastLine) {
                    <path
                      [attr.d]="view.forecastLine"
                      fill="none"
                      stroke="#0f766e"
                      stroke-width="2"
                      stroke-dasharray="6 4"
                    />
                  }
                  @for (point of view.historyPoints; track $index) {
                    <circle [attr.cx]="point.x" [attr.cy]="point.y" r="2.5" fill="#475569" />
                  }
                  @for (point of view.forecastPoints; track $index) {
                    <circle [attr.cx]="point.x" [attr.cy]="point.y" r="2.5" fill="#0f766e" />
                  }
                  @for (label of view.labels; track $index) {
                    <text
                      [attr.x]="label.x"
                      [attr.y]="label.y"
                      [attr.text-anchor]="label.anchor"
                      fill="#94a3b8"
                      font-size="10"
                    >
                      {{ label.text }}
                    </text>
                  }
                </svg>
              } @else {
                <p class="mt-4 text-sm text-slate-500">No chart data for this run.</p>
              }
            </section>

            <section class="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
              <h2 class="text-sm font-semibold text-slate-900">Forecast by month</h2>
              <p class="mt-1 text-sm text-slate-600">
                Predicted net sales with the 95% interval ({{ metrics.interval }}).
              </p>
              <div class="mt-4 overflow-x-auto">
                <table class="w-full text-left text-sm">
                  <thead class="text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th class="py-2 pr-4 font-medium">Month</th>
                      <th class="py-2 pr-4 text-right font-medium">Forecast</th>
                      <th class="py-2 pr-4 text-right font-medium">Lower</th>
                      <th class="py-2 text-right font-medium">Upper</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    @for (point of run.points; track point.target_date) {
                      <tr>
                        <td class="py-2 pr-4 font-medium text-slate-900">
                          {{ month(point.target_date) }}
                        </td>
                        <td class="py-2 pr-4 text-right text-slate-900">
                          {{ money(point.predicted_amount) }}
                        </td>
                        <td class="py-2 pr-4 text-right text-slate-600">
                          {{ money(point.lower_bound) }}
                        </td>
                        <td class="py-2 text-right text-slate-600">
                          {{ money(point.upper_bound) }}
                        </td>
                      </tr>
                    } @empty {
                      <tr>
                        <td colspan="4" class="py-3 text-sm text-slate-500">
                          No forecast points were stored for this run.
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </section>

            <section class="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
              <h2 class="text-sm font-semibold text-slate-900">Anomalies in observed history</h2>
              <p class="mt-1 max-w-2xl text-sm text-slate-600">
                Months whose net sales fall outside the Tukey fences (or the mean ± 3σ fallback when
                the interquartile range collapses). The expected value is the median of the history.
              </p>
              @if (!run.anomalies.length) {
                <p class="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  No anomalies were detected in this history window.
                </p>
              } @else {
                <div class="mt-4 overflow-x-auto">
                  <table class="w-full text-left text-sm">
                    <thead class="text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th class="py-2 pr-4 font-medium">Month</th>
                        <th class="py-2 pr-4 text-right font-medium">Observed</th>
                        <th class="py-2 pr-4 text-right font-medium">Expected</th>
                        <th class="py-2 pr-4 text-right font-medium">Deviation</th>
                        <th class="py-2 pr-4 text-right font-medium">Score</th>
                        <th class="py-2 pr-4 font-medium">Direction</th>
                        <th class="py-2 font-medium">Triage</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                      @for (anomaly of run.anomalies; track anomaly.observed_date) {
                        <tr>
                          <td class="py-2 pr-4 font-medium text-slate-900">
                            {{ month(anomaly.observed_date) }}
                          </td>
                          <td class="py-2 pr-4 text-right text-slate-900">
                            {{ money(anomaly.observed_amount) }}
                          </td>
                          <td class="py-2 pr-4 text-right text-slate-600">
                            {{ money(anomaly.expected_amount) }}
                          </td>
                          <td
                            class="py-2 pr-4 text-right font-medium"
                            [class]="
                              anomaly.direction === 'above' ? 'text-teal-700' : 'text-amber-700'
                            "
                          >
                            {{ signedMoney(anomaly.deviation_amount) }}
                          </td>
                          <td class="py-2 pr-4 text-right text-slate-600">
                            {{ number(anomaly.score) }}
                          </td>
                          <td class="py-2 pr-4">
                            <span
                              class="rounded-full px-2 py-1 text-xs font-medium"
                              [class]="
                                anomaly.direction === 'above'
                                  ? 'bg-teal-50 text-teal-800'
                                  : 'bg-amber-50 text-amber-800'
                              "
                            >
                              {{
                                anomaly.direction === 'above' ? 'Above expected' : 'Below expected'
                              }}
                            </span>
                          </td>
                          <td class="py-2 align-top">
                            <input
                              type="text"
                              maxlength="255"
                              placeholder="Why? e.g. Black Friday"
                              [value]="noteFor(anomaly)"
                              (input)="noteChanged(anomaly.id, $event)"
                              (change)="saveAnomalyNote(anomaly)"
                              class="w-48 rounded-lg border border-slate-300 px-2 py-1 text-xs"
                            />
                            <div class="mt-1 flex items-center gap-2 text-[11px]">
                              @if (anomaly.acknowledged_at) {
                                <span class="text-teal-700">Acknowledged</span>
                                <button
                                  type="button"
                                  class="text-slate-500 hover:text-slate-900"
                                  (click)="toggleAnomalyAck(anomaly, false)"
                                >
                                  Undo
                                </button>
                              } @else {
                                <button
                                  type="button"
                                  class="font-semibold text-sky-700 hover:underline"
                                  (click)="toggleAnomalyAck(anomaly, true)"
                                >
                                  Acknowledge
                                </button>
                              }
                            </div>
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
            </section>

            <section class="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
              <h2 class="text-sm font-semibold text-slate-900">Evaluation detail</h2>
              <dl class="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt class="text-xs uppercase tracking-wide text-slate-500">Model</dt>
                  <dd class="mt-1 text-slate-900">
                    {{ metrics.model.name }} {{ metrics.model.version }} · α
                    {{ number(metrics.alpha) }}, β {{ number(metrics.beta) }}
                  </dd>
                </div>
                <div>
                  <dt class="text-xs uppercase tracking-wide text-slate-500">Baseline</dt>
                  <dd class="mt-1 text-slate-900">
                    {{ metrics.baseline.name }} {{ metrics.baseline.version }}
                  </dd>
                </div>
                <div>
                  <dt class="text-xs uppercase tracking-wide text-slate-500">
                    Chronological split
                  </dt>
                  <dd class="mt-1 text-slate-900">
                    {{ metrics.split.training_periods }} training,
                    {{ metrics.split.validation_periods }} validation,
                    {{ metrics.split.test_periods }} test
                  </dd>
                </div>
                <div>
                  <dt class="text-xs uppercase tracking-wide text-slate-500">Interval</dt>
                  <dd class="mt-1 text-slate-900">{{ metrics.interval }}</dd>
                </div>
                <div>
                  <dt class="text-xs uppercase tracking-wide text-slate-500">Minimum history</dt>
                  <dd class="mt-1 text-slate-900">
                    {{ metrics.minimum_history_months }} monthly periods
                  </dd>
                </div>
                <div>
                  <dt class="text-xs uppercase tracking-wide text-slate-500">Finished</dt>
                  <dd class="mt-1 text-slate-900">{{ dateTime(run.finished_at) }}</dd>
                </div>
              </dl>
              <p class="mt-4 text-xs text-slate-500">
                Accuracy is measured only on the hold-out test months. Forecasts extend the learned
                level and trend; they do not model promotions, stock-outs or seasonality beyond the
                baseline comparison.
              </p>
            </section>
          }
        }
      }
    }
  `,
})
export class Forecasting implements OnDestroy {
  private readonly forecastingApi = inject(ForecastingService);
  private readonly datasetsApi = inject(DatasetsService);
  readonly auth = inject(AuthService);

  readonly horizons = HORIZONS;
  readonly availableDatasets = signal<DatasetSummary[]>([]);
  readonly datasetId = signal('');
  readonly horizon = signal<number>(3);

  readonly runs = signal<ForecastRun[]>([]);
  readonly selectedRunId = signal('');
  readonly detail = signal<ForecastRunDetail | null>(null);

  readonly loadingRuns = signal(true);
  readonly loadingDetail = signal(false);
  readonly creating = signal(false);
  readonly error = signal<string | null>(null);
  readonly detailError = signal<string | null>(null);
  readonly anomalyNotes = signal<Record<string, string>>({});

  readonly canRun = computed(() => {
    const role = this.auth.activeOrganisation()?.role;
    return role === 'owner' || role === 'admin' || role === 'analyst';
  });
  readonly selectedRun = computed(
    () => this.runs().find((run) => run.id === this.selectedRunId()) ?? null,
  );
  readonly currency = computed(() => this.auth.activeOrganisation()?.currency ?? 'GBP');
  readonly chart = computed<ForecastChart | null>(() => {
    const run = this.detail();
    if (!run || !run.history.length) {
      return null;
    }
    return buildForecastChart(run.history, run.points, this.currency());
  });

  private runRequest = 0;
  private detailRequest = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastOrganisationId: string | null = null;

  constructor() {
    effect(() => {
      const organisationId = this.auth.activeOrganisation()?.id ?? null;
      if (organisationId === this.lastOrganisationId) {
        return;
      }
      this.lastOrganisationId = organisationId;
      if (organisationId === null) {
        return;
      }
      this.stopPolling();
      this.datasetId.set('');
      this.horizon.set(3);
      this.runs.set([]);
      this.selectedRunId.set('');
      this.detail.set(null);
      this.error.set(null);
      this.detailError.set(null);
      void this.loadDatasets();
      void this.loadRuns();
    });
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  readValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  datasetChanged(event: Event): void {
    this.datasetId.set(this.readValue(event));
    this.selectedRunId.set('');
    this.detail.set(null);
    this.detailError.set(null);
    this.stopPolling();
    void this.loadRuns();
  }

  horizonChanged(event: Event): void {
    this.horizon.set(Number(this.readValue(event)));
  }

  runChanged(event: Event): void {
    const id = this.readValue(event);
    this.selectedRunId.set(id);
    if (id) {
      void this.loadDetail(id);
    }
  }

  statusLabel(status: ForecastStatus): string {
    switch (status) {
      case 'queued':
        return 'Queued';
      case 'running':
        return 'Running';
      case 'succeeded':
        return 'Completed';
      default:
        return 'Failed';
    }
  }

  statusClass(status: ForecastStatus): string {
    const base = 'rounded-full px-3 py-1 text-xs font-medium ';
    switch (status) {
      case 'succeeded':
        return `${base}bg-teal-50 text-teal-800`;
      case 'queued':
      case 'running':
        return `${base}bg-sky-50 text-sky-800`;
      default:
        return `${base}bg-red-50 text-red-800`;
    }
  }

  runLabel(run: ForecastRun): string {
    const dataset = run.dataset?.name || 'All processed data';
    return `${this.dateTime(run.created_at)} · ${dataset} · ${run.horizon}m · ${this.statusLabel(run.status)}`;
  }

  trainingRange(run: ForecastRun): string {
    if (!run.training_start) {
      return '—';
    }
    return `${this.month(run.training_start)} – ${this.month(run.training_end)}`;
  }

  month(value: string | null): string {
    if (!value) {
      return '—';
    }
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  }

  dateTime(value: string | null): string {
    if (!value) {
      return '—';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  money(value: string | number | null): string {
    return formatMoney(value === null ? null : String(value), this.currency());
  }

  signedMoney(value: string | null): string {
    if (value === null) {
      return '—';
    }
    const amount = Number(value);
    if (!Number.isFinite(amount)) {
      return value;
    }
    return `${amount < 0 ? '−' : '+'}${formatMoney(String(Math.abs(amount)), this.currency())}`;
  }

  improvement(value: number | null): string {
    if (value === null || !Number.isFinite(value)) {
      return '—';
    }
    const prefix = value > 0 ? '+' : '';
    return `${prefix}${formatPercent(String(value), 1)}`;
  }

  number(value: number | string): string {
    const amount = Number(value);
    if (!Number.isFinite(amount)) {
      return String(value);
    }
    return amount.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  }

  noteFor(anomaly: ForecastAnomaly): string {
    return this.anomalyNotes()[anomaly.id] ?? anomaly.note ?? '';
  }

  noteChanged(anomalyId: string, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.anomalyNotes.update((notes) => ({ ...notes, [anomalyId]: value }));
  }

  async saveAnomalyNote(anomaly: ForecastAnomaly): Promise<void> {
    const run = this.detail();
    if (!run) {
      return;
    }
    const note = this.anomalyNotes()[anomaly.id] ?? anomaly.note ?? '';
    if (note === (anomaly.note ?? '')) {
      return;
    }
    await this.patchAnomaly(run.id, anomaly.id, { note });
  }

  async toggleAnomalyAck(anomaly: ForecastAnomaly, acknowledged: boolean): Promise<void> {
    const run = this.detail();
    if (!run) {
      return;
    }
    await this.patchAnomaly(run.id, anomaly.id, { acknowledged });
  }

  private async patchAnomaly(
    runId: string,
    anomalyId: string,
    change: { note?: string; acknowledged?: boolean },
  ): Promise<void> {
    this.detailError.set(null);
    try {
      const updated = await this.forecastingApi.triageAnomaly(runId, anomalyId, change);
      this.detail.update((detail) =>
        detail
          ? {
              ...detail,
              anomalies: detail.anomalies.map((item) =>
                item.id === anomalyId
                  ? { ...item, note: updated.note, acknowledged_at: updated.acknowledged_at }
                  : item,
              ),
            }
          : detail,
      );
      this.anomalyNotes.update((notes) => {
        const next = { ...notes };
        delete next[anomalyId];
        return next;
      });
    } catch (error) {
      this.detailError.set(apiErrorMessage(error, 'The anomaly could not be updated.'));
    }
  }

  async runForecast(): Promise<void> {
    this.creating.set(true);
    this.error.set(null);
    this.detailError.set(null);
    try {
      const run = await this.forecastingApi.create(this.datasetId() || null, this.horizon());
      this.runs.update((runs) => [run, ...runs.filter((item) => item.id !== run.id)]);
      this.selectedRunId.set(run.id);
      this.detail.set(null);
      await this.loadDetail(run.id);
      this.startPolling();
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'The forecast could not be started.'));
    } finally {
      this.creating.set(false);
    }
  }

  private async loadDatasets(): Promise<void> {
    try {
      const datasets = await this.datasetsApi.list();
      this.availableDatasets.set(datasets.filter((dataset) => dataset.status === 'ready'));
    } catch {
      // The filter stays on all processed data; runs still load.
    }
  }

  private async loadRuns(): Promise<void> {
    const request = ++this.runRequest;
    this.loadingRuns.set(true);
    this.error.set(null);
    try {
      const runs = await this.forecastingApi.list(this.datasetId() || undefined);
      if (request !== this.runRequest) {
        return;
      }
      this.runs.set(runs);
      const active = runs.find((run) => run.status === 'queued' || run.status === 'running');
      const next = active ?? runs[0] ?? null;
      if (next === null) {
        this.selectedRunId.set('');
        this.detail.set(null);
        return;
      }
      this.selectedRunId.set(next.id);
      await this.loadDetail(next.id);
    } catch (error) {
      if (request === this.runRequest) {
        this.runs.set([]);
        this.detail.set(null);
        this.error.set(apiErrorMessage(error, 'Forecast runs could not be loaded.'));
      }
    } finally {
      if (request === this.runRequest) {
        this.loadingRuns.set(false);
      }
    }
  }

  private async refreshRuns(): Promise<void> {
    try {
      const runs = await this.forecastingApi.list(this.datasetId() || undefined);
      this.runs.set(runs);
      const current = runs.find((run) => run.id === this.selectedRunId());
      if (current) {
        this.detail.update((detail) =>
          detail && detail.id === current.id
            ? {
                ...detail,
                ...current,
                history: detail.history,
                points: detail.points,
                anomalies: detail.anomalies,
              }
            : detail,
        );
      }
    } catch {
      // The detail view remains authoritative; the next poll retries.
    }
  }

  private async loadDetail(runId: string): Promise<void> {
    const request = ++this.detailRequest;
    this.loadingDetail.set(true);
    this.detailError.set(null);
    try {
      const detail = await this.forecastingApi.get(runId);
      if (request !== this.detailRequest || runId !== this.selectedRunId()) {
        return;
      }
      this.detail.set(detail);
      if (detail.status === 'queued' || detail.status === 'running') {
        this.startPolling();
      } else {
        this.stopPolling();
      }
    } catch (error) {
      if (request === this.detailRequest) {
        this.detail.set(null);
        this.detailError.set(apiErrorMessage(error, 'This forecast run could not be loaded.'));
        this.stopPolling();
      }
    } finally {
      if (request === this.detailRequest) {
        this.loadingDetail.set(false);
      }
    }
  }

  private startPolling(): void {
    if (this.pollTimer) {
      return;
    }
    this.pollTimer = setInterval(() => {
      void this.poll();
    }, 2000);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async poll(): Promise<void> {
    const runId = this.selectedRunId();
    if (!runId) {
      this.stopPolling();
      return;
    }
    try {
      const detail = await this.forecastingApi.get(runId);
      if (runId !== this.selectedRunId()) {
        return;
      }
      this.detail.set(detail);
      if (detail.status === 'queued' || detail.status === 'running') {
        return;
      }
      this.stopPolling();
      await this.refreshRuns();
    } catch {
      this.stopPolling();
      this.detailError.set('The forecast status could not be refreshed.');
    }
  }
}

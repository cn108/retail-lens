import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import {
  AnalyticsService,
  Granularity,
  SalesSummary,
  SalesTrend,
} from '../../core/api/analytics.service';
import { apiErrorMessage } from '../../core/api/api-error';
import { DatasetSummary, DatasetsService } from '../../core/api/datasets.service';
import { AnalysisScopeService } from '../../core/analysis/analysis-scope.service';
import { AuthService } from '../../core/auth/auth.service';
import {
  formatDate as formatCalendarDate,
  formatMoney as formatCurrency,
} from '../../core/formatting';
import { AnalysisFilterBar } from '../../shared/analysis-filter-bar';
import { LoadingState } from '../../shared/loading-state';
import { MetricInfo } from '../../shared/metric-info';
import { ReportViewActions } from '../../shared/report-view-actions';
import { buildTrendChart } from './trend-chart';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, AnalysisFilterBar, LoadingState, MetricInfo, ReportViewActions],
  template: `
    <header class="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p
          class="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-sky-700"
        >
          <span class="h-1.5 w-1.5 rounded-full bg-sky-500"></span>
          Analytics overview
        </p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
          {{ auth.activeOrganisation()?.name ?? 'RetailLens' }}
        </h1>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          Explore sales performance from your processed warehouse. Metrics are calculated from
          loaded fact lines, not estimates.
        </p>
      </div>
      @if (summary(); as data) {
        @if (data.has_data) {
          <div class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-right shadow-sm">
            <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              Reporting period
            </p>
            <p class="mt-1 text-sm font-semibold text-slate-800">
              {{ formatDate(data.date_from) }} – {{ formatDate(data.date_to) }}
            </p>
            <p class="mt-1 text-xs text-slate-500">
              Compared with {{ formatDate(data.comparison_date_from) }} –
              {{ formatDate(data.comparison_date_to) }}
            </p>
          </div>
        }
      }
    </header>

    <app-analysis-filter-bar [datasets]="availableDatasets()" [loading]="loading()" />

    <div class="mt-3 flex justify-end">
      <app-report-view-actions
        kind="sales"
        label="Sales performance"
        [datasets]="availableDatasets()"
      />
    </div>

    @if (onboarding().show) {
      <section class="mt-6 rounded-2xl border border-teal-200 bg-teal-50/50 p-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-sm font-semibold text-slate-900">Get your first insight</h2>
            <p class="mt-1 max-w-2xl text-sm text-slate-600">
              Upload a transaction export, map its columns and process it. The dashboard reads only
              the processed warehouse, so these steps are required before figures appear.
            </p>
          </div>
          <a
            href="/sample-transactions.csv"
            download
            class="text-sm font-medium text-teal-700 hover:underline"
          >
            Download sample CSV
          </a>
        </div>
        <ol class="mt-4 grid gap-2 text-sm sm:grid-cols-4">
          <li class="flex items-center gap-2 rounded-lg bg-white px-3 py-2">
            <span [class]="stepClass(onboarding().uploaded)">1</span>
            Upload a CSV
          </li>
          <li class="flex items-center gap-2 rounded-lg bg-white px-3 py-2">
            <span [class]="stepClass(onboarding().mapped)">2</span>
            Map columns
          </li>
          <li class="flex items-center gap-2 rounded-lg bg-white px-3 py-2">
            <span [class]="stepClass(onboarding().processed)">3</span>
            Process the dataset
          </li>
          <li class="flex items-center gap-2 rounded-lg bg-white px-3 py-2">
            <span [class]="stepClass(onboarding().processed)">4</span>
            Explore insights
          </li>
        </ol>
        <a
          routerLink="/datasets"
          class="mt-3 inline-block text-sm font-medium text-teal-700 hover:underline"
        >
          {{ onboarding().uploaded ? 'Continue in Datasets' : 'Start in Datasets' }} →
        </a>
      </section>
    }

    @if (error(); as message) {
      <div
        role="alert"
        class="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900"
      >
        <span>{{ message }}</span>
        <button type="button" class="font-semibold underline" (click)="load()">Retry</button>
      </div>
    }

    @if (loading()) {
      <app-loading-state label="Loading warehouse metrics" />
    } @else if (summary(); as data) {
      @if (!data.has_data) {
        <section
          class="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"
        >
          <h2 class="text-lg font-semibold text-slate-900">
            {{ data.date_from === null ? 'No processed data yet' : 'No sales in this range' }}
          </h2>
          <p class="mx-auto mt-2 max-w-xl text-sm text-slate-600">
            @if (data.date_from === null) {
              Upload a transaction CSV, map its columns and process it. The dashboard reads only the
              warehouse that processing produces.
            } @else {
              Widen the dates or clear the filters. Returns alone appear in net sales but do not
              create an order.
            }
          </p>
          <a
            routerLink="/datasets"
            class="mt-4 inline-block rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Go to datasets
          </a>
        </section>
      } @else {
        <section class="mt-7">
          <div class="mb-3 flex items-center justify-between gap-3">
            <div>
              <p class="text-sm font-semibold text-slate-900">Performance at a glance</p>
              <p class="mt-0.5 text-xs text-slate-500">
                Key measures for the selected reporting scope
              </p>
            </div>
            <span
              class="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500"
              >Live warehouse data</span
            >
          </div>
          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <article
              class="rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50 to-white p-5 shadow-sm xl:col-span-2"
            >
              <div class="flex items-start justify-between gap-2">
                <p class="text-xs font-medium uppercase tracking-wide text-slate-500">
                  <app-metric-info
                    label="Net sales"
                    definition="Sales after discounts plus returns. The comparison uses the immediately preceding period of equal length."
                  />
                </p>
                @if (data.sales_growth_percent; as growth) {
                  <span
                    class="rounded-full px-2 py-1 text-xs font-medium"
                    [class]="
                      growth.startsWith('-')
                        ? 'bg-amber-50 text-amber-800'
                        : 'bg-teal-50 text-teal-800'
                    "
                  >
                    {{ formatPercent(growth) }}
                  </span>
                } @else {
                  <span
                    class="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500"
                  >
                    No prior period
                  </span>
                }
              </div>
              <p class="mt-2 text-3xl font-semibold text-slate-900">
                {{ formatMoney(data.net_sales) }}
              </p>
              <p class="mt-1 text-xs text-slate-500">
                After discounts and returns · {{ formatMoney(data.previous_net_sales) }} previous
                period
              </p>
            </article>

            <article
              class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
            >
              <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Gross sales</p>
              <p class="mt-2 text-xl font-semibold text-slate-900">
                {{ formatMoney(data.gross_sales) }}
              </p>
              <p class="mt-1 text-xs text-slate-500">Before discounts</p>
            </article>
            <article
              class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
            >
              <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Orders</p>
              <p class="mt-2 text-xl font-semibold text-slate-900">{{ data.eligible_orders }}</p>
              <p class="mt-1 text-xs text-slate-500">Distinct invoices with a sale</p>
            </article>
            <article
              class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
            >
              <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Avg. order</p>
              <p class="mt-2 text-xl font-semibold text-slate-900">
                {{ data.average_order_value ? formatMoney(data.average_order_value) : '—' }}
              </p>
              <p class="mt-1 text-xs text-slate-500">Net ÷ orders</p>
            </article>
            <article
              class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
            >
              <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Customers</p>
              <p class="mt-2 text-xl font-semibold text-slate-900">{{ data.unique_customers }}</p>
              <p class="mt-1 text-xs text-slate-500">Anonymous lines excluded</p>
            </article>
          </div>
        </section>

        <section class="mt-6 grid gap-4 xl:grid-cols-3">
          <div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm xl:col-span-2">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 class="text-sm font-semibold text-slate-900">Net sales trend</h2>
                <p class="mt-1 text-sm text-slate-600">
                  Returns are counted in the period they occur; orders count distinct invoices.
                </p>
              </div>
              <div class="flex gap-1 rounded-lg bg-slate-100 p-1">
                @for (option of granularities; track option) {
                  <button
                    type="button"
                    class="rounded-md px-3 py-1 text-xs font-medium capitalize"
                    [class]="
                      granularity() === option
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    "
                    (click)="chooseGranularity(option)"
                  >
                    {{ option }}
                  </button>
                }
              </div>
            </div>

            @if (trend(); as series) {
              @if (series.points.length) {
                <svg
                  [attr.viewBox]="'0 0 ' + chart().width + ' ' + chart().height"
                  class="mt-4 h-64 w-full"
                  role="img"
                  [attr.aria-label]="chartLabel()"
                >
                  @for (tick of chart().ticks; track tick.value) {
                    <line
                      [attr.x1]="chart().left"
                      [attr.x2]="chart().right"
                      [attr.y1]="tick.y"
                      [attr.y2]="tick.y"
                      [attr.stroke]="tick.value === 0 ? '#94a3b8' : '#e2e8f0'"
                      [attr.stroke-dasharray]="tick.value === 0 ? null : '4 4'"
                    />
                    <text
                      [attr.x]="chart().left - 8"
                      [attr.y]="tick.y + 4"
                      text-anchor="end"
                      fill="#64748b"
                      font-size="10"
                    >
                      {{ tick.label }}
                    </text>
                  }
                  @if (chart().area) {
                    <path [attr.d]="chart().area" fill="#0ea5e9" fill-opacity="0.12" />
                  }
                  @if (chart().line) {
                    <path
                      [attr.d]="chart().line"
                      fill="none"
                      stroke="#0284c7"
                      stroke-width="2"
                      stroke-linejoin="round"
                      stroke-linecap="round"
                    />
                  }
                  @for (point of chart().points; track point.label) {
                    <circle [attr.cx]="point.x" [attr.cy]="point.y" r="3" fill="#0284c7">
                      <title>{{ point.label }}: {{ formatMoney(point.value.toFixed(4)) }}</title>
                    </circle>
                  }
                  @for (label of chart().labels; track label.text) {
                    <text
                      [attr.x]="label.x"
                      [attr.y]="label.y"
                      [attr.text-anchor]="label.anchor"
                      fill="#64748b"
                      font-size="10"
                    >
                      {{ label.text }}
                    </text>
                  }
                </svg>

                <table class="sr-only">
                  <caption>
                    Net sales trend by
                    {{
                      series.granularity
                    }}
                  </caption>
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th>Net sales</th>
                      <th>Orders</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (point of series.points; track point.period_start) {
                      <tr>
                        <td>{{ point.label }}</td>
                        <td>{{ formatMoney(point.net_sales) }}</td>
                        <td>{{ point.orders }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              } @else {
                <p class="mt-6 text-sm text-slate-500">No periods in this range.</p>
              }
            }
          </div>

          <aside class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 class="text-sm font-semibold text-slate-900">Coverage</h2>
            <p class="mt-1 text-sm text-slate-600">
              {{ data.datasets.length }}
              {{ data.datasets.length === 1 ? 'dataset' : 'datasets' }} contributed in this period.
            </p>
            <ul class="mt-4 divide-y divide-slate-100">
              @for (dataset of data.datasets; track dataset.id) {
                <li class="py-2">
                  <a
                    [routerLink]="['/datasets', dataset.id]"
                    class="text-sm font-medium text-teal-700 hover:underline"
                  >
                    {{ dataset.name }}
                  </a>
                </li>
              }
            </ul>
            <p class="mt-4 text-xs text-slate-500">
              Only processed datasets contribute. Rejected source rows stay in the dataset's quality
              report and never become facts.
            </p>
            <a
              routerLink="/sales"
              class="mt-4 inline-block text-sm font-medium text-teal-700 hover:underline"
            >
              Open sales detail →
            </a>
          </aside>
        </section>
      }
    }

    <section class="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-sm font-semibold text-slate-900">Data confidence</h2>
          <p class="mt-1 text-sm text-slate-600">
            What is loaded, when it was processed, and whether any source rows were rejected.
          </p>
        </div>
        <a routerLink="/datasets" class="text-sm font-medium text-teal-700 hover:underline">
          Review datasets →
        </a>
      </div>

      <dl class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div class="rounded-lg border border-slate-100 bg-slate-50 p-3">
          <dt class="text-xs uppercase tracking-wide text-slate-500">Data through</dt>
          <dd class="mt-1 font-medium text-slate-900">
            {{ dataThrough() ? formatDate(dataThrough()) : 'No processed data' }}
          </dd>
        </div>
        <div class="rounded-lg border border-slate-100 bg-slate-50 p-3">
          <dt class="text-xs uppercase tracking-wide text-slate-500">Last processed</dt>
          <dd class="mt-1 font-medium text-slate-900">
            {{ confidence().lastProcessedAt ? formatDateTime(confidence().lastProcessedAt) : '—' }}
          </dd>
        </div>
        <div class="rounded-lg border border-slate-100 bg-slate-50 p-3">
          <dt class="text-xs uppercase tracking-wide text-slate-500">Source rows rejected</dt>
          <dd
            class="mt-1 font-medium"
            [class]="confidence().rejected ? 'text-amber-700' : 'text-slate-900'"
          >
            {{ confidence().rejected }}
          </dd>
        </div>
        <div class="rounded-lg border border-slate-100 bg-slate-50 p-3">
          <dt class="text-xs uppercase tracking-wide text-slate-500">Open quality issues</dt>
          <dd
            class="mt-1 font-medium"
            [class]="confidence().issues ? 'text-amber-700' : 'text-slate-900'"
          >
            {{ confidence().issues }}
          </dd>
        </div>
      </dl>
      <p class="mt-3 text-xs text-slate-500">
        {{ confidence().readyCount }} of {{ confidence().datasetCount }} datasets are processed.
        Rejected rows stay in the dataset quality report and never become facts.
      </p>
    </section>
  `,
})
export class Dashboard {
  private readonly analytics = inject(AnalyticsService);
  private readonly datasetsApi = inject(DatasetsService);
  readonly auth = inject(AuthService);
  readonly scope = inject(AnalysisScopeService);

  readonly summary = signal<SalesSummary | null>(null);
  readonly trend = signal<SalesTrend | null>(null);
  readonly allDatasets = signal<DatasetSummary[]>([]);
  readonly granularity = signal<Granularity>('month');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly availableDatasets = computed(() =>
    this.allDatasets().filter(
      (dataset) => dataset.status === 'ready' || dataset.status === 'failed',
    ),
  );
  readonly confidence = computed(() => {
    const datasets = this.allDatasets();
    const ready = datasets.filter((dataset) => dataset.status === 'ready');
    const timestamps = ready
      .map((dataset) => dataset.last_processed_at)
      .filter((value): value is string => Boolean(value))
      .sort();
    return {
      datasetCount: datasets.length,
      readyCount: ready.length,
      rejected: ready.reduce((total, dataset) => total + dataset.rows_rejected, 0),
      issues: ready.reduce((total, dataset) => total + dataset.quality_issue_count, 0),
      lastProcessedAt: timestamps.length ? timestamps[timestamps.length - 1] : null,
    };
  });
  readonly onboarding = computed(() => {
    const datasets = this.allDatasets();
    const uploaded = datasets.length > 0;
    const mapped = datasets.some((dataset) => dataset.status !== 'draft');
    const processed = datasets.some((dataset) => dataset.status === 'ready');
    return { show: !processed, uploaded, mapped, processed };
  });
  readonly dataThrough = computed(() => {
    const summary = this.summary();
    return summary?.has_data ? summary.date_to : null;
  });

  readonly granularities: Granularity[] = ['day', 'week', 'month'];
  readonly chart = computed(() =>
    buildTrendChart(this.trend()?.points ?? [], this.auth.activeOrganisation()?.currency ?? 'GBP'),
  );
  readonly chartLabel = computed(() => {
    const points = this.trend()?.points ?? [];
    if (!points.length) {
      return 'No net sales trend data.';
    }
    return `Net sales from ${points[0].label} to ${points[points.length - 1].label}, across ${points.length} periods.`;
  });

  private requestId = 0;
  private lastScopeKey = '';
  private lastDatasetOrganisationId: string | null = null;

  constructor() {
    effect(() => {
      const organisationId = this.auth.activeOrganisation()?.id ?? null;
      if (!organisationId) {
        return;
      }
      this.scope.ensureFor(organisationId);
      const key = `${organisationId}:${this.scope.revision()}`;
      if (this.lastDatasetOrganisationId !== organisationId) {
        this.lastDatasetOrganisationId = organisationId;
        void this.loadDatasets();
      }
      if (key === this.lastScopeKey) {
        return;
      }
      this.lastScopeKey = key;
      void this.load();
    });
  }

  chooseGranularity(granularity: Granularity): void {
    if (this.granularity() === granularity) {
      return;
    }
    this.granularity.set(granularity);
    void this.load();
  }

  async load(): Promise<void> {
    const request = ++this.requestId;
    this.loading.set(true);
    this.error.set(null);
    const query = this.scope.query();

    try {
      const [summary, trend] = await Promise.all([
        this.analytics.summary(query),
        this.analytics.trend({ ...query, granularity: this.granularity() }),
      ]);
      if (request === this.requestId) {
        this.summary.set(summary);
        this.trend.set(trend);
      }
    } catch (error) {
      if (request === this.requestId) {
        this.summary.set(null);
        this.trend.set(null);
        this.error.set(apiErrorMessage(error, 'The dashboard metrics could not be loaded.'));
      }
    } finally {
      if (request === this.requestId) {
        this.loading.set(false);
      }
    }
  }

  formatMoney(value: string | null): string {
    return formatCurrency(value, this.auth.activeOrganisation()?.currency ?? 'GBP');
  }

  formatPercent(value: string): string {
    const amount = Number(value);
    if (!Number.isFinite(amount)) {
      return value;
    }
    return `${amount > 0 ? '+' : ''}${amount.toFixed(2)}%`;
  }

  formatDate(value: string | null): string {
    return formatCalendarDate(value);
  }

  formatDateTime(value: string | null): string {
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

  stepClass(done: boolean): string {
    return done
      ? 'flex h-6 w-6 items-center justify-center rounded-full bg-teal-700 text-xs font-semibold text-white'
      : 'flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600';
  }

  private async loadDatasets(): Promise<void> {
    try {
      this.allDatasets.set(await this.datasetsApi.list());
    } catch {
      // The filter stays on all datasets; metrics still load.
    }
  }
}

import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import {
  AnalyticsService,
  Granularity,
  SalesSummary,
  SalesTrend,
  SalesTrendPoint,
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

@Component({
  selector: 'app-sales',
  imports: [RouterLink, AnalysisFilterBar, LoadingState, MetricInfo, ReportViewActions],
  template: `
    <header class="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
          Sales performance
        </p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Sales</h1>
        <p class="mt-2 max-w-2xl text-sm text-slate-600">
          Performance from the processed warehouse: sales, returns, orders and customers. Every
          measure is computed from loaded fact lines, never estimated.
        </p>
      </div>
      @if (summary(); as data) {
        @if (data.has_data) {
          <p class="text-sm text-slate-600">
            {{ formatDate(data.date_from) }} – {{ formatDate(data.date_to) }}
            <span class="block text-xs text-slate-500">
              Compared with {{ formatDate(data.comparison_date_from) }} –
              {{ formatDate(data.comparison_date_to) }}
            </span>
          </p>
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
      <app-loading-state label="Loading sales metrics" />
    } @else if (summary(); as data) {
      @if (!data.has_data) {
        <section
          class="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"
        >
          <h2 class="text-lg font-semibold text-slate-900">No processed sales in this range</h2>
          <p class="mx-auto mt-2 max-w-xl text-sm text-slate-600">
            Process a dataset with sales lines, or widen the date range. Returns alone appear in net
            sales but do not create an order.
          </p>
          <a
            routerLink="/datasets"
            class="mt-4 inline-block rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Go to datasets
          </a>
        </section>
      } @else {
        <section class="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <article class="rounded-2xl border border-slate-200 bg-white p-5">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-500">
              <app-metric-info
                label="Net sales"
                definition="Sales after discounts plus returns. Returns are stored as negative amounts."
              />
            </p>
            <p class="mt-2 text-2xl font-semibold text-slate-900">
              {{ formatMoney(data.net_sales) }}
            </p>
            <p class="mt-1 text-xs text-slate-500">
              After discounts and returns ({{ formatMoney(data.previous_net_sales) }} previous)
            </p>
          </article>
          <article class="rounded-2xl border border-slate-200 bg-white p-5">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Gross sales</p>
            <p class="mt-2 text-2xl font-semibold text-slate-900">
              {{ formatMoney(data.gross_sales) }}
            </p>
            <p class="mt-1 text-xs text-slate-500">Before discounts; returns excluded</p>
          </article>
          <article class="rounded-2xl border border-slate-200 bg-white p-5">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-500">
              <app-metric-info
                label="Eligible orders"
                definition="Distinct invoices with at least one sales line. Returns-only invoices do not count."
              />
            </p>
            <p class="mt-2 text-2xl font-semibold text-slate-900">{{ data.eligible_orders }}</p>
            <p class="mt-1 text-xs text-slate-500">Distinct invoice numbers with a sale</p>
          </article>
          <article class="rounded-2xl border border-slate-200 bg-white p-5">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-500">
              <app-metric-info
                label="Average order value"
                definition="Net sales divided by eligible orders. It is unavailable when there are no orders."
              />
            </p>
            <p class="mt-2 text-2xl font-semibold text-slate-900">
              {{ data.average_order_value ? formatMoney(data.average_order_value) : '—' }}
            </p>
            <p class="mt-1 text-xs text-slate-500">Net sales divided by eligible orders</p>
          </article>
          <article class="rounded-2xl border border-slate-200 bg-white p-5">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-500">
              Unique customers
            </p>
            <p class="mt-2 text-2xl font-semibold text-slate-900">{{ data.unique_customers }}</p>
            <p class="mt-1 text-xs text-slate-500">
              Identifiable customers with a sale; anonymous lines excluded
            </p>
          </article>
          <article class="rounded-2xl border border-slate-200 bg-white p-5">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-500">
              <app-metric-info
                label="Sales growth"
                definition="Net sales versus the immediately preceding period of equal length. It needs positive prior net sales."
              />
            </p>
            <p
              class="mt-2 text-2xl font-semibold"
              [class]="
                data.sales_growth_percent === null
                  ? 'text-slate-500'
                  : data.sales_growth_percent.startsWith('-')
                    ? 'text-amber-700'
                    : 'text-teal-700'
              "
            >
              {{
                data.sales_growth_percent === null
                  ? 'Not available'
                  : formatPercent(data.sales_growth_percent)
              }}
            </p>
            <p class="mt-1 text-xs text-slate-500">
              Net sales versus the preceding equal-length period; needs a positive prior period.
            </p>
          </article>
        </section>

        @if (data.datasets.length > 1) {
          <p class="mt-3 text-xs text-slate-500">
            Combined from
            @for (dataset of data.datasets; track dataset.id; let last = $last) {
              {{ dataset.name }}{{ last ? '' : ', ' }}
            }
            . Invoices and customers are counted per dataset.
          </p>
        }

        <section class="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
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
            @if (!series.points.length) {
              <p class="mt-6 text-sm text-slate-500">No periods in this range.</p>
            } @else {
              <div class="mt-4 overflow-x-auto">
                <table class="w-full text-left text-sm">
                  <thead class="text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th class="py-2 pr-4 font-medium">Period</th>
                      <th class="py-2 pr-4 font-medium">Net sales</th>
                      <th class="py-2 pr-4 font-medium">Orders</th>
                      <th class="w-1/4 py-2 font-medium">Relative</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    @for (point of series.points; track point.period_start) {
                      <tr>
                        <td class="py-2 pr-4 text-slate-700">{{ point.label }}</td>
                        <td
                          class="py-2 pr-4 font-medium"
                          [class]="
                            point.net_sales.startsWith('-') ? 'text-amber-700' : 'text-slate-900'
                          "
                        >
                          {{ formatMoney(point.net_sales) }}
                        </td>
                        <td class="py-2 pr-4 text-slate-700">{{ point.orders }}</td>
                        <td class="py-2">
                          <div class="h-2 rounded-full bg-slate-100">
                            <div
                              class="h-2 rounded-full"
                              [class]="
                                point.net_sales.startsWith('-') ? 'bg-amber-400' : 'bg-teal-500'
                              "
                              [style.width.%]="barWidth(point)"
                            ></div>
                          </div>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          }
        </section>
      }
    }
  `,
})
export class Sales {
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

  readonly granularities: Granularity[] = ['day', 'week', 'month'];
  readonly maxTrend = computed(() =>
    Math.max(
      1,
      ...(this.trend()?.points ?? []).map((point) => Math.abs(Number(point.net_sales) || 0)),
    ),
  );

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
      if (this.lastDatasetOrganisationId !== organisationId) {
        this.lastDatasetOrganisationId = organisationId;
        void this.loadDatasets();
      }
      const key = `${organisationId}:${this.scope.revision()}`;
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
        this.error.set(apiErrorMessage(error, 'Sales analytics could not be loaded.'));
      }
    } finally {
      if (request === this.requestId) {
        this.loading.set(false);
      }
    }
  }

  barWidth(point: SalesTrendPoint): number {
    return Math.max(
      0,
      Math.min(100, (Math.abs(Number(point.net_sales) || 0) / this.maxTrend()) * 100),
    );
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

  private async loadDatasets(): Promise<void> {
    try {
      this.allDatasets.set(await this.datasetsApi.list());
    } catch {
      // The filter simply stays on "all datasets"; metrics still load.
    }
  }
}

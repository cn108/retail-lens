import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { GeographyPerformance } from '../../core/api/analytics.service';
import { AnalysisQuery } from '../../core/analysis/analysis-scope.service';
import { AnalysisPage } from '../../core/analysis/analysis-page';
import { AnalysisFilterBar } from '../../shared/analysis-filter-bar';
import { LoadingState } from '../../shared/loading-state';
import { MetricInfo } from '../../shared/metric-info';
import { copyTable, downloadCsv, TablePreferencesService } from '../../shared/table-tools';
import { TableToolbar } from '../../shared/table-toolbar';

@Component({
  selector: 'app-geography',
  imports: [RouterLink, AnalysisFilterBar, LoadingState, MetricInfo, TableToolbar],
  template: `
    <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
          Market structure
        </p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
          Geography
        </h1>
        <p class="mt-2 max-w-2xl text-sm text-slate-600">
          Revenue, returns and customer reach by country. Lines without a country stay visible as
          “Unassigned” instead of being dropped, so totals always reconcile with Sales.
        </p>
      </div>
      @if (data(); as report) {
        @if (report.has_data) {
          <p class="text-right text-sm text-slate-600">
            {{ date(report.date_from) }} – {{ date(report.date_to) }}
            <span class="block text-xs text-slate-500">
              vs {{ date(report.comparison_date_from) }} – {{ date(report.comparison_date_to) }}
            </span>
          </p>
        }
      }
    </header>

    <app-analysis-filter-bar [datasets]="availableDatasets()" [loading]="loading()" />

    @if (error(); as message) {
      <div
        role="alert"
        class="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900"
      >
        <span>{{ message }}</span>
        <button type="button" class="font-semibold underline" (click)="reload()">Retry</button>
      </div>
    }

    @if (loading()) {
      <app-loading-state label="Loading country performance" />
    } @else if (data(); as report) {
      @if (!report.has_data) {
        <section
          class="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"
        >
          <h2 class="text-lg font-semibold text-slate-900">No sales in this range</h2>
          <p class="mx-auto mt-2 max-w-xl text-sm text-slate-600">
            Country performance needs processed sales lines. Widen the range or process a dataset
            whose geography column is mapped.
          </p>
          <a
            routerLink="/datasets"
            class="mt-4 inline-block rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Go to datasets
          </a>
        </section>
      } @else {
        <section class="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <article class="rounded-2xl border border-slate-200 bg-white p-5">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Net sales</p>
            <p class="mt-2 text-2xl font-semibold text-slate-900">{{ money(report.net_sales) }}</p>
            <p class="mt-1 text-xs text-slate-500">After discounts and returns</p>
          </article>
          <article class="rounded-2xl border border-slate-200 bg-white p-5">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-500">
              <app-metric-info
                label="Countries"
                definition="Distinct mapped countries with activity in the selected range. Unmapped geography appears as a single Unassigned row."
              />
            </p>
            <p class="mt-2 text-2xl font-semibold text-slate-900">{{ report.country_count }}</p>
            <p class="mt-1 text-xs text-slate-500">Countries with sales or returns</p>
          </article>
          <article class="rounded-2xl border border-slate-200 bg-white p-5">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-500">
              <app-metric-info
                label="Top market share"
                definition="The largest country's net sales divided by total net sales in the selected range."
              />
            </p>
            <p class="mt-2 text-2xl font-semibold text-slate-900">
              {{ report.top_country_share ? rate(report.top_country_share) : '—' }}
            </p>
            <p class="mt-1 text-xs text-slate-500">Concentration in the largest market</p>
          </article>
          <article class="rounded-2xl border border-slate-200 bg-white p-5">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-500">
              Returning market
            </p>
            <p class="mt-2 text-2xl font-semibold text-slate-900">
              {{ worstReturnCountry() ?? '—' }}
            </p>
            <p class="mt-1 text-xs text-slate-500">Highest return rate with returns recorded</p>
          </article>
        </section>

        <section class="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div
            class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"
          >
            <div>
              <h2 class="text-sm font-semibold text-slate-900">Country performance</h2>
              <p class="mt-1 text-sm text-slate-600">
                Sorted by net sales. Change compares with the selected baseline.
              </p>
            </div>
            <app-table-toolbar
              tableId="geography"
              [columns]="columnOptions"
              [rowCount]="rows().length"
              (exportCsv)="exportCsv()"
              (copy)="copyRows()"
            />
          </div>

          @if (copyStatus(); as status) {
            <p class="border-b border-slate-100 px-5 py-2 text-xs text-slate-600" role="status">
              {{ status }}
            </p>
          }

          <div class="overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead class="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th class="px-5 py-2.5 font-medium">Country</th>
                  @if (show('net')) {
                    <th class="px-4 py-2.5 text-right font-medium">Net sales</th>
                  }
                  @if (show('share')) {
                    <th class="px-4 py-2.5 font-medium">Share</th>
                  }
                  @if (show('orders')) {
                    <th class="px-4 py-2.5 text-right font-medium">Orders</th>
                  }
                  @if (show('customers')) {
                    <th class="px-4 py-2.5 text-right font-medium">Customers</th>
                  }
                  @if (show('returns')) {
                    <th class="px-4 py-2.5 text-right font-medium">Return rate</th>
                  }
                  @if (show('change')) {
                    <th class="px-5 py-2.5 text-right font-medium">Change</th>
                  }
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                @for (row of rows(); track row.country) {
                  <tr class="hover:bg-slate-50/60">
                    <td class="px-5" [class]="prefs.rowPadding()">
                      <span class="font-medium text-slate-900">{{ row.country }}</span>
                      @if (row.country === 'Unassigned') {
                        <span
                          class="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600"
                        >
                          no geography mapped
                        </span>
                      }
                    </td>
                    @if (show('net')) {
                      <td
                        class="px-4 text-right font-medium text-slate-900"
                        [class]="prefs.rowPadding()"
                      >
                        {{ money(row.net_sales) }}
                      </td>
                    }
                    @if (show('share')) {
                      <td class="w-40 px-4" [class]="prefs.rowPadding()">
                        <div class="flex items-center gap-2">
                          <div class="h-1.5 flex-1 rounded-full bg-slate-100">
                            <div
                              class="h-1.5 rounded-full bg-sky-500"
                              [style.width.%]="shareWidth(row.share)"
                            ></div>
                          </div>
                          <span class="w-12 text-right text-xs text-slate-600">
                            {{ row.share ? rate(row.share) : '—' }}
                          </span>
                        </div>
                      </td>
                    }
                    @if (show('orders')) {
                      <td class="px-4 text-right text-slate-700" [class]="prefs.rowPadding()">
                        {{ row.orders }}
                      </td>
                    }
                    @if (show('customers')) {
                      <td class="px-4 text-right text-slate-700" [class]="prefs.rowPadding()">
                        {{ row.customers }}
                      </td>
                    }
                    @if (show('returns')) {
                      <td class="px-4 text-right" [class]="prefs.rowPadding()">
                        <span
                          [class]="
                            highReturn(row.return_rate) ? 'text-amber-700' : 'text-slate-700'
                          "
                        >
                          {{ rate(row.return_rate) }}
                        </span>
                        <span class="block text-[11px] text-slate-500">
                          {{ row.returned_units }} units
                        </span>
                      </td>
                    }
                    @if (show('change')) {
                      <td class="px-5 text-right" [class]="prefs.rowPadding()">
                        <span [class]="directionClass(row.direction)">
                          {{ percent(row.change_percent) }}
                        </span>
                        <span class="block text-[11px] text-slate-500">
                          was {{ money(row.previous_net_sales) }}
                        </span>
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }
    }
  `,
})
export class Geography extends AnalysisPage {
  readonly data = signal<GeographyPerformance | null>(null);
  readonly copyStatus = signal<string | null>(null);

  readonly columnOptions = [
    { key: 'net', label: 'Net sales' },
    { key: 'share', label: 'Share' },
    { key: 'orders', label: 'Orders' },
    { key: 'customers', label: 'Customers' },
    { key: 'returns', label: 'Return rate' },
    { key: 'change', label: 'Change' },
  ];

  readonly rows = computed(() => this.data()?.rows ?? []);
  readonly prefs = inject(TablePreferencesService);

  protected async fetch(query: AnalysisQuery, request: number): Promise<void> {
    const result = await this.analytics.geography(query);
    if (this.isCurrent(request)) {
      this.data.set(result);
    }
  }

  show(key: string): boolean {
    return this.prefs.isVisible('geography', key);
  }

  shareWidth(share: string | null): number {
    // The API sends share as a percentage, so it maps straight onto a bar width.
    return Math.max(0, Math.min(100, Number(share ?? 0)));
  }

  worstReturnCountry(): string | null {
    const rows = this.rows().filter((row) => Number(row.return_rate ?? 0) > 0);
    if (!rows.length) {
      return null;
    }
    return rows.reduce((worst, row) =>
      Number(row.return_rate) > Number(worst.return_rate) ? row : worst,
    ).country;
  }

  highReturn(value: string | null): boolean {
    return Number(value ?? 0) > 10;
  }

  directionClass(direction: string): string {
    if (direction === 'growing' || direction === 'up') {
      return 'text-teal-700';
    }
    if (direction === 'declining' || direction === 'down') {
      return 'text-amber-700';
    }
    if (direction === 'new') {
      return 'text-sky-700';
    }
    return 'text-slate-500';
  }

  exportCsv(): void {
    downloadCsv(
      'geography-performance',
      [
        { header: 'Country', value: (row) => row.country },
        { header: 'Net sales', value: (row) => row.net_sales },
        { header: 'Gross sales', value: (row) => row.gross_sales },
        { header: 'Share %', value: (row) => row.share },
        { header: 'Orders', value: (row) => row.orders },
        { header: 'Customers', value: (row) => row.customers },
        { header: 'Returned units', value: (row) => row.returned_units },
        { header: 'Return rate %', value: (row) => row.return_rate },
        { header: 'Previous net sales', value: (row) => row.previous_net_sales },
        { header: 'Change %', value: (row) => row.change_percent },
      ],
      this.rows(),
    );
  }

  async copyRows(): Promise<void> {
    const ok = await copyTable(
      [
        { header: 'Country', value: (row) => row.country },
        { header: 'Net sales', value: (row) => row.net_sales },
        { header: 'Orders', value: (row) => row.orders },
        { header: 'Return rate %', value: (row) => row.return_rate },
      ],
      this.rows(),
    );
    this.copyStatus.set(ok ? 'Copied the table to the clipboard.' : 'Copy failed.');
  }
}

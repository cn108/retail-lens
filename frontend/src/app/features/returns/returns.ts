import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ReturnsAnalysis } from '../../core/api/analytics.service';
import { AnalysisPage } from '../../core/analysis/analysis-page';
import { AnalysisQuery } from '../../core/analysis/analysis-scope.service';
import { AnalysisFilterBar } from '../../shared/analysis-filter-bar';
import { LoadingState } from '../../shared/loading-state';
import { MetricInfo } from '../../shared/metric-info';
import { copyTable, downloadCsv, TablePreferencesService } from '../../shared/table-tools';
import { TableToolbar } from '../../shared/table-toolbar';

@Component({
  selector: 'app-returns',
  imports: [RouterLink, AnalysisFilterBar, LoadingState, MetricInfo, TableToolbar],
  template: `
    <header class="mb-6">
      <p class="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Margin leakage</p>
      <h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
        Returns &amp; discounts
      </h1>
      <p class="mt-2 max-w-2xl text-sm text-slate-600">
        Where gross sales turn into net sales, and which products and markets give the most back.
        Returns are counted from negative quantities in the warehouse, not inferred.
      </p>
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
      <app-loading-state label="Loading returns and discounts" />
    } @else if (data(); as report) {
      @if (!report.has_data) {
        <section
          class="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"
        >
          <h2 class="text-lg font-semibold text-slate-900">No sales or returns in this range</h2>
          <p class="mx-auto mt-2 max-w-xl text-sm text-slate-600">
            This view needs processed sales lines. Widen the range to see the gross-to-net bridge.
          </p>
        </section>
      } @else {
        <section class="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <article class="rounded-2xl border border-slate-200 bg-white p-5">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-500">
              <app-metric-info
                label="Return rate"
                definition="Returned units divided by sold units in the selected range. Units are summed from fact lines, so a partial return counts partially."
              />
            </p>
            <p class="mt-2 text-2xl font-semibold text-amber-700">{{ rate(report.return_rate) }}</p>
            <p class="mt-1 text-xs text-slate-500">
              {{ report.returned_units }} of {{ report.sold_units }} units
            </p>
          </article>
          <article class="rounded-2xl border border-slate-200 bg-white p-5">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-500">
              <app-metric-info
                label="Discount rate"
                definition="Discounts divided by gross sales in the selected range."
              />
            </p>
            <p class="mt-2 text-2xl font-semibold text-slate-900">
              {{ rate(report.discount_rate) }}
            </p>
            <p class="mt-1 text-xs text-slate-500">{{ money(report.discount_total) }} given away</p>
          </article>
          <article class="rounded-2xl border border-slate-200 bg-white p-5">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Return value</p>
            <p class="mt-2 text-2xl font-semibold text-amber-700">
              {{ money(report.return_value) }}
            </p>
            <p class="mt-1 text-xs text-slate-500">
              {{ report.return_lines }} return lines across {{ report.sales_lines }} sale lines
            </p>
          </article>
          <article class="rounded-2xl border border-slate-200 bg-white p-5">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Net sales</p>
            <p class="mt-2 text-2xl font-semibold text-slate-900">{{ money(report.net_sales) }}</p>
            <p class="mt-1 text-xs text-slate-500">After discounts and returns</p>
          </article>
        </section>

        <section class="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 class="text-sm font-semibold text-slate-900">Gross to net bridge</h2>
          <p class="mt-1 text-sm text-slate-600">
            Discounts and returns are subtracted from gross sales to reach net sales.
          </p>
          <div class="mt-4 space-y-3">
            @for (step of report.bridge; track step.label) {
              <div class="grid grid-cols-[8rem_1fr_7rem] items-center gap-3 text-sm">
                <span class="text-slate-600">{{ step.label }}</span>
                <div class="h-3 rounded-full bg-slate-100">
                  <div
                    class="h-3 rounded-full"
                    [class]="step.amount.startsWith('-') ? 'bg-amber-400' : 'bg-teal-500'"
                    [style.width.%]="bridgeWidth(step.amount)"
                  ></div>
                </div>
                <span
                  class="text-right font-medium"
                  [class]="step.amount.startsWith('-') ? 'text-amber-700' : 'text-slate-900'"
                >
                  {{ money(step.amount) }}
                </span>
              </div>
            }
          </div>
        </section>

        <section class="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div
            class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"
          >
            <div>
              <h2 class="text-sm font-semibold text-slate-900">Products with returns</h2>
              <p class="mt-1 text-sm text-slate-600">
                Only products that were actually returned, worst rate first.
              </p>
            </div>
            <app-table-toolbar
              tableId="returns-products"
              [rowCount]="report.products.length"
              (exportCsv)="exportProducts()"
              (copy)="copyProducts()"
            />
          </div>
          @if (copyStatus(); as status) {
            <p class="border-b border-slate-100 px-5 py-2 text-xs text-slate-600" role="status">
              {{ status }}
            </p>
          }
          @if (!report.products.length) {
            <p class="px-5 py-6 text-sm text-slate-500">
              No returned units in this range. That is good news.
            </p>
          } @else {
            <div class="overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead class="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th class="px-5 py-2.5 font-medium">Product</th>
                    <th class="px-4 py-2.5 text-right font-medium">Returned</th>
                    <th class="px-4 py-2.5 text-right font-medium">Sold</th>
                    <th class="px-4 py-2.5 text-right font-medium">Return rate</th>
                    <th class="px-5 py-2.5 text-right font-medium">Return value</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  @for (row of report.products; track row.product_id) {
                    <tr class="hover:bg-slate-50/60">
                      <td class="px-5" [class]="prefs.rowPadding()">
                        <a
                          [routerLink]="['/products', row.product_id]"
                          class="font-medium text-slate-900 hover:text-sky-700 hover:underline"
                        >
                          {{ row.description || row.source_product_code }}
                        </a>
                        <span class="block text-[11px] text-slate-500">
                          {{ row.source_product_code }} · {{ row.dataset_name }}
                        </span>
                      </td>
                      <td class="px-4 text-right text-slate-700" [class]="prefs.rowPadding()">
                        {{ row.returned_units }}
                      </td>
                      <td class="px-4 text-right text-slate-700" [class]="prefs.rowPadding()">
                        {{ row.sold_units }}
                      </td>
                      <td class="px-4 text-right font-medium" [class]="prefs.rowPadding()">
                        <span
                          [class]="
                            highReturn(row.return_rate) ? 'text-amber-700' : 'text-slate-900'
                          "
                        >
                          {{ rate(row.return_rate) }}
                        </span>
                      </td>
                      <td class="px-5 text-right text-amber-700" [class]="prefs.rowPadding()">
                        {{ money(row.return_value) }}
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>

        <section class="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div
            class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"
          >
            <div>
              <h2 class="text-sm font-semibold text-slate-900">Returns by country</h2>
              <p class="mt-1 text-sm text-slate-600">
                Countries where a returns problem is concentrated.
              </p>
            </div>
            <app-table-toolbar
              tableId="returns-countries"
              [rowCount]="report.countries.length"
              (exportCsv)="exportCountries()"
              (copy)="copyCountries()"
            />
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead class="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th class="px-5 py-2.5 font-medium">Country</th>
                  <th class="px-4 py-2.5 text-right font-medium">Sold units</th>
                  <th class="px-4 py-2.5 text-right font-medium">Returned units</th>
                  <th class="px-4 py-2.5 text-right font-medium">Return rate</th>
                  <th class="px-5 py-2.5 text-right font-medium">Return value</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                @for (row of report.countries; track row.country) {
                  <tr class="hover:bg-slate-50/60">
                    <td class="px-5 font-medium text-slate-900" [class]="prefs.rowPadding()">
                      {{ row.country }}
                    </td>
                    <td class="px-4 text-right text-slate-700" [class]="prefs.rowPadding()">
                      {{ row.sold_units }}
                    </td>
                    <td class="px-4 text-right text-slate-700" [class]="prefs.rowPadding()">
                      {{ row.returned_units }}
                    </td>
                    <td class="px-4 text-right" [class]="prefs.rowPadding()">
                      {{ rate(row.return_rate) }}
                    </td>
                    <td class="px-5 text-right text-amber-700" [class]="prefs.rowPadding()">
                      {{ money(row.return_value) }}
                    </td>
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
export class Returns extends AnalysisPage {
  readonly data = signal<ReturnsAnalysis | null>(null);
  readonly copyStatus = signal<string | null>(null);
  readonly prefs = inject(TablePreferencesService);

  readonly maxBridge = computed(() => {
    const report = this.data();
    if (!report) {
      return 1;
    }
    return Math.max(1, ...report.bridge.map((step) => Math.abs(Number(step.amount) || 0)));
  });

  protected async fetch(query: AnalysisQuery, request: number): Promise<void> {
    const result = await this.analytics.returns(query);
    if (this.isCurrent(request)) {
      this.data.set(result);
    }
  }

  bridgeWidth(amount: string): number {
    return Math.max(2, (Math.abs(Number(amount) || 0) / this.maxBridge()) * 100);
  }

  highReturn(value: string | null): boolean {
    return Number(value ?? 0) > 10;
  }

  exportProducts(): void {
    downloadCsv(
      'returns-by-product',
      [
        { header: 'Product code', value: (row) => row.source_product_code },
        { header: 'Description', value: (row) => row.description },
        { header: 'Dataset', value: (row) => row.dataset_name },
        { header: 'Returned units', value: (row) => row.returned_units },
        { header: 'Sold units', value: (row) => row.sold_units },
        { header: 'Return rate %', value: (row) => row.return_rate },
        { header: 'Return value', value: (row) => row.return_value },
        { header: 'Net sales', value: (row) => row.net_sales },
      ],
      this.data()?.products ?? [],
    );
  }

  exportCountries(): void {
    downloadCsv(
      'returns-by-country',
      [
        { header: 'Country', value: (row) => row.country },
        { header: 'Sold units', value: (row) => row.sold_units },
        { header: 'Returned units', value: (row) => row.returned_units },
        { header: 'Return rate %', value: (row) => row.return_rate },
        { header: 'Return value', value: (row) => row.return_value },
      ],
      this.data()?.countries ?? [],
    );
  }

  async copyProducts(): Promise<void> {
    const ok = await copyTable(
      [
        { header: 'Product', value: (row) => row.source_product_code },
        { header: 'Returned units', value: (row) => row.returned_units },
        { header: 'Return rate %', value: (row) => row.return_rate },
      ],
      this.data()?.products ?? [],
    );
    this.copyStatus.set(ok ? 'Copied to the clipboard.' : 'Copy failed.');
  }

  async copyCountries(): Promise<void> {
    const ok = await copyTable(
      [
        { header: 'Country', value: (row) => row.country },
        { header: 'Returned units', value: (row) => row.returned_units },
        { header: 'Return rate %', value: (row) => row.return_rate },
      ],
      this.data()?.countries ?? [],
    );
    this.copyStatus.set(ok ? 'Copied to the clipboard.' : 'Copy failed.');
  }
}

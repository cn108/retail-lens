import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { BasketAnalysis, BasketPair } from '../../core/api/analytics.service';
import { AnalysisPage } from '../../core/analysis/analysis-page';
import { AnalysisQuery } from '../../core/analysis/analysis-scope.service';
import { AnalysisFilterBar } from '../../shared/analysis-filter-bar';
import { LoadingState } from '../../shared/loading-state';
import { MetricInfo } from '../../shared/metric-info';
import { copyTable, downloadCsv, TablePreferencesService } from '../../shared/table-tools';
import { TableToolbar } from '../../shared/table-toolbar';

@Component({
  selector: 'app-basket',
  imports: [RouterLink, AnalysisFilterBar, LoadingState, MetricInfo, TableToolbar],
  template: `
    <header class="mb-6">
      <p class="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Cross-sell</p>
      <h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
        Market basket
      </h1>
      <p class="mt-2 max-w-2xl text-sm text-slate-600">
        Which products are bought on the same invoice, and how much more often than chance. Pairs
        need at least two product lines on one invoice; single-line invoices cannot contribute.
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
      <app-loading-state label="Loading basket pairs" />
    } @else if (data(); as report) {
      @if (!report.has_data) {
        <section
          class="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"
        >
          <h2 class="text-lg font-semibold text-slate-900">No product pairs in this range</h2>
          <p class="mx-auto mt-2 max-w-xl text-sm text-slate-600">
            This view needs invoices with more than one product line. Widen the range or process a
            dataset with multi-line baskets.
          </p>
          <a
            routerLink="/datasets"
            class="mt-4 inline-block rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Go to datasets
          </a>
        </section>
      } @else {
        <section class="mt-6 grid gap-3 sm:grid-cols-3">
          <article class="rounded-2xl border border-slate-200 bg-white p-5">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Invoices</p>
            <p class="mt-2 text-2xl font-semibold text-slate-900">{{ report.invoices }}</p>
            <p class="mt-1 text-xs text-slate-500">Invoices in the selected range</p>
          </article>
          <article class="rounded-2xl border border-slate-200 bg-white p-5">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Product pairs</p>
            <p class="mt-2 text-2xl font-semibold text-slate-900">{{ report.pairs.length }}</p>
            <p class="mt-1 text-xs text-slate-500">Distinct pairs seen together at least once</p>
          </article>
          <article class="rounded-2xl border border-slate-200 bg-white p-5">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-500">
              <app-metric-info
                label="Strongest lift"
                definition="Lift is how much more often a pair appears together than independence would predict. Above 1 means the products reinforce each other; below 1 means they substitute."
              />
            </p>
            <p class="mt-2 text-2xl font-semibold text-slate-900">
              {{ topLift() ? topLift()!.toFixed(2) + '×' : '—' }}
            </p>
            <p class="mt-1 text-xs text-slate-500">Best pair against chance</p>
          </article>
        </section>

        <section class="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div
            class="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 px-5 py-4"
          >
            <div class="min-w-0">
              <h2 class="text-sm font-semibold text-slate-900">Frequently bought together</h2>
              <p class="mt-1 text-sm text-slate-600">Ranked by lift, then by invoices together.</p>
            </div>
            <div class="flex flex-1 flex-wrap items-center justify-end gap-2">
              <input
                type="search"
                placeholder="Filter products"
                [value]="search()"
                (input)="searchChanged($event)"
                class="w-48 rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100"
              />
              <app-table-toolbar
                tableId="basket"
                [rowCount]="rows().length"
                (exportCsv)="exportCsv()"
                (copy)="copyRows()"
              />
            </div>
          </div>

          @if (copyStatus(); as status) {
            <p class="border-b border-slate-100 px-5 py-2 text-xs text-slate-600" role="status">
              {{ status }}
            </p>
          }

          @if (!rows().length) {
            <p class="px-5 py-6 text-sm text-slate-500">No pairs match that filter.</p>
          } @else {
            <div class="overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead class="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th class="px-5 py-2.5 font-medium">Pair</th>
                    <th class="px-4 py-2.5 text-right font-medium">Invoices</th>
                    <th class="px-4 py-2.5 text-right font-medium">Support</th>
                    <th class="px-4 py-2.5 text-right font-medium">A → B</th>
                    <th class="px-4 py-2.5 text-right font-medium">B → A</th>
                    <th class="px-5 py-2.5 text-right font-medium">Lift</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  @for (
                    pair of rows();
                    track pair.product_a.product_id + pair.product_b.product_id
                  ) {
                    <tr class="hover:bg-slate-50/60">
                      <td class="px-5" [class]="prefs.rowPadding()">
                        <a
                          [routerLink]="['/products', pair.product_a.product_id]"
                          class="font-medium text-slate-900 hover:text-sky-700 hover:underline"
                        >
                          {{ pair.product_a.description || pair.product_a.source_product_code }}
                        </a>
                        <span class="text-slate-400"> + </span>
                        <a
                          [routerLink]="['/products', pair.product_b.product_id]"
                          class="font-medium text-slate-900 hover:text-sky-700 hover:underline"
                        >
                          {{ pair.product_b.description || pair.product_b.source_product_code }}
                        </a>
                        <span class="block text-[11px] text-slate-500">
                          {{ pair.product_a.source_product_code }} ·
                          {{ pair.product_b.source_product_code }}
                        </span>
                      </td>
                      <td class="px-4 text-right text-slate-700" [class]="prefs.rowPadding()">
                        {{ pair.invoices }}
                      </td>
                      <td class="px-4 text-right text-slate-700" [class]="prefs.rowPadding()">
                        {{ rate(pair.support) }}
                      </td>
                      <td class="px-4 text-right text-slate-700" [class]="prefs.rowPadding()">
                        {{ rate(pair.confidence_a_to_b) }}
                      </td>
                      <td class="px-4 text-right text-slate-700" [class]="prefs.rowPadding()">
                        {{ rate(pair.confidence_b_to_a) }}
                      </td>
                      <td class="px-5 text-right font-medium" [class]="prefs.rowPadding()">
                        <span [class]="liftClass(pair)">{{
                          pair.lift ? pair.lift + '×' : '—'
                        }}</span>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }

          <p class="border-t border-slate-100 px-5 py-3 text-xs leading-relaxed text-slate-500">
            Support is the share of invoices containing both products. A → B is the share of A
            invoices that also contain B. Lift compares the pair's observed co-occurrence with the
            rate independence would predict.
          </p>
        </section>
      }
    }
  `,
})
export class Basket extends AnalysisPage {
  readonly data = signal<BasketAnalysis | null>(null);
  readonly search = signal('');
  readonly copyStatus = signal<string | null>(null);
  readonly prefs = inject(TablePreferencesService);

  readonly rows = computed(() => {
    const term = this.search().trim().toLowerCase();
    const pairs = this.data()?.pairs ?? [];
    if (!term) {
      return pairs;
    }
    return pairs.filter((pair) =>
      [
        pair.product_a.source_product_code,
        pair.product_a.description,
        pair.product_b.source_product_code,
        pair.product_b.description,
      ]
        .join(' ')
        .toLowerCase()
        .includes(term),
    );
  });

  readonly topLift = computed(() => {
    const lifts = (this.data()?.pairs ?? [])
      .map((pair) => (pair.lift === null ? NaN : Number(pair.lift)))
      .filter((value) => Number.isFinite(value));
    return lifts.length ? Math.max(...lifts) : null;
  });

  protected async fetch(query: AnalysisQuery, request: number): Promise<void> {
    const result = await this.analytics.basket(query);
    if (this.isCurrent(request)) {
      this.data.set(result);
      this.search.set('');
    }
  }

  searchChanged(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  liftClass(pair: BasketPair): string {
    const lift = Number(pair.lift ?? 0);
    if (!Number.isFinite(lift) || lift === 0) {
      return 'text-slate-500';
    }
    return lift >= 1.5 ? 'text-teal-700' : lift < 0.8 ? 'text-amber-700' : 'text-slate-700';
  }

  exportCsv(): void {
    downloadCsv(
      'market-basket',
      [
        { header: 'Product A', value: (row) => row.product_a.source_product_code },
        { header: 'Product A description', value: (row) => row.product_a.description },
        { header: 'Product B', value: (row) => row.product_b.source_product_code },
        { header: 'Product B description', value: (row) => row.product_b.description },
        { header: 'Invoices together', value: (row) => row.invoices },
        { header: 'Support %', value: (row) => row.support },
        { header: 'Confidence A to B %', value: (row) => row.confidence_a_to_b },
        { header: 'Confidence B to A %', value: (row) => row.confidence_b_to_a },
        { header: 'Lift', value: (row) => row.lift },
      ],
      this.rows(),
    );
  }

  async copyRows(): Promise<void> {
    const ok = await copyTable(
      [
        { header: 'Product A', value: (row) => row.product_a.source_product_code },
        { header: 'Product B', value: (row) => row.product_b.source_product_code },
        { header: 'Invoices', value: (row) => row.invoices },
        { header: 'Lift', value: (row) => row.lift },
      ],
      this.rows(),
    );
    this.copyStatus.set(ok ? 'Copied to the clipboard.' : 'Copy failed.');
  }
}

import { Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { apiErrorMessage } from '../../core/api/api-error';
import { DatasetSummary, DatasetsService } from '../../core/api/datasets.service';
import {
  ProductDirection,
  ProductPerformance,
  ProductRow,
  ProductsService,
} from '../../core/api/products.service';
import { AnalysisScopeService } from '../../core/analysis/analysis-scope.service';
import { AuthService } from '../../core/auth/auth.service';
import { formatDate, formatMoney, formatPercent } from '../../core/formatting';
import { AnalysisFilterBar } from '../../shared/analysis-filter-bar';
import { LoadingState } from '../../shared/loading-state';
import { MetricInfo } from '../../shared/metric-info';
import { ReportViewActions } from '../../shared/report-view-actions';
import { copyTable, downloadCsv, TablePreferencesService } from '../../shared/table-tools';
import { TableToolbar } from '../../shared/table-toolbar';

@Component({
  selector: 'app-products',
  imports: [
    RouterLink,
    AnalysisFilterBar,
    LoadingState,
    MetricInfo,
    ReportViewActions,
    TableToolbar,
  ],
  template: `
    <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
          Product intelligence
        </p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
          Products
        </h1>
        <p class="mt-2 max-w-2xl text-sm text-slate-600">
          Product revenue, units, contribution and period-over-period direction. Categories are not
          inferred: the source has no category field.
        </p>
      </div>
      @if (performance(); as data) {
        @if (data.has_data) {
          <p class="text-right text-sm text-slate-600">
            {{ date(data.date_from) }} – {{ date(data.date_to) }}
            <span class="block text-xs text-slate-500">
              vs {{ date(data.comparison_date_from) }} – {{ date(data.comparison_date_to) }}
            </span>
          </p>
        }
      }
    </header>

    <app-analysis-filter-bar [datasets]="availableDatasets()" [loading]="loading()" />

    @if (focusProduct(); as productCode) {
      <div
        role="status"
        class="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-teal-200 bg-teal-50 px-4 py-2 text-sm text-teal-900"
      >
        <span
          >Showing the performance row for product <strong>{{ productCode }}</strong
          >.</span
        >
        <button type="button" class="font-semibold hover:underline" (click)="clearFocus()">
          Show all products
        </button>
      </div>
    }

    <div class="mt-3 flex justify-end">
      <app-report-view-actions
        kind="products"
        label="Product performance"
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
      <app-loading-state label="Loading product metrics" />
    } @else if (performance(); as data) {
      @if (!data.has_data) {
        <section
          class="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"
        >
          <h2 class="text-lg font-semibold text-slate-900">
            {{
              data.date_from === null
                ? 'No processed product data yet'
                : 'No products in this range'
            }}
          </h2>
          <p class="mx-auto mt-2 max-w-xl text-sm text-slate-600">
            Product measures need processed sales lines. Widen the range or process a dataset with
            mapped product codes.
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
            <p class="mt-2 text-2xl font-semibold text-slate-900">
              {{ money(data.net_sales) }}
            </p>
            <p class="mt-1 text-xs text-slate-500">After discounts and returns</p>
          </article>
          <article class="rounded-2xl border border-slate-200 bg-white p-5">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Products sold</p>
            <p class="mt-2 text-2xl font-semibold text-slate-900">{{ data.product_count }}</p>
            <p class="mt-1 text-xs text-slate-500">Distinct product codes with activity</p>
          </article>
          <article class="rounded-2xl border border-slate-200 bg-white p-5">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-500">
              <app-metric-info
                label="Top product share"
                definition="The largest product's net sales divided by total net sales in the selected range."
              />
            </p>
            <p class="mt-2 text-2xl font-semibold text-slate-900">
              {{ data.top_product_share ? percent(data.top_product_share) : '—' }}
            </p>
            <p class="mt-1 text-xs text-slate-500">Largest net-sales contribution</p>
          </article>
          <article class="rounded-2xl border border-slate-200 bg-white p-5">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-500">
              <app-metric-info
                label="Declining"
                definition="Products whose net sales fell by 20% or more against the preceding equal-length period. This is a heuristic, not a significance test."
              />
            </p>
            <p
              class="mt-2 text-2xl font-semibold"
              [class]="data.declining_products ? 'text-amber-700' : 'text-slate-900'"
            >
              {{ data.declining_products }}
            </p>
            <p class="mt-1 text-xs text-slate-500">Net sales down 20% or more</p>
          </article>
        </section>

        <section class="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="text-sm font-semibold text-slate-900">Product performance</h2>
              <p class="mt-1 text-sm text-slate-600">
                Ranked by net sales. Contribution is the product's share of net sales in the
                selected range.
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              @if (!focusProduct()) {
                <label class="block">
                  <span class="sr-only">Search products</span>
                  <input
                    type="search"
                    placeholder="Search code or description"
                    [value]="search()"
                    (input)="searchChanged($event)"
                    class="rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </label>
              }
              <app-table-toolbar
                tableId="products"
                [rowCount]="rows().length"
                (exportCsv)="exportRows()"
                (copy)="copyRows()"
              />
            </div>
          </div>

          @if (copyStatus(); as status) {
            <p class="mt-2 text-xs text-slate-600" role="status">{{ status }}</p>
          }

          @if (!rows().length) {
            <p class="mt-4 text-sm text-slate-500">
              {{
                focusProduct()
                  ? 'No product matches that code in this dataset and date range.'
                  : 'No products match that search.'
              }}
            </p>
          } @else {
            <div class="mt-4 overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead class="text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th class="py-2 pr-2 font-medium">#</th>
                    <th class="py-2 pr-4 font-medium" [attr.aria-sort]="ariaSort('code')">
                      <button type="button" class="hover:text-slate-900" (click)="setSort('code')">
                        Product
                      </button>
                    </th>
                    <th
                      class="py-2 pr-4 text-right font-medium"
                      [attr.aria-sort]="ariaSort('net_sales')"
                    >
                      <button
                        type="button"
                        class="hover:text-slate-900"
                        (click)="setSort('net_sales')"
                      >
                        Net sales
                      </button>
                    </th>
                    <th class="w-1/5 py-2 pr-4 font-medium" [attr.aria-sort]="ariaSort('share')">
                      <button type="button" class="hover:text-slate-900" (click)="setSort('share')">
                        Share
                      </button>
                    </th>
                    <th
                      class="py-2 pr-4 text-right font-medium"
                      [attr.aria-sort]="ariaSort('units')"
                    >
                      <button type="button" class="hover:text-slate-900" (click)="setSort('units')">
                        Units
                      </button>
                    </th>
                    <th
                      class="py-2 pr-4 text-right font-medium"
                      [attr.aria-sort]="ariaSort('orders')"
                    >
                      <button
                        type="button"
                        class="hover:text-slate-900"
                        (click)="setSort('orders')"
                      >
                        Orders
                      </button>
                    </th>
                    <th class="py-2 font-medium">Change</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  @for (row of pagedRows(); track row.product_id) {
                    <tr class="hover:bg-slate-50/60">
                      <td class="py-2 pr-2 text-slate-400" [class]="prefs.rowPadding()">
                        {{ rank(row) }}
                      </td>
                      <td class="py-2 pr-4" [class]="prefs.rowPadding()">
                        <a
                          [routerLink]="['/products', row.product_id]"
                          class="font-medium text-slate-900 hover:text-sky-700 hover:underline"
                        >
                          {{ row.source_product_code }}
                        </a>
                        <p class="text-xs text-slate-500">
                          {{ row.description || 'No description' }} ·
                          <a
                            [routerLink]="['/datasets', row.dataset_id]"
                            class="hover:text-teal-700"
                          >
                            {{ row.dataset_name }}
                          </a>
                        </p>
                      </td>
                      <td
                        class="py-2 pr-4 text-right font-medium text-slate-900"
                        [class]="prefs.rowPadding()"
                      >
                        {{ money(row.net_sales) }}
                      </td>
                      <td class="py-2 pr-4" [class]="prefs.rowPadding()">
                        <div class="flex items-center gap-2">
                          <div class="h-2 flex-1 rounded-full bg-slate-100">
                            <div
                              class="h-2 rounded-full bg-teal-500"
                              [style.width.%]="shareWidth(row)"
                            ></div>
                          </div>
                          <span class="w-12 text-right text-xs text-slate-500">
                            {{ row.share ? percent(row.share) : '—' }}
                          </span>
                        </div>
                      </td>
                      <td class="py-2 pr-4 text-right text-slate-700" [class]="prefs.rowPadding()">
                        {{ row.units }}
                        @if (row.returned_units) {
                          <p class="text-xs text-amber-700">{{ row.returned_units }} returned</p>
                        }
                      </td>
                      <td class="py-2 pr-4 text-right text-slate-700" [class]="prefs.rowPadding()">
                        {{ row.orders }}
                      </td>
                      <td class="py-2" [class]="prefs.rowPadding()">
                        <span
                          class="rounded-full px-2 py-1 text-xs font-medium"
                          [class]="directionClass(row.direction)"
                        >
                          {{ changeLabel(row) }}
                        </span>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }

          <div
            class="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"
          >
            <span>Showing {{ pageStart() }}–{{ pageEnd() }} of {{ rows().length }} products</span>
            <div class="flex items-center gap-2">
              <button
                type="button"
                [disabled]="page() === 0"
                class="rounded-lg border border-slate-300 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                (click)="previousPage()"
              >
                Previous
              </button>
              <span>Page {{ page() + 1 }} / {{ pageCount() }}</span>
              <button
                type="button"
                [disabled]="page() >= pageCount() - 1"
                class="rounded-lg border border-slate-300 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                (click)="nextPage()"
              >
                Next
              </button>
            </div>
          </div>

          <p class="mt-4 text-xs text-slate-500">
            Change compares net sales with the immediately preceding equal-length period. Declining
            is a −20% or worse move, growing is +20% or better, new means positive net sales with
            none in the prior period, and returns only means negative activity with no prior sales.
            This is a heuristic, not a statistical test.
          </p>
        </section>
      }
    }
  `,
})
export class Products implements OnDestroy {
  private readonly productsApi = inject(ProductsService);
  private readonly datasetsApi = inject(DatasetsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);
  readonly scope = inject(AnalysisScopeService);

  readonly focusProduct = signal('');
  readonly performance = signal<ProductPerformance | null>(null);
  readonly allDatasets = signal<DatasetSummary[]>([]);
  readonly search = signal('');
  readonly sortKey = signal<'code' | 'net_sales' | 'share' | 'units' | 'orders'>('net_sales');
  readonly sortDirection = signal<'asc' | 'desc'>('desc');
  readonly page = signal(0);
  readonly pageSize = 20;
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly copyStatus = signal<string | null>(null);
  readonly prefs = inject(TablePreferencesService);

  readonly availableDatasets = computed(() =>
    this.allDatasets().filter(
      (dataset) => dataset.status === 'ready' || dataset.status === 'failed',
    ),
  );

  readonly rows = computed(() => {
    const term = this.search().trim().toLowerCase();
    const rows = (this.performance()?.rows ?? []).filter(
      (row) =>
        !term ||
        row.source_product_code.toLowerCase().includes(term) ||
        row.description.toLowerCase().includes(term) ||
        row.dataset_name.toLowerCase().includes(term),
    );
    const key = this.sortKey();
    const direction = this.sortDirection() === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (key === 'code') {
        return a.source_product_code.localeCompare(b.source_product_code) * direction;
      }
      return (Number(a[key]) - Number(b[key])) * direction;
    });
  });
  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.rows().length / this.pageSize)));
  readonly pagedRows = computed(() =>
    this.rows().slice(this.page() * this.pageSize, (this.page() + 1) * this.pageSize),
  );
  readonly pageStart = computed(() => (this.rows().length ? this.page() * this.pageSize + 1 : 0));
  readonly pageEnd = computed(() =>
    Math.min(this.rows().length, (this.page() + 1) * this.pageSize),
  );
  readonly currency = computed(() => this.auth.activeOrganisation()?.currency ?? 'GBP');

  private requestId = 0;
  private lastScopeKey = '';
  private lastDatasetOrganisationId: string | null = null;
  private readonly routeSubscription;

  constructor() {
    this.routeSubscription = this.route.queryParamMap.subscribe((params) => {
      const focus = params.get('product') ?? '';
      if (focus !== this.focusProduct()) {
        this.search.set('');
      }
      this.focusProduct.set(focus);
    });

    effect(() => {
      const organisationId = this.auth.activeOrganisation()?.id ?? null;
      if (!organisationId) {
        return;
      }
      this.scope.ensureFor(organisationId);
      if (this.lastDatasetOrganisationId !== organisationId) {
        this.lastDatasetOrganisationId = organisationId;
        this.search.set('');
        void this.loadDatasets();
      }
      const focus = this.focusProduct();
      const key = `${organisationId}:${this.scope.revision()}:${focus}`;
      if (key === this.lastScopeKey) {
        return;
      }
      this.lastScopeKey = key;
      void this.load(focus);
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription.unsubscribe();
  }

  clearFocus(): void {
    void this.router.navigate([], {
      queryParams: { product: null },
      queryParamsHandling: 'merge',
    });
  }

  readValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  searchChanged(event: Event): void {
    this.search.set(this.readValue(event));
    this.page.set(0);
  }

  setSort(key: 'code' | 'net_sales' | 'share' | 'units' | 'orders'): void {
    if (this.sortKey() === key) {
      this.sortDirection.update((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortKey.set(key);
      this.sortDirection.set(key === 'code' ? 'asc' : 'desc');
    }
    this.page.set(0);
  }

  ariaSort(key: 'code' | 'net_sales' | 'share' | 'units' | 'orders'): string {
    if (this.sortKey() !== key) {
      return 'none';
    }
    return this.sortDirection() === 'asc' ? 'ascending' : 'descending';
  }

  previousPage(): void {
    this.page.update((page) => Math.max(0, page - 1));
  }

  nextPage(): void {
    this.page.update((page) => Math.min(this.pageCount() - 1, page + 1));
  }

  rank(row: ProductRow): number | string {
    if (this.focusProduct()) {
      return '—';
    }
    // Rank follows the current sort and search, not the API's default order.
    const index = this.rows().findIndex((item) => item.product_id === row.product_id);
    return index === -1 ? '—' : index + 1;
  }

  exportRows(): void {
    downloadCsv(
      'product-performance',
      [
        { header: 'Product code', value: (row) => row.source_product_code },
        { header: 'Description', value: (row) => row.description },
        { header: 'Dataset', value: (row) => row.dataset_name },
        { header: 'Net sales', value: (row) => row.net_sales },
        { header: 'Share %', value: (row) => row.share },
        { header: 'Units', value: (row) => row.units },
        { header: 'Orders', value: (row) => row.orders },
        { header: 'Returned units', value: (row) => row.returned_units },
        { header: 'Previous net sales', value: (row) => row.previous_net_sales },
        { header: 'Change %', value: (row) => row.change_percent },
        { header: 'Direction', value: (row) => row.direction },
      ],
      this.rows(),
    );
  }

  async copyRows(): Promise<void> {
    const ok = await copyTable(
      [
        { header: 'Product', value: (row) => row.source_product_code },
        { header: 'Net sales', value: (row) => row.net_sales },
        { header: 'Units', value: (row) => row.units },
        { header: 'Change %', value: (row) => row.change_percent },
      ],
      this.rows(),
    );
    this.copyStatus.set(ok ? 'Copied to the clipboard.' : 'Copy failed.');
  }

  shareWidth(row: ProductRow): number {
    const value = Number(row.share);
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.max(0, Math.min(100, value));
  }

  directionClass(direction: ProductDirection): string {
    switch (direction) {
      case 'declining':
        return 'bg-amber-50 text-amber-800';
      case 'growing':
        return 'bg-teal-50 text-teal-800';
      case 'new':
        return 'bg-sky-50 text-sky-800';
      case 'returns':
        return 'bg-amber-50 text-amber-800';
      default:
        return 'bg-slate-100 text-slate-600';
    }
  }

  changeLabel(row: ProductRow): string {
    if (row.change_percent !== null) {
      const value = Number(row.change_percent);
      const prefix = value > 0 ? '+' : '';
      return `${prefix}${formatPercent(row.change_percent)}`;
    }
    if (row.direction === 'new') {
      return 'New';
    }
    if (row.direction === 'returns') {
      return 'Returns only';
    }
    return '—';
  }

  money(value: string | null): string {
    return formatMoney(value, this.currency());
  }

  percent(value: string | null): string {
    return formatPercent(value);
  }

  date(value: string | null): string {
    return formatDate(value);
  }

  async load(focus = this.focusProduct()): Promise<void> {
    const request = ++this.requestId;
    this.loading.set(true);
    this.error.set(null);
    const query = this.scope.query();
    const productQuery = focus ? { ...query, search: focus } : query;

    try {
      const performance = await this.productsApi.performance(productQuery);
      if (request === this.requestId) {
        this.performance.set(performance);
        this.page.set(0);
      }
    } catch (error) {
      if (request === this.requestId) {
        this.performance.set(null);
        this.error.set(apiErrorMessage(error, 'Product analytics could not be loaded.'));
      }
    } finally {
      if (request === this.requestId) {
        this.loading.set(false);
      }
    }
  }

  private async loadDatasets(): Promise<void> {
    try {
      this.allDatasets.set(await this.datasetsApi.list());
    } catch {
      // The filter stays on all datasets; metrics still load.
    }
  }
}

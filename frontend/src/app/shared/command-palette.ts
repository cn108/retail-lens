import {
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';

import { CustomersService, RfmCustomer } from '../core/api/customers.service';
import { DatasetStatus, DatasetsService, DatasetSummary } from '../core/api/datasets.service';
import { ProductRow, ProductsService } from '../core/api/products.service';
import { ReportingService, SavedReportSummary } from '../core/api/reporting.service';

type CommandKind = 'page' | 'report' | 'dataset' | 'customer' | 'product';

interface PageDefinition {
  id: string;
  label: string;
  detail: string;
  path: string;
  preserveScope: boolean;
  keywords: string;
}

interface CommandItem {
  id: string;
  kind: CommandKind;
  label: string;
  detail: string;
  path: string;
  preserveScope: boolean;
  queryParams?: Record<string, string>;
  searchText: string;
}

interface CommandSlot {
  item: CommandItem;
  index: number;
}

interface CommandGroup {
  key: string;
  label: string;
  items: CommandSlot[];
}

const PAGES: PageDefinition[] = [
  {
    id: 'page-dashboard',
    label: 'Dashboard',
    detail: 'Overview, trend and data confidence',
    path: '/dashboard',
    preserveScope: true,
    keywords: 'home overview kpis revenue data quality',
  },
  {
    id: 'page-sales',
    label: 'Sales',
    detail: 'Sales performance and trend',
    path: '/sales',
    preserveScope: true,
    keywords: 'revenue orders average order value growth trend',
  },
  {
    id: 'page-customers',
    label: 'Customers',
    detail: 'Customer value, RFM and retention',
    path: '/customers',
    preserveScope: true,
    keywords: 'rfm cohorts repeat retention customer value',
  },
  {
    id: 'page-products',
    label: 'Products',
    detail: 'Product revenue, units and direction',
    path: '/products',
    preserveScope: true,
    keywords: 'product performance units revenue share',
  },
  {
    id: 'page-geography',
    label: 'Geography',
    detail: 'Country revenue, returns and market share',
    path: '/geography',
    preserveScope: true,
    keywords: 'country region market geography territory share',
  },
  {
    id: 'page-returns',
    label: 'Returns & discounts',
    detail: 'Gross-to-net bridge, return and discount rates',
    path: '/returns',
    preserveScope: true,
    keywords: 'returns refunds discounts bridge leakage',
  },
  {
    id: 'page-basket',
    label: 'Cross-sell',
    detail: 'Market basket pairs, support, confidence and lift',
    path: '/basket',
    preserveScope: true,
    keywords: 'basket affinity cross sell frequently bought together lift',
  },
  {
    id: 'page-boards',
    label: 'Boards',
    detail: 'Saved widget layouts for recurring reviews',
    path: '/boards',
    preserveScope: true,
    keywords: 'board dashboard saved layout widgets workspace',
  },
  {
    id: 'page-monitoring',
    label: 'Monitoring',
    detail: 'Alerts, targets and scheduled report delivery',
    path: '/monitoring',
    preserveScope: false,
    keywords: 'alert threshold target goal schedule email delivery monitor',
  },
  {
    id: 'page-quality',
    label: 'Data quality',
    detail: 'Rejected rows and their reasons across datasets',
    path: '/quality',
    preserveScope: false,
    keywords: 'quality rejected rows issues validation mapping errors',
  },
  {
    id: 'page-datasets',
    label: 'Datasets',
    detail: 'Upload, map and process transaction data',
    path: '/datasets',
    preserveScope: false,
    keywords: 'data files upload import mapping processing quality',
  },
  {
    id: 'page-forecasting',
    label: 'Forecasting',
    detail: 'Monthly sales forecast and anomalies',
    path: '/forecasting',
    preserveScope: false,
    keywords: 'forecast anomaly model prediction',
  },
  {
    id: 'page-reports',
    label: 'Reports',
    detail: 'Saved reports and CSV or PDF exports',
    path: '/reports',
    preserveScope: false,
    keywords: 'saved report export csv pdf download',
  },
  {
    id: 'page-settings',
    label: 'Settings',
    detail: 'Organisation, profile and system status',
    path: '/settings',
    preserveScope: false,
    keywords: 'organisation members profile password system health status',
  },
];

const DATASET_STATUS_LABELS: Record<DatasetStatus, string> = {
  draft: 'Draft',
  mapped: 'Mapped',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
};

const PAGE_ITEMS: CommandItem[] = PAGES.map((page) => ({
  ...page,
  kind: 'page',
  searchText: searchable(`${page.label} ${page.detail} ${page.keywords}`),
}));

@Component({
  selector: 'app-command-palette',
  template: `
    @if (open()) {
      <div
        class="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 px-4 pt-[8vh] sm:pt-[12vh]"
        role="presentation"
        (click)="close()"
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="command-title"
          class="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          (click)="$event.stopPropagation()"
          (keydown)="onDialogKeydown($event)"
        >
          <h2 id="command-title" class="sr-only">Search RetailLens</h2>

          <div class="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              class="h-5 w-5 shrink-0 text-slate-400"
            >
              <circle cx="11" cy="11" r="7"></circle>
              <path d="m20 20-3.5-3.5"></path>
            </svg>
            <input
              #searchInput
              type="search"
              role="combobox"
              aria-label="Search pages, saved reports, datasets, customers and products"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls="command-results"
              [attr.aria-activedescendant]="activeDescendant()"
              [value]="query()"
              (input)="updateQuery(readValue($event))"
              (keydown)="onInputKeydown($event)"
              placeholder="Search pages, reports, datasets and records"
              autocomplete="off"
              spellcheck="false"
              data-palette-tab
              class="min-w-0 flex-1 border-0 bg-transparent text-base text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
            <button
              type="button"
              aria-label="Close search"
              data-palette-tab
              class="rounded-lg p-1 text-lg leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              (click)="close()"
            >
              ×
            </button>
          </div>

          @if (notice(); as message) {
            <div
              role="alert"
              class="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
            >
              <span>{{ message }}</span>
              <button
                type="button"
                data-palette-tab
                class="font-semibold text-amber-900 hover:underline"
                (click)="retry()"
              >
                Try again
              </button>
            </div>
          }

          <div
            id="command-results"
            role="listbox"
            aria-label="Search results"
            [attr.aria-busy]="loading() || entityLoading()"
            class="min-h-0 flex-1 overflow-y-auto p-2"
          >
            @if (groups().length) {
              @for (group of groups(); track group.key) {
                <div role="group" [attr.aria-labelledby]="'command-group-' + group.key">
                  <p
                    [id]="'command-group-' + group.key"
                    class="flex items-center justify-between px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500"
                  >
                    <span>{{ group.label }}</span>
                    <span class="font-medium tracking-normal text-slate-400">
                      {{ group.items.length }}
                    </span>
                  </p>
                  @for (slot of group.items; track slot.item.id) {
                    <button
                      type="button"
                      role="option"
                      tabindex="-1"
                      [id]="optionId(slot.index)"
                      [attr.aria-selected]="slot.index === selectedIndex()"
                      class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left"
                      [class.bg-teal-50]="slot.index === selectedIndex()"
                      [class.text-teal-900]="slot.index === selectedIndex()"
                      (mouseenter)="activeIndex.set(slot.index)"
                      (click)="select(slot.item)"
                    >
                      <span class="min-w-0 flex-1">
                        <span class="block truncate text-sm font-medium">{{
                          slot.item.label
                        }}</span>
                        <span class="mt-0.5 block truncate text-xs text-slate-500">
                          {{ slot.item.detail }}
                        </span>
                      </span>
                      @if (slot.index === selectedIndex()) {
                        <span aria-hidden="true" class="shrink-0 text-xs text-teal-700">↵</span>
                      }
                    </button>
                  }
                </div>
              }
            } @else if (loading() || entityLoading()) {
              <p role="status" class="px-3 py-8 text-center text-sm text-slate-500">
                {{ loading() ? 'Searching saved items…' : 'Searching customers and products…' }}
              </p>
            } @else {
              <div class="px-3 py-8 text-center">
                <p class="text-sm font-medium text-slate-800">No matches</p>
                <p class="mt-1 text-sm text-slate-500">
                  Try a page, report, dataset, customer or product name.
                </p>
              </div>
            }
          </div>

          <div
            class="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-500"
          >
            <span role="status">
              @if (loading()) {
                Refreshing saved items…
              } @else if (entityLoading()) {
                Searching customers and products…
              } @else {
                {{ results().length }} {{ results().length === 1 ? 'result' : 'results' }}
              }
            </span>
            <span class="flex flex-wrap gap-3">
              <span><kbd class="font-sans font-semibold">↑↓</kbd> navigate</span>
              <span><kbd class="font-sans font-semibold">↵</kbd> open</span>
              <span><kbd class="font-sans font-semibold">Esc</kbd> close</span>
            </span>
          </div>
        </section>
      </div>
    }
  `,
})
export class CommandPalette implements OnDestroy {
  readonly open = input(false);
  readonly closed = output<void>();

  private readonly router = inject(Router);
  private readonly reporting = inject(ReportingService);
  private readonly datasetsApi = inject(DatasetsService);
  private readonly customersApi = inject(CustomersService);
  private readonly productsApi = inject(ProductsService);
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  readonly query = signal('');
  readonly activeIndex = signal(0);
  readonly reports = signal<SavedReportSummary[]>([]);
  readonly datasets = signal<DatasetSummary[]>([]);
  readonly customers = signal<RfmCustomer[]>([]);
  readonly products = signal<ProductRow[]>([]);
  readonly loading = signal(false);
  readonly entityLoading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly entityError = signal<string | null>(null);
  readonly notice = computed(() => this.loadError() ?? this.entityError());

  readonly groups = computed<CommandGroup[]>(() => {
    const tokens = searchable(this.query()).split(/\s+/).filter(Boolean);
    // Match the start of a word rather than any substring, so "board" finds a
    // report called "Board pack" but does not also match "Dashboard".
    const matches = (item: CommandItem) => {
      const words = item.searchText.split(/\s+/);
      return tokens.every((token) => words.some((word) => word.startsWith(token)));
    };

    let index = 0;
    const groups: CommandGroup[] = [];

    const pages = PAGE_ITEMS.filter(matches);
    if (pages.length) {
      groups.push({
        key: 'pages',
        label: 'Pages',
        items: pages.map((item) => ({ item, index: index++ })),
      });
    }

    const reports = this.reports()
      .map((report) => this.reportItem(report))
      .filter(matches);
    if (reports.length) {
      groups.push({
        key: 'reports',
        label: 'Saved reports',
        items: reports.map((item) => ({ item, index: index++ })),
      });
    }

    const datasets = this.datasets()
      .map((dataset) => this.datasetItem(dataset))
      .filter(matches);
    if (datasets.length) {
      groups.push({
        key: 'datasets',
        label: 'Datasets',
        items: datasets.map((item) => ({ item, index: index++ })),
      });
    }

    const customers = this.customers()
      .map((customer) => this.customerItem(customer))
      .filter(matches);
    if (customers.length) {
      groups.push({
        key: 'customers',
        label: 'Customers',
        items: customers.map((item) => ({ item, index: index++ })),
      });
    }

    const products = this.products()
      .map((product) => this.productItem(product))
      .filter(matches);
    if (products.length) {
      groups.push({
        key: 'products',
        label: 'Products',
        items: products.map((item) => ({ item, index: index++ })),
      });
    }

    return groups;
  });

  readonly results = computed(() => this.groups().flatMap((group) => group.items));
  readonly selectedIndex = computed(() => {
    const total = this.results().length;
    if (!total) {
      return -1;
    }
    return Math.min(this.activeIndex(), total - 1);
  });
  readonly activeItem = computed(() => {
    const index = this.selectedIndex();
    return index >= 0 ? this.results()[index].item : null;
  });
  readonly activeDescendant = computed(() => {
    const index = this.selectedIndex();
    return index >= 0 ? this.optionId(index) : null;
  });

  private wasOpen = false;
  private previousFocus: HTMLElement | null = null;
  private restoreFocus = false;
  private loadSequence = 0;
  private entitySequence = 0;
  private focusTimer: ReturnType<typeof setTimeout> | null = null;
  private entityTimer: ReturnType<typeof setTimeout> | null = null;
  private previousOverflow = '';

  constructor() {
    effect(() => {
      const isOpen = this.open();
      if (isOpen === this.wasOpen) {
        return;
      }
      this.wasOpen = isOpen;
      if (isOpen) {
        this.activate();
      } else {
        this.deactivate();
      }
    });
  }

  ngOnDestroy(): void {
    this.loadSequence += 1;
    this.entitySequence += 1;
    this.clearFocusTimer();
    this.clearEntityTimer();
    if (this.wasOpen) {
      document.body.style.overflow = this.previousOverflow;
    }
  }

  readValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  updateQuery(value: string): void {
    this.query.set(value);
    this.activeIndex.set(0);
    this.scheduleEntitySearch(value);
  }

  retry(): void {
    if (this.loadError()) {
      void this.load();
    }
    if (this.entityError()) {
      this.scheduleEntitySearch(this.query(), 0);
    }
  }

  close(): void {
    this.restoreFocus = true;
    this.closed.emit();
  }

  onDialogKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }

    const dialog = event.currentTarget as HTMLElement | null;
    if (!dialog) {
      return;
    }
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('[data-palette-tab]')).filter(
      (element) => !element.hasAttribute('disabled'),
    );
    if (!focusable.length) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;

    if (!active || !focusable.includes(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  onInputKeydown(event: KeyboardEvent): void {
    if (event.isComposing) {
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.moveActive(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.moveActive(-1);
        break;
      case 'Home':
        event.preventDefault();
        this.moveTo(0);
        break;
      case 'End':
        event.preventDefault();
        this.moveTo(this.results().length - 1);
        break;
      case 'Enter': {
        const item = this.activeItem();
        if (item) {
          event.preventDefault();
          void this.select(item);
        }
        break;
      }
    }
  }

  async select(item: CommandItem): Promise<void> {
    // Navigate without restoring focus to the dialog's opener; the destination
    // heading area receives focus instead.
    this.restoreFocus = false;
    this.closed.emit();
    try {
      if (item.queryParams) {
        await this.router.navigate([item.path], { queryParams: item.queryParams });
      } else if (item.preserveScope) {
        // Keep the dataset and date scope, but never carry a focused customer
        // or product id onto another analysis page.
        await this.router.navigate([item.path], {
          queryParams: { customer: null, product: null },
          queryParamsHandling: 'preserve',
        });
      } else {
        await this.router.navigate([item.path]);
      }
    } finally {
      setTimeout(() => document.getElementById('main-content')?.focus());
    }
  }

  optionId(index: number): string {
    return `command-option-${index}`;
  }

  private activate(): void {
    this.previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.restoreFocus = true;
    this.query.set('');
    this.activeIndex.set(0);
    this.reports.set([]);
    this.datasets.set([]);
    this.customers.set([]);
    this.products.set([]);
    this.loadError.set(null);
    this.entityError.set(null);
    this.entityLoading.set(false);
    this.entitySequence += 1;
    this.clearEntityTimer();

    this.previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    this.clearFocusTimer();
    this.focusTimer = setTimeout(() => {
      const input = this.searchInput()?.nativeElement;
      input?.focus();
      input?.select();
    });

    void this.load();
  }

  private deactivate(): void {
    this.loadSequence += 1;
    this.entitySequence += 1;
    this.loading.set(false);
    this.entityLoading.set(false);
    this.clearFocusTimer();
    this.clearEntityTimer();
    document.body.style.overflow = this.previousOverflow;

    const target = this.previousFocus;
    this.previousFocus = null;
    if (this.restoreFocus) {
      if (target?.isConnected) {
        target.focus();
      } else {
        // The opener may have been removed, for example the mobile drawer's
        // search control, so leave focus in the page rather than on the body.
        document.getElementById('main-content')?.focus();
      }
    }
    this.restoreFocus = false;
  }

  private moveActive(delta: number): void {
    const total = this.results().length;
    if (!total) {
      return;
    }
    const current = this.selectedIndex();
    const next = current < 0 ? 0 : (current + delta + total) % total;
    this.moveTo(next);
  }

  private moveTo(index: number): void {
    if (!this.results().length) {
      return;
    }
    const bounded = Math.min(Math.max(index, 0), this.results().length - 1);
    this.activeIndex.set(bounded);
    setTimeout(() => {
      document.getElementById(this.optionId(bounded))?.scrollIntoView({ block: 'nearest' });
    });
  }

  private clearFocusTimer(): void {
    if (this.focusTimer) {
      clearTimeout(this.focusTimer);
      this.focusTimer = null;
    }
  }

  private clearEntityTimer(): void {
    if (this.entityTimer) {
      clearTimeout(this.entityTimer);
      this.entityTimer = null;
    }
  }

  private scheduleEntitySearch(value: string, delay = 180): void {
    this.clearEntityTimer();
    this.entitySequence += 1;
    this.customers.set([]);
    this.products.set([]);
    this.entityError.set(null);
    if (!value.trim()) {
      this.entityLoading.set(false);
      return;
    }
    this.entityLoading.set(true);
    this.entityTimer = setTimeout(() => {
      this.entityTimer = null;
      void this.searchEntities(value);
    }, delay);
  }

  private async searchEntities(value: string): Promise<void> {
    const term = value.trim();
    const sequence = ++this.entitySequence;
    this.entityLoading.set(true);
    this.entityError.set(null);
    this.customers.set([]);
    this.products.set([]);

    const [customersResult, productsResult] = await Promise.allSettled([
      this.customersApi.rfm({ search: term }, 8),
      this.productsApi.performance({ search: term }, 8),
    ]);
    if (sequence !== this.entitySequence) {
      return;
    }

    const failed: string[] = [];
    if (customersResult.status === 'fulfilled') {
      this.customers.set(customersResult.value.customers);
    } else {
      failed.push('customers');
    }
    if (productsResult.status === 'fulfilled') {
      this.products.set(productsResult.value.rows);
    } else {
      failed.push('products');
    }

    this.entityError.set(
      failed.length
        ? `${failed.join(' and ')} could not be searched. Pages, reports and datasets are still available.`
        : null,
    );
    this.entityLoading.set(false);
  }

  private async load(): Promise<void> {
    const sequence = ++this.loadSequence;
    this.loading.set(true);
    this.loadError.set(null);

    const [reportsResult, datasetsResult] = await Promise.allSettled([
      this.reporting.list(),
      this.datasetsApi.list(),
    ]);
    if (sequence !== this.loadSequence) {
      return;
    }

    const failed: string[] = [];
    if (reportsResult.status === 'fulfilled') {
      this.reports.set(reportsResult.value);
    } else {
      this.reports.set([]);
      failed.push('saved reports');
    }
    if (datasetsResult.status === 'fulfilled') {
      this.datasets.set(datasetsResult.value);
    } else {
      this.datasets.set([]);
      failed.push('datasets');
    }

    this.loadError.set(
      failed.length
        ? `Some ${failed.join(' and ')} could not be loaded. Pages are still available.`
        : null,
    );
    this.loading.set(false);
  }

  private reportItem(report: SavedReportSummary): CommandItem {
    const dataset = report.dataset?.name || 'All processed datasets';
    return {
      id: `report-${report.id}`,
      kind: 'report',
      label: report.name,
      detail: `${report.kind_label} · ${dataset}`,
      path: `/reports/${report.id}`,
      preserveScope: false,
      searchText: searchable(
        `${report.name} ${report.kind_label} ${dataset} saved report export csv pdf`,
      ),
    };
  }

  private datasetItem(dataset: DatasetSummary): CommandItem {
    const status = DATASET_STATUS_LABELS[dataset.status] ?? dataset.status;
    const detail = `${status} · ${dataset.row_count.toLocaleString('en-GB')} rows`;
    return {
      id: `dataset-${dataset.id}`,
      kind: 'dataset',
      label: dataset.name,
      detail,
      path: `/datasets/${dataset.id}`,
      preserveScope: false,
      searchText: searchable(`${dataset.name} ${status} ${detail} dataset`),
    };
  }

  private customerItem(customer: RfmCustomer): CommandItem {
    const detail = `${customer.segment_label} · ${customer.dataset_name}`;
    return {
      id: `customer-${customer.customer_id}`,
      kind: 'customer',
      label: customer.source_customer_id,
      detail,
      path: `/customers/${customer.customer_id}`,
      preserveScope: false,
      searchText: searchable(
        `${customer.source_customer_id} ${customer.segment_label} ${customer.dataset_name} customer`,
      ),
    };
  }

  private productItem(product: ProductRow): CommandItem {
    const description = product.description || 'No description';
    return {
      id: `product-${product.product_id}`,
      kind: 'product',
      label: product.source_product_code,
      detail: `${description} · ${product.dataset_name}`,
      path: `/products/${product.product_id}`,
      preserveScope: false,
      searchText: searchable(
        `${product.source_product_code} ${product.description} ${product.dataset_name} product`,
      ),
    };
  }
}

function searchable(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

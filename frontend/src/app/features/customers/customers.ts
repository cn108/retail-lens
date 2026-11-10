import { Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { apiErrorMessage } from '../../core/api/api-error';
import {
  CustomerSegment,
  CustomerSummary,
  CustomersService,
  RetentionResponse,
  RfmResponse,
  RfmSegment,
  RfmSort,
  SegmentMembers,
  SegmentRules,
} from '../../core/api/customers.service';
import { DatasetSummary, DatasetsService } from '../../core/api/datasets.service';
import { AnalysisScopeService } from '../../core/analysis/analysis-scope.service';
import { AuthService } from '../../core/auth/auth.service';
import { formatDate, formatMoney, formatPercent } from '../../core/formatting';
import { AnalysisFilterBar } from '../../shared/analysis-filter-bar';
import { LoadingState } from '../../shared/loading-state';
import { MetricInfo } from '../../shared/metric-info';
import { ReportViewActions } from '../../shared/report-view-actions';
import { copyTable, downloadCsv, TablePreferencesService } from '../../shared/table-tools';
import { TableToolbar } from '../../shared/table-toolbar';

interface SegmentDraft {
  name: string;
  orders_min: number;
  net_sales_min: string;
  recency_days_max: number;
  rfm_segment: string;
}

@Component({
  selector: 'app-customers',
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
          Customer intelligence
        </p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
          Customers
        </h1>
        <p class="mt-2 max-w-2xl text-sm text-slate-600">
          RFM segments, repeat purchase, observed historical value and monthly retention. Anonymous
          lines are excluded; value is observed net sales, not a predicted CLV.
        </p>
      </div>
      @if (summary(); as data) {
        @if (data.has_data) {
          <p class="text-right text-sm text-slate-600">
            {{ date(data.date_from) }} – {{ date(data.date_to) }}
            <span class="block text-xs text-slate-500">
              {{ data.cohort_count }} first-purchase
              {{ data.cohort_count === 1 ? 'cohort' : 'cohorts' }}
            </span>
          </p>
        }
      }
    </header>

    <app-analysis-filter-bar [datasets]="availableDatasets()" [loading]="loading()" />

    @if (focusCustomer(); as customerId) {
      <div
        role="status"
        class="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-teal-200 bg-teal-50 px-4 py-2 text-sm text-teal-900"
      >
        <span
          >Showing the RFM row for customer <strong>{{ customerId }}</strong
          >.</span
        >
        <button type="button" class="font-semibold hover:underline" (click)="clearFocus()">
          Show all customers
        </button>
      </div>
    }

    <div class="mt-3 flex justify-end">
      <app-report-view-actions
        kind="customers"
        label="Customer performance"
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
      <app-loading-state label="Loading customer metrics" />
    } @else if (summary(); as data) {
      @if (!data.has_data) {
        <section
          class="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"
        >
          <h2 class="text-lg font-semibold text-slate-900">
            {{
              data.date_from === null
                ? 'No processed customer data yet'
                : 'No identifiable customers in this range'
            }}
          </h2>
          <p class="mx-auto mt-2 max-w-xl text-sm text-slate-600">
            Customer measures need at least one sale with a customer identifier. Anonymous lines
            still count towards sales but cannot be analysed as customers.
          </p>
          <a
            routerLink="/datasets"
            class="mt-4 inline-block rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Go to datasets
          </a>
        </section>
      } @else {
        <section class="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <article class="rounded-2xl border border-slate-200 bg-white p-5">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Customers</p>
            <p class="mt-2 text-2xl font-semibold text-slate-900">
              {{ data.identifiable_customers }}
            </p>
            <p class="mt-1 text-xs text-slate-500">With at least one sale in range</p>
          </article>
          <article class="rounded-2xl border border-slate-200 bg-white p-5">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-500">
              <app-metric-info
                label="Repeat rate"
                definition="Customers with two or more distinct sales invoices divided by identifiable customers."
              />
            </p>
            <p class="mt-2 text-2xl font-semibold text-slate-900">
              {{ data.repeat_purchase_rate ? percent(data.repeat_purchase_rate) : '—' }}
            </p>
            <p class="mt-1 text-xs text-slate-500">
              {{ data.repeat_customers }}
              {{ data.repeat_customers === 1 ? 'customer' : 'customers' }} with 2+ invoices
            </p>
          </article>
          <article class="rounded-2xl border border-slate-200 bg-white p-5">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Avg. orders</p>
            <p class="mt-2 text-2xl font-semibold text-slate-900">
              {{ data.average_orders ?? '—' }}
            </p>
            <p class="mt-1 text-xs text-slate-500">Distinct invoices per customer</p>
          </article>
          <article class="rounded-2xl border border-slate-200 bg-white p-5">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-500">
              <app-metric-info
                label="Month-1 retention"
                definition="The size-weighted share of eligible first-purchase cohorts that bought again one month later."
              />
            </p>
            <p class="mt-2 text-2xl font-semibold text-slate-900">
              {{ data.month_1_retention ? percent(data.month_1_retention) : '—' }}
            </p>
            <p class="mt-1 text-xs text-slate-500">New cohorts observed one month later</p>
          </article>
          <article class="rounded-2xl border border-slate-200 bg-white p-5">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-500">
              <app-metric-info
                label="Avg. observed value"
                definition="Observed net sales per identifiable customer in the selected range. This is not a predicted lifetime value."
              />
            </p>
            <p class="mt-2 text-2xl font-semibold text-slate-900">
              {{ data.average_historical_value ? money(data.average_historical_value) : '—' }}
            </p>
            <p class="mt-1 text-xs text-slate-500">
              Net sales per customer · {{ money(data.historical_value) }} total
            </p>
          </article>
        </section>

        <section class="mt-6 grid gap-4 xl:grid-cols-3">
          <div class="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 class="text-sm font-semibold text-slate-900">RFM segments</h2>
            <p class="mt-1 text-sm text-slate-600">
              Scores are percentile bands within this selection; ties share a score.
            </p>
            <ul class="mt-4 space-y-3">
              @for (segment of segments(); track segment.key) {
                <li>
                  <div class="flex items-baseline justify-between gap-2 text-sm">
                    <span class="font-medium text-slate-800">{{ segment.label }}</span>
                    <span class="text-slate-500">
                      {{ segment.customers }}
                      @if (segment.share) {
                        · {{ percent(segment.share) }}
                      }
                    </span>
                  </div>
                  <div class="mt-1 h-2 rounded-full bg-slate-100">
                    <div
                      class="h-2 rounded-full bg-teal-500"
                      [style.width.%]="segmentWidth(segment)"
                    ></div>
                  </div>
                  <p class="mt-1 text-xs text-slate-500">{{ money(segment.net_sales) }} net</p>
                </li>
              }
            </ul>
          </div>

          <div class="rounded-2xl border border-slate-200 bg-white p-6 xl:col-span-2">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 class="text-sm font-semibold text-slate-900">Monthly retention</h2>
                <p class="mt-1 text-sm text-slate-600">
                  Cohorts by first-purchase month; columns count months since that first purchase.
                </p>
              </div>
              @if (retention(); as data) {
                @if (data.month_1_retention) {
                  <span class="rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800">
                    Month-1: {{ percent(data.month_1_retention) }}
                  </span>
                }
              }
            </div>

            @if (retention(); as data) {
              @if (!data.cohorts.length) {
                <p class="mt-6 text-sm text-slate-500">No first-purchase cohorts in this range.</p>
              } @else {
                <div class="mt-4 overflow-x-auto">
                  <table class="w-full text-left text-sm">
                    <thead class="text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th class="py-2 pr-3 font-medium">Cohort</th>
                        <th class="py-2 pr-3 font-medium">Size</th>
                        @for (column of retentionColumns(); track column) {
                          <th class="px-1 py-2 text-center font-medium">M{{ column }}</th>
                        }
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                      @for (cohort of data.cohorts; track cohort.cohort) {
                        <tr>
                          <td class="whitespace-nowrap py-2 pr-3 font-medium text-slate-800">
                            {{ cohort.cohort }}
                          </td>
                          <td class="py-2 pr-3 text-slate-600">{{ cohort.size }}</td>
                          @for (column of retentionColumns(); track column) {
                            @if (cohort.months[column]; as month) {
                              <td
                                class="px-1 py-1 text-center text-xs"
                                [class]="retentionClass(month.rate)"
                                [title]="
                                  month.month + ': ' + month.customers + ' of ' + cohort.size
                                "
                              >
                                {{ percent(month.rate, 0) }}
                              </td>
                            } @else {
                              <td class="bg-white"></td>
                            }
                          }
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
            }
          </div>
        </section>

        <section class="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div
            class="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 px-6 py-4"
          >
            <div>
              <h2 class="text-sm font-semibold text-slate-900">Customer RFM detail</h2>
              <p class="mt-1 text-sm text-slate-600">
                Search, sort and page through the selection. Customers are dataset-scoped, so the
                same source id in two datasets appears twice.
              </p>
            </div>
            <app-table-toolbar
              tableId="customers"
              [rowCount]="rfm()?.total ?? 0"
              (exportCsv)="exportCustomers()"
              (copy)="copyCustomers()"
            />
          </div>

          <div class="flex flex-wrap items-end gap-3 border-b border-slate-100 px-6 py-3">
            <label class="block min-w-52 flex-1">
              <span class="text-xs font-medium uppercase tracking-wide text-slate-500">Search</span>
              <input
                type="search"
                placeholder="Customer id"
                [value]="search()"
                (input)="searchChanged($event)"
                class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100"
              />
            </label>
            <label class="block">
              <span class="text-xs font-medium uppercase tracking-wide text-slate-500"
                >Segment</span
              >
              <select
                [value]="segmentFilter()"
                (change)="segmentFilterChanged($event)"
                class="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">All RFM segments</option>
                @for (segment of segments(); track segment.key) {
                  <option [value]="segment.key">{{ segment.label }}</option>
                }
              </select>
            </label>
            <label class="block">
              <span class="text-xs font-medium uppercase tracking-wide text-slate-500">Sort</span>
              <select
                [value]="sort()"
                (change)="sortChanged($event)"
                class="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="net">Net sales</option>
                <option value="orders">Orders</option>
                <option value="recency">Recency</option>
                <option value="last">Last purchase</option>
                <option value="customer">Customer id</option>
              </select>
            </label>
          </div>

          @if (copyStatus(); as status) {
            <p class="border-b border-slate-100 px-6 py-2 text-xs text-slate-600" role="status">
              {{ status }}
            </p>
          }

          @if (rfm(); as data) {
            @if (!data.customers.length) {
              <p class="px-6 py-6 text-sm text-slate-500">
                {{
                  focusCustomer()
                    ? 'No customer matches that id in this dataset and date range.'
                    : 'No customers match these filters.'
                }}
              </p>
            } @else {
              <div class="overflow-x-auto">
                <table class="w-full text-left text-sm">
                  <thead class="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th class="px-6 py-2.5 font-medium">Customer</th>
                      <th class="px-4 py-2.5 font-medium">Segment</th>
                      <th class="px-2 py-2.5 text-center font-medium">R</th>
                      <th class="px-2 py-2.5 text-center font-medium">F</th>
                      <th class="px-4 py-2.5 text-center font-medium">M</th>
                      <th class="px-4 py-2.5 text-right font-medium">Orders</th>
                      <th class="px-4 py-2.5 text-right font-medium">Net</th>
                      <th class="px-6 py-2.5 font-medium">Last purchase</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    @for (customer of data.customers; track customer.customer_id) {
                      <tr class="hover:bg-slate-50/60">
                        <td class="px-6" [class]="prefs.rowPadding()">
                          <a
                            [routerLink]="['/customers', customer.customer_id]"
                            class="font-medium text-slate-900 hover:text-sky-700 hover:underline"
                          >
                            {{ customer.source_customer_id }}
                          </a>
                          <a
                            [routerLink]="['/datasets', customer.dataset_id]"
                            class="block text-[11px] text-slate-500 hover:text-teal-700"
                          >
                            {{ customer.dataset_name }}
                          </a>
                        </td>
                        <td class="px-4" [class]="prefs.rowPadding()">
                          <span
                            class="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700"
                          >
                            {{ customer.segment_label }}
                          </span>
                        </td>
                        <td class="px-2 text-center text-slate-700" [class]="prefs.rowPadding()">
                          {{ customer.r }}
                        </td>
                        <td class="px-2 text-center text-slate-700" [class]="prefs.rowPadding()">
                          {{ customer.f }}
                        </td>
                        <td class="px-4 text-center text-slate-700" [class]="prefs.rowPadding()">
                          {{ customer.m }}
                        </td>
                        <td class="px-4 text-right text-slate-700" [class]="prefs.rowPadding()">
                          {{ customer.orders }}
                        </td>
                        <td
                          class="px-4 text-right font-medium text-slate-900"
                          [class]="prefs.rowPadding()"
                        >
                          {{ money(customer.net_sales) }}
                        </td>
                        <td class="px-6 text-slate-600" [class]="prefs.rowPadding()">
                          {{ date(customer.last_purchase) }}
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>

              <div
                class="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-6 py-3 text-xs text-slate-600"
              >
                <span>
                  {{ pageStart() }}–{{ pageEnd() }} of {{ data.total }}
                  {{ data.total === 1 ? 'customer' : 'customers' }}
                </span>
                <div class="flex gap-2">
                  <button
                    type="button"
                    class="rounded-lg border border-slate-300 px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                    [disabled]="offset() === 0"
                    (click)="previousPage()"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    class="rounded-lg border border-slate-300 px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                    [disabled]="pageEnd() >= data.total"
                    (click)="nextPage()"
                  >
                    Next
                  </button>
                </div>
              </div>
            }
          }
        </section>

        <section class="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="text-sm font-semibold text-slate-900">Saved segments</h2>
              <p class="mt-1 max-w-2xl text-sm text-slate-600">
                Rules are evaluated against the same RFM-scored rows as the table above, so a saved
                segment can never disagree with what you see.
              </p>
            </div>
            @if (selectedSegment()) {
              <button
                type="button"
                class="text-xs font-semibold text-slate-500 hover:text-slate-900"
                (click)="clearSegment()"
              >
                Clear selection
              </button>
            }
          </div>

          @if (segmentError(); as message) {
            <p class="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
              {{ message }}
            </p>
          }

          @if (savedSegments().length) {
            <ul class="mt-4 flex flex-wrap gap-2">
              @for (segment of savedSegments(); track segment.id) {
                <li>
                  <button
                    type="button"
                    class="rounded-full border px-3 py-1 text-xs font-medium"
                    [class]="
                      selectedSegment()?.id === segment.id
                        ? 'border-sky-500 bg-sky-50 text-sky-800'
                        : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                    "
                    (click)="openSegment(segment)"
                  >
                    {{ segment.name }}
                  </button>
                </li>
              }
            </ul>
          } @else {
            <p class="mt-3 text-sm text-slate-500">
              No saved segments yet. Describe one below and it stays available for everyone in this
              organisation.
            </p>
          }

          @if (members(); as result) {
            <div class="mt-4 rounded-xl border border-slate-200">
              <div
                class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2 text-xs text-slate-600"
              >
                <span>
                  {{ result.total }} matching customers · {{ money(result.net_sales) }} net sales
                </span>
                <span>{{ date(result.date_from) }} – {{ date(result.date_to) }}</span>
              </div>
              @if (!result.customers.length) {
                <p class="px-4 py-4 text-sm text-slate-500">
                  Nothing matches this segment in the current range.
                </p>
              } @else {
                <ul class="divide-y divide-slate-100">
                  @for (customer of result.customers; track customer.customer_id) {
                    <li class="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                      <a
                        [routerLink]="['/customers', customer.customer_id]"
                        class="font-medium text-slate-900 hover:text-sky-700 hover:underline"
                      >
                        {{ customer.source_customer_id }}
                      </a>
                      <span class="text-slate-600">
                        {{ money(customer.net_sales) }}
                        <span class="text-xs text-slate-500">
                          · {{ customer.orders }} orders · {{ customer.recency_days }}d
                        </span>
                      </span>
                    </li>
                  }
                </ul>
              }
            </div>
          }

          <form
            class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
            (submit)="saveSegment($event)"
          >
            <label class="block lg:col-span-2">
              <span class="text-xs font-medium uppercase tracking-wide text-slate-500">Name</span>
              <input
                required
                [value]="segmentDraft().name"
                (input)="patchSegmentDraft({ name: value($event) })"
                placeholder="Loyal high spenders"
                class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label class="block">
              <span class="text-xs font-medium uppercase tracking-wide text-slate-500"
                >Min orders</span
              >
              <input
                type="number"
                min="0"
                [value]="segmentDraft().orders_min"
                (input)="patchSegmentDraft({ orders_min: number($event) })"
                class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label class="block">
              <span class="text-xs font-medium uppercase tracking-wide text-slate-500"
                >Min net sales</span
              >
              <input
                type="number"
                min="0"
                step="0.01"
                [value]="segmentDraft().net_sales_min"
                (input)="patchSegmentDraft({ net_sales_min: value($event) })"
                class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label class="block">
              <span class="text-xs font-medium uppercase tracking-wide text-slate-500"
                >Max recency (days)</span
              >
              <input
                type="number"
                min="0"
                [value]="segmentDraft().recency_days_max"
                (input)="patchSegmentDraft({ recency_days_max: number($event) })"
                class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label class="block lg:col-span-2">
              <span class="text-xs font-medium uppercase tracking-wide text-slate-500"
                >RFM segment</span
              >
              <select
                [value]="segmentDraft().rfm_segment"
                (change)="patchSegmentDraft({ rfm_segment: value($event) })"
                class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Any segment</option>
                @for (segment of segments(); track segment.key) {
                  <option [value]="segment.key">{{ segment.label }}</option>
                }
              </select>
            </label>
            <div class="flex items-end lg:col-span-2">
              <button
                type="submit"
                class="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                [disabled]="savingSegment()"
              >
                Save segment
              </button>
            </div>
          </form>
        </section>
      }
    }
  `,
})
export class Customers implements OnDestroy {
  private readonly customersApi = inject(CustomersService);
  private readonly datasetsApi = inject(DatasetsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);
  readonly scope = inject(AnalysisScopeService);

  readonly focusCustomer = signal('');
  readonly summary = signal<CustomerSummary | null>(null);
  readonly rfm = signal<RfmResponse | null>(null);
  readonly retention = signal<RetentionResponse | null>(null);
  readonly allDatasets = signal<DatasetSummary[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly search = signal('');
  readonly sort = signal<RfmSort>('net');
  readonly segmentFilter = signal('');
  readonly offset = signal(0);
  readonly pageSize = 25;
  readonly copyStatus = signal<string | null>(null);

  readonly savedSegments = signal<CustomerSegment[]>([]);
  readonly selectedSegment = signal<CustomerSegment | null>(null);
  readonly members = signal<SegmentMembers | null>(null);
  readonly segmentError = signal<string | null>(null);
  readonly savingSegment = signal(false);
  readonly segmentDraft = signal({
    name: '',
    orders_min: 0,
    net_sales_min: '',
    recency_days_max: 0,
    rfm_segment: '',
  });

  readonly prefs = inject(TablePreferencesService);
  readonly pageStart = computed(() => (this.rfm()?.customers.length ? this.offset() + 1 : 0));
  readonly pageEnd = computed(() => this.offset() + (this.rfm()?.customers.length ?? 0));

  readonly availableDatasets = computed(() =>
    this.allDatasets().filter(
      (dataset) => dataset.status === 'ready' || dataset.status === 'failed',
    ),
  );

  readonly segments = computed(() => this.rfm()?.segments ?? []);
  readonly maxSegment = computed(() =>
    Math.max(1, ...this.segments().map((segment) => segment.customers)),
  );
  readonly retentionColumns = computed(() => {
    const cohorts = this.retention()?.cohorts ?? [];
    return Array.from(
      { length: Math.max(0, ...cohorts.map((cohort) => cohort.months.length)) },
      (_, index) => index,
    );
  });
  readonly currency = computed(() => this.auth.activeOrganisation()?.currency ?? 'GBP');

  private requestId = 0;
  private lastScopeKey = '';
  private lastDatasetOrganisationId: string | null = null;
  private searchTimer = 0;
  private readonly routeSubscription;

  constructor() {
    this.routeSubscription = this.route.queryParamMap.subscribe((params) => {
      this.focusCustomer.set(params.get('customer') ?? '');
    });

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
      const focus = this.focusCustomer();
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
      queryParams: { customer: null },
      queryParamsHandling: 'merge',
    });
  }

  segmentWidth(segment: RfmSegment): number {
    return Math.min(100, (segment.customers / this.maxSegment()) * 100);
  }

  retentionClass(rate: string): string {
    const value = Number(rate);
    if (!Number.isFinite(value)) {
      return 'bg-slate-50 text-slate-400';
    }
    if (value >= 75) {
      return 'bg-teal-600 text-white';
    }
    if (value >= 50) {
      return 'bg-teal-400 text-teal-950';
    }
    if (value >= 25) {
      return 'bg-teal-200 text-teal-900';
    }
    if (value > 0) {
      return 'bg-teal-50 text-teal-900';
    }
    return 'bg-slate-50 text-slate-400';
  }

  money(value: string | null): string {
    return formatMoney(value, this.currency());
  }

  percent(value: string | null, digits = 2): string {
    return formatPercent(value, digits);
  }

  date(value: string | null): string {
    return formatDate(value);
  }

  async load(focus = this.focusCustomer()): Promise<void> {
    const request = ++this.requestId;
    this.loading.set(true);
    this.error.set(null);
    this.offset.set(0);
    const query = this.scope.query();

    try {
      const [summary, rfm, retention] = await Promise.all([
        this.customersApi.summary(query),
        this.customersApi.rfm(
          {
            ...query,
            search: this.search() || focus || undefined,
            segment: this.segmentFilter() || undefined,
            sort: this.sort(),
            limit: this.pageSize,
            offset: 0,
          },
          this.pageSize,
        ),
        this.customersApi.retention(query),
      ]);
      if (request === this.requestId) {
        this.summary.set(summary);
        this.rfm.set(rfm);
        this.retention.set(retention);
      }
      void this.loadSegments();
      if (this.selectedSegment()) {
        await this.loadMembers();
      }
    } catch (error) {
      if (request === this.requestId) {
        this.summary.set(null);
        this.rfm.set(null);
        this.retention.set(null);
        this.error.set(apiErrorMessage(error, 'Customer analytics could not be loaded.'));
      }
    } finally {
      if (request === this.requestId) {
        this.loading.set(false);
      }
    }
  }

  async loadTable(): Promise<void> {
    try {
      const rfm = await this.customersApi.rfm(
        {
          ...this.scope.query(),
          search: this.search() || this.focusCustomer() || undefined,
          segment: this.segmentFilter() || undefined,
          sort: this.sort(),
          limit: this.pageSize,
          offset: this.offset(),
        },
        this.pageSize,
      );
      this.rfm.set(rfm);
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'The customer table could not be refreshed.'));
    }
  }

  searchChanged(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.search.set(value);
    this.offset.set(0);
    window.clearTimeout(this.searchTimer);
    this.searchTimer = window.setTimeout(() => void this.loadTable(), 300);
  }

  segmentFilterChanged(event: Event): void {
    this.segmentFilter.set((event.target as HTMLSelectElement).value);
    this.offset.set(0);
    void this.loadTable();
  }

  sortChanged(event: Event): void {
    this.sort.set((event.target as HTMLSelectElement).value as RfmSort);
    this.offset.set(0);
    void this.loadTable();
  }

  previousPage(): void {
    this.offset.set(Math.max(0, this.offset() - this.pageSize));
    void this.loadTable();
  }

  nextPage(): void {
    this.offset.set(this.offset() + this.pageSize);
    void this.loadTable();
  }

  value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  number(event: Event): number {
    return Number((event.target as HTMLInputElement).value) || 0;
  }

  patchSegmentDraft(change: Partial<SegmentDraft>): void {
    this.segmentDraft.update((draft) => ({ ...draft, ...change }));
  }

  async saveSegment(event: Event): Promise<void> {
    event.preventDefault();
    const draft = this.segmentDraft();
    const rules: SegmentRules = {
      ...(draft.orders_min > 0 ? { orders_min: draft.orders_min } : {}),
      ...(draft.net_sales_min !== '' ? { net_sales_min: draft.net_sales_min } : {}),
      ...(draft.recency_days_max > 0 ? { recency_days_max: draft.recency_days_max } : {}),
      ...(draft.rfm_segment ? { rfm_segment: draft.rfm_segment } : {}),
    };
    if (!draft.name.trim()) {
      this.segmentError.set('Give the segment a name.');
      return;
    }
    if (!Object.keys(rules).length) {
      this.segmentError.set('Add at least one rule to the segment.');
      return;
    }

    this.savingSegment.set(true);
    this.segmentError.set(null);
    try {
      const segment = await this.customersApi.createSegment({
        name: draft.name.trim(),
        dataset: this.scope.dataset() || null,
        rules,
      });
      this.segmentDraft.set({
        name: '',
        orders_min: 0,
        net_sales_min: '',
        recency_days_max: 0,
        rfm_segment: '',
      });
      await this.loadSegments();
      await this.openSegment(segment);
    } catch (error) {
      this.segmentError.set(apiErrorMessage(error, 'The segment could not be saved.'));
    } finally {
      this.savingSegment.set(false);
    }
  }

  async openSegment(segment: CustomerSegment): Promise<void> {
    this.selectedSegment.set(segment);
    await this.loadMembers();
  }

  clearSegment(): void {
    this.selectedSegment.set(null);
    this.members.set(null);
    this.segmentError.set(null);
  }

  exportCustomers(): void {
    const rows = this.rfm()?.customers ?? [];
    downloadCsv(
      'customers',
      [
        { header: 'Customer id', value: (row) => row.source_customer_id },
        { header: 'Dataset', value: (row) => row.dataset_name },
        { header: 'Segment', value: (row) => row.segment_label },
        { header: 'Recency days', value: (row) => row.recency_days },
        { header: 'R', value: (row) => row.r },
        { header: 'F', value: (row) => row.f },
        { header: 'M', value: (row) => row.m },
        { header: 'Orders', value: (row) => row.orders },
        { header: 'Net sales', value: (row) => row.net_sales },
        { header: 'Last purchase', value: (row) => row.last_purchase },
      ],
      rows,
    );
  }

  async copyCustomers(): Promise<void> {
    const ok = await copyTable(
      [
        { header: 'Customer', value: (row) => row.source_customer_id },
        { header: 'Segment', value: (row) => row.segment_label },
        { header: 'Orders', value: (row) => row.orders },
        { header: 'Net sales', value: (row) => row.net_sales },
      ],
      this.rfm()?.customers ?? [],
    );
    this.copyStatus.set(ok ? 'Copied to the clipboard.' : 'Copy failed.');
  }

  private async loadSegments(): Promise<void> {
    try {
      this.savedSegments.set(await this.customersApi.segments());
    } catch {
      // Segments are an extra; the RFM table still works without them.
    }
  }

  private async loadMembers(): Promise<void> {
    const segment = this.selectedSegment();
    if (!segment) {
      return;
    }
    try {
      this.members.set(await this.customersApi.segmentMembers(segment.id, this.scope.query()));
      this.segmentError.set(null);
    } catch (error) {
      this.members.set(null);
      this.segmentError.set(apiErrorMessage(error, 'The segment could not be evaluated.'));
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

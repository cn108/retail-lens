import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { CustomerDetail, CustomersService } from '../../core/api/customers.service';
import { AnalysisPage } from '../../core/analysis/analysis-page';
import { AnalysisQuery } from '../../core/analysis/analysis-scope.service';
import { AnalysisFilterBar } from '../../shared/analysis-filter-bar';
import { LoadingState } from '../../shared/loading-state';
import { MetricInfo } from '../../shared/metric-info';
import { downloadCsv } from '../../shared/table-tools';

@Component({
  selector: 'app-customer-detail',
  imports: [RouterLink, AnalysisFilterBar, LoadingState, MetricInfo],
  template: `
    <nav class="mb-4 text-sm text-slate-500">
      <a routerLink="/customers" class="hover:text-sky-700 hover:underline">Customers</a>
      <span class="mx-2">/</span>
      <span class="text-slate-700">{{ detail()?.customer?.source_customer_id ?? 'Customer' }}</span>
    </nav>

    @if (notFound()) {
      <section class="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <h1 class="text-lg font-semibold text-slate-900">Customer not found</h1>
        <p class="mx-auto mt-2 max-w-xl text-sm text-slate-600">
          They may belong to another organisation, or the dataset was reprocessed.
        </p>
        <a
          routerLink="/customers"
          class="mt-4 inline-block rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Back to customers
        </a>
      </section>
    } @else {
      <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
            Customer drill-down
          </p>
          <h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
            {{ detail()?.customer?.source_customer_id ?? 'Customer' }}
          </h1>
          @if (detail()?.customer; as customer) {
            <p class="mt-2 text-sm text-slate-600">{{ customer.dataset_name }}</p>
          }
        </div>
        @if (detail(); as data) {
          @if (data.has_data && data.segment_label) {
            <span class="rounded-full bg-sky-50 px-3 py-1 text-sm font-medium text-sky-700">
              {{ data.segment_label }}
            </span>
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
        <app-loading-state label="Loading customer history" />
      } @else if (detail(); as data) {
        @if (!data.has_data) {
          <section
            class="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"
          >
            <h2 class="text-lg font-semibold text-slate-900">No orders in this range</h2>
            <p class="mx-auto mt-2 max-w-xl text-sm text-slate-600">
              This customer has no sales or returns inside the selected period.
            </p>
          </section>
        } @else {
          <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <article class="rounded-2xl border border-slate-200 bg-white p-5">
              <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Net sales</p>
              <p class="mt-2 text-2xl font-semibold text-slate-900">{{ money(data.net_sales) }}</p>
              <p class="mt-1 text-xs text-slate-500">
                {{ data.share_of_net_sales ? rate(data.share_of_net_sales) : '—' }} of the selection
              </p>
            </article>
            <article class="rounded-2xl border border-slate-200 bg-white p-5">
              <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Orders</p>
              <p class="mt-2 text-2xl font-semibold text-slate-900">{{ data.orders }}</p>
              <p class="mt-1 text-xs text-slate-500">
                Average {{ data.average_order_value ? money(data.average_order_value) : '—' }}
              </p>
            </article>
            <article class="rounded-2xl border border-slate-200 bg-white p-5">
              <p class="text-xs font-medium uppercase tracking-wide text-slate-500">
                <app-metric-info
                  label="Recency"
                  definition="Days since the customer's last purchase in the selected range. Lower is better for engagement."
                />
              </p>
              <p class="mt-2 text-2xl font-semibold text-slate-900">
                {{ data.recency_days ?? '—' }}
                <span class="text-sm font-normal text-slate-500">days</span>
              </p>
              <p class="mt-1 text-xs text-slate-500">
                RFM {{ data.r ?? '—' }} · {{ data.f ?? '—' }} · {{ data.m ?? '—' }}
              </p>
            </article>
            <article class="rounded-2xl border border-slate-200 bg-white p-5">
              <p class="text-xs font-medium uppercase tracking-wide text-slate-500">
                Lifespan in range
              </p>
              <p class="mt-2 text-base font-semibold text-slate-900">
                {{ date(data.first_purchase) }} – {{ date(data.last_purchase) }}
              </p>
              <p class="mt-1 text-xs text-slate-500">
                Selection average {{ money(data.selection_average_net_sales) }}
              </p>
            </article>
          </section>

          <section class="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div
              class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4"
            >
              <div>
                <h2 class="text-sm font-semibold text-slate-900">Recent orders</h2>
                <p class="mt-1 text-sm text-slate-600">The last 20 invoices, newest first.</p>
              </div>
              <button
                type="button"
                class="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                (click)="exportTimeline()"
              >
                Export CSV
              </button>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead class="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th class="px-5 py-2.5 font-medium">Invoice</th>
                    <th class="px-4 py-2.5 font-medium">Date</th>
                    <th class="px-4 py-2.5 text-right font-medium">Lines</th>
                    <th class="px-4 py-2.5 text-right font-medium">Units</th>
                    <th class="px-5 py-2.5 text-right font-medium">Net sales</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  @for (order of data.timeline; track order.invoice) {
                    <tr class="hover:bg-slate-50/60">
                      <td class="px-5 py-2.5 font-medium text-slate-900">{{ order.invoice }}</td>
                      <td class="px-4 text-slate-700">{{ date(order.date) }}</td>
                      <td class="px-4 text-right text-slate-700">{{ order.lines }}</td>
                      <td class="px-4 text-right text-slate-700">{{ order.units }}</td>
                      <td class="px-5 text-right font-medium text-slate-900">
                        {{ money(order.net_sales) }}
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>

          <section class="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div class="border-b border-slate-100 px-5 py-4">
              <h2 class="text-sm font-semibold text-slate-900">Products bought</h2>
              <p class="mt-1 text-sm text-slate-600">Top 10 by net sales in the selected range.</p>
            </div>
            @if (!data.products.length) {
              <p class="px-5 py-6 text-sm text-slate-500">No product lines for this customer.</p>
            } @else {
              <div class="overflow-x-auto">
                <table class="w-full text-left text-sm">
                  <thead class="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th class="px-5 py-2.5 font-medium">Product</th>
                      <th class="px-4 py-2.5 text-right font-medium">Units</th>
                      <th class="px-4 py-2.5 text-right font-medium">Orders</th>
                      <th class="px-5 py-2.5 text-right font-medium">Net sales</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    @for (product of data.products; track product.product_id) {
                      <tr class="hover:bg-slate-50/60">
                        <td class="px-5 py-2.5">
                          <a
                            [routerLink]="['/products', product.product_id]"
                            class="font-medium text-slate-900 hover:text-sky-700 hover:underline"
                          >
                            {{ product.description || product.source_product_code }}
                          </a>
                          <span class="block text-[11px] text-slate-500">
                            {{ product.source_product_code }}
                          </span>
                        </td>
                        <td class="px-4 text-right text-slate-700">{{ product.units }}</td>
                        <td class="px-4 text-right text-slate-700">{{ product.orders }}</td>
                        <td class="px-5 text-right font-medium text-slate-900">
                          {{ money(product.net_sales) }}
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </section>
        }
      }
    }
  `,
})
export class CustomerDetailPage extends AnalysisPage {
  private readonly route = inject(ActivatedRoute);
  private readonly customersApi = inject(CustomersService);

  readonly detail = signal<CustomerDetail | null>(null);
  readonly notFound = signal(false);
  readonly customerId = computed(() => this.route.snapshot.paramMap.get('id') ?? '');

  protected async fetch(query: AnalysisQuery, request: number): Promise<void> {
    try {
      const result = await this.customersApi.customer(this.customerId(), query);
      if (this.isCurrent(request)) {
        this.detail.set(result);
        this.notFound.set(false);
      }
    } catch (error) {
      if (this.isCurrent(request) && error instanceof HttpErrorResponse && error.status === 404) {
        this.detail.set(null);
        this.notFound.set(true);
        return;
      }
      throw error;
    }
  }

  exportTimeline(): void {
    const data = this.detail();
    if (!data) {
      return;
    }
    downloadCsv(
      `customer-${data.customer?.source_customer_id ?? 'detail'}-orders`,
      [
        { header: 'Invoice', value: (row) => row.invoice },
        { header: 'Date', value: (row) => row.date },
        { header: 'Lines', value: (row) => row.lines },
        { header: 'Units', value: (row) => row.units },
        { header: 'Net sales', value: (row) => row.net_sales },
      ],
      data.timeline,
    );
  }
}

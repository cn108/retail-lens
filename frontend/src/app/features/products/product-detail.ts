import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { ProductDetail } from '../../core/api/analytics.service';
import { AnalysisPage } from '../../core/analysis/analysis-page';
import { AnalysisQuery } from '../../core/analysis/analysis-scope.service';
import { AnalysisFilterBar } from '../../shared/analysis-filter-bar';
import { LoadingState } from '../../shared/loading-state';
import { MetricInfo } from '../../shared/metric-info';
import { downloadCsv } from '../../shared/table-tools';

@Component({
  selector: 'app-product-detail',
  imports: [RouterLink, AnalysisFilterBar, LoadingState, MetricInfo],
  template: `
    <nav class="mb-4 text-sm text-slate-500">
      <a routerLink="/products" class="hover:text-sky-700 hover:underline">Products</a>
      <span class="mx-2">/</span>
      <span class="text-slate-700">{{ detail()?.product?.source_product_code ?? 'Product' }}</span>
    </nav>

    @if (notFound()) {
      <section class="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <h1 class="text-lg font-semibold text-slate-900">Product not found</h1>
        <p class="mx-auto mt-2 max-w-xl text-sm text-slate-600">
          It may belong to another organisation, or the dataset was reprocessed and replaced it.
        </p>
        <a
          routerLink="/products"
          class="mt-4 inline-block rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Back to products
        </a>
      </section>
    } @else {
      <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div class="min-w-0">
          <p class="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
            Product drill-down
          </p>
          <h1 class="mt-2 truncate text-3xl font-semibold tracking-tight text-slate-950">
            {{
              detail()?.product?.description || detail()?.product?.source_product_code || 'Product'
            }}
          </h1>
          @if (detail()?.product; as product) {
            <p class="mt-2 text-sm text-slate-600">
              {{ product.source_product_code }} · {{ product.dataset_name }}
            </p>
          }
        </div>
        @if (detail(); as data) {
          @if (data.has_data) {
            <div class="text-right text-sm text-slate-600">
              {{ date(data.date_from) }} – {{ date(data.date_to) }}
              <span class="block text-xs text-slate-500">
                vs {{ date(data.comparison_date_from) }} – {{ date(data.comparison_date_to) }}
              </span>
            </div>
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
        <app-loading-state label="Loading product detail" />
      } @else if (detail(); as data) {
        @if (!data.has_data) {
          <section
            class="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"
          >
            <h2 class="text-lg font-semibold text-slate-900">No activity in this range</h2>
            <p class="mx-auto mt-2 max-w-xl text-sm text-slate-600">
              This product has no sales or returns inside the selected period.
            </p>
            <a
              routerLink="/products"
              class="mt-4 inline-block rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Back to products
            </a>
          </section>
        } @else {
          <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <article class="rounded-2xl border border-slate-200 bg-white p-5">
              <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Net sales</p>
              <p class="mt-2 text-2xl font-semibold text-slate-900">{{ money(data.net_sales) }}</p>
              <p class="mt-1 text-xs text-slate-500">was {{ money(data.previous_net_sales) }}</p>
            </article>
            <article class="rounded-2xl border border-slate-200 bg-white p-5">
              <p class="text-xs font-medium uppercase tracking-wide text-slate-500">
                <app-metric-info
                  label="Contribution"
                  definition="This product's net sales divided by net sales across the selected scope."
                />
              </p>
              <p class="mt-2 text-2xl font-semibold text-slate-900">
                {{ data.share ? rate(data.share) : '—' }}
              </p>
              <p class="mt-1 text-xs text-slate-500">Share of the selected scope</p>
            </article>
            <article class="rounded-2xl border border-slate-200 bg-white p-5">
              <p class="text-xs font-medium uppercase tracking-wide text-slate-500">
                Units &amp; orders
              </p>
              <p class="mt-2 text-2xl font-semibold text-slate-900">{{ data.units }}</p>
              <p class="mt-1 text-xs text-slate-500">
                {{ data.orders }} orders · {{ data.returned_units }} returned units
              </p>
            </article>
            <article class="rounded-2xl border border-slate-200 bg-white p-5">
              <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Change</p>
              <p
                class="mt-2 text-2xl font-semibold"
                [class]="
                  data.change_percent === null
                    ? 'text-slate-500'
                    : data.change_percent.startsWith('-')
                      ? 'text-amber-700'
                      : 'text-teal-700'
                "
              >
                {{ percent(data.change_percent) }}
              </p>
              <p class="mt-1 text-xs text-slate-500">Return rate {{ rate(data.return_rate) }}</p>
            </article>
          </section>

          <section class="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div
              class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4"
            >
              <div>
                <h2 class="text-sm font-semibold text-slate-900">Monthly trend</h2>
                <p class="mt-1 text-sm text-slate-600">Net sales, units and orders per month.</p>
              </div>
              <button
                type="button"
                class="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                (click)="exportTrend()"
              >
                Export CSV
              </button>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead class="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th class="px-5 py-2.5 font-medium">Month</th>
                    <th class="px-4 py-2.5 text-right font-medium">Net sales</th>
                    <th class="px-4 py-2.5 text-right font-medium">Units</th>
                    <th class="px-4 py-2.5 text-right font-medium">Orders</th>
                    <th class="px-5 py-2.5 text-right font-medium">Returned units</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  @for (row of data.trend; track row.month) {
                    <tr class="hover:bg-slate-50/60">
                      <td class="px-5 py-2.5 text-slate-700">{{ row.label }}</td>
                      <td class="px-4 text-right font-medium text-slate-900">
                        {{ money(row.net_sales) }}
                      </td>
                      <td class="px-4 text-right text-slate-700">{{ row.units }}</td>
                      <td class="px-4 text-right text-slate-700">{{ row.orders }}</td>
                      <td class="px-5 text-right text-slate-700">{{ row.returned_units }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>

          <div class="mt-6 grid gap-4 lg:grid-cols-2">
            <section class="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div class="border-b border-slate-100 px-5 py-4">
                <h2 class="text-sm font-semibold text-slate-900">Top customers</h2>
                <p class="mt-1 text-sm text-slate-600">Who buys this product, by net sales.</p>
              </div>
              @if (!data.customers.length) {
                <p class="px-5 py-6 text-sm text-slate-500">No identifiable customers.</p>
              } @else {
                <ul class="divide-y divide-slate-100">
                  @for (customer of data.customers; track customer.customer_id) {
                    <li class="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                      <a
                        [routerLink]="['/customers', customer.customer_id]"
                        class="font-medium text-slate-900 hover:text-sky-700 hover:underline"
                      >
                        {{ customer.source_customer_id }}
                      </a>
                      <span class="text-slate-600">
                        {{ money(customer.net_sales) }}
                        <span class="text-xs text-slate-500">· {{ customer.orders }} orders</span>
                      </span>
                    </li>
                  }
                </ul>
              }
            </section>

            <section class="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div class="border-b border-slate-100 px-5 py-4">
                <h2 class="text-sm font-semibold text-slate-900">Countries</h2>
                <p class="mt-1 text-sm text-slate-600">Where this product sells.</p>
              </div>
              @if (!data.countries.length) {
                <p class="px-5 py-6 text-sm text-slate-500">No geography mapped.</p>
              } @else {
                <ul class="divide-y divide-slate-100">
                  @for (country of data.countries; track country.country) {
                    <li class="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                      <span class="text-slate-700">{{ country.country }}</span>
                      <span class="text-slate-600">
                        {{ money(country.net_sales) }}
                        <span class="text-xs text-slate-500">· {{ country.units }} units</span>
                      </span>
                    </li>
                  }
                </ul>
              }
            </section>
          </div>
        }
      }
    }
  `,
})
export class ProductDetailPage extends AnalysisPage {
  private readonly route = inject(ActivatedRoute);

  readonly detail = signal<ProductDetail | null>(null);
  readonly notFound = signal(false);
  readonly productId = computed(() => this.route.snapshot.paramMap.get('id') ?? '');

  protected async fetch(query: AnalysisQuery, request: number): Promise<void> {
    try {
      const result = await this.analytics.productDetail(this.productId(), query);
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

  exportTrend(): void {
    const rows = this.detail()?.trend ?? [];
    downloadCsv(
      `product-${this.detail()?.product?.source_product_code ?? 'detail'}-trend`,
      [
        { header: 'Month', value: (row) => row.month },
        { header: 'Net sales', value: (row) => row.net_sales },
        { header: 'Units', value: (row) => row.units },
        { header: 'Orders', value: (row) => row.orders },
        { header: 'Returned units', value: (row) => row.returned_units },
      ],
      rows,
    );
  }
}

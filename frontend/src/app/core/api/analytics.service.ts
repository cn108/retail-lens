import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from './api.config';

export type Granularity = 'day' | 'week' | 'month';
export type CompareMode = 'previous' | 'year' | 'custom';

export interface SalesQuery {
  dataset?: string;
  date_from?: string;
  date_to?: string;
  compare?: CompareMode;
  compare_from?: string;
  compare_to?: string;
}

export interface SalesSummary {
  has_data: boolean;
  compare?: CompareMode;
  date_from: string | null;
  date_to: string | null;
  comparison_date_from: string | null;
  comparison_date_to: string | null;
  gross_sales: string;
  net_sales: string;
  eligible_orders: number;
  average_order_value: string | null;
  unique_customers: number;
  sales_growth_percent: string | null;
  previous_net_sales: string;
  datasets: { id: string; name: string }[];
}

export interface SalesTrendPoint {
  period_start: string;
  period_end: string;
  label: string;
  gross_sales: string;
  net_sales: string;
  orders: number;
}

export interface SalesTrendComparison {
  date_from: string;
  date_to: string;
  points: SalesTrendPoint[];
}

export interface SalesTrend {
  granularity: Granularity;
  has_data: boolean;
  date_from: string | null;
  date_to: string | null;
  compare?: CompareMode | null;
  comparison?: SalesTrendComparison | null;
  points: SalesTrendPoint[];
}

export interface ProductRow {
  product_id: string;
  source_product_code: string;
  description: string;
  dataset_id: string;
  dataset_name: string;
  net_sales: string;
  gross_sales: string;
  share: string | null;
  units: number;
  orders: number;
  returned_units: number;
  return_lines: number;
  previous_net_sales: string;
  change_percent: string | null;
  direction: string;
}

export interface ProductPerformance {
  has_data: boolean;
  compare?: CompareMode;
  date_from: string | null;
  date_to: string | null;
  comparison_date_from: string | null;
  comparison_date_to: string | null;
  net_sales: string;
  product_count: number;
  top_product_share: string | null;
  declining_products: number;
  rows: ProductRow[];
}

export interface ProductTrendPoint {
  month: string;
  label: string;
  net_sales: string;
  units: number;
  orders: number;
  returned_units: number;
}

export interface ProductDetail {
  has_data: boolean;
  product: {
    product_id: string;
    source_product_code: string;
    description: string;
    dataset_id: string;
    dataset_name: string;
  } | null;
  compare: CompareMode;
  date_from: string | null;
  date_to: string | null;
  comparison_date_from: string | null;
  comparison_date_to: string | null;
  net_sales: string;
  gross_sales: string;
  units: number;
  orders: number;
  returned_units: number;
  return_rate: string | null;
  share: string | null;
  previous_net_sales: string;
  change_percent: string | null;
  trend: ProductTrendPoint[];
  customers: {
    customer_id: string;
    source_customer_id: string;
    net_sales: string;
    orders: number;
    last_purchase: string;
  }[];
  countries: { country: string; net_sales: string; units: number }[];
}

export interface GeographyRow {
  country: string;
  net_sales: string;
  gross_sales: string;
  discount_total: string;
  share: string | null;
  units: number;
  orders: number;
  customers: number;
  returned_units: number;
  return_value: string;
  return_rate: string | null;
  previous_net_sales: string;
  change_percent: string | null;
  direction: string;
}

export interface GeographyPerformance {
  has_data: boolean;
  compare: CompareMode;
  date_from: string | null;
  date_to: string | null;
  comparison_date_from: string | null;
  comparison_date_to: string | null;
  net_sales: string;
  country_count: number;
  top_country_share: string | null;
  rows: GeographyRow[];
}

export interface ReturnsAnalysis {
  has_data: boolean;
  date_from: string | null;
  date_to: string | null;
  sales_lines: number;
  return_lines: number;
  sold_units: number;
  returned_units: number;
  return_rate: string | null;
  gross_sales: string;
  discount_total: string;
  discount_rate: string | null;
  return_value: string;
  net_sales: string;
  bridge: { label: string; amount: string }[];
  products: {
    product_id: string;
    source_product_code: string;
    description: string;
    dataset_id: string;
    dataset_name: string;
    returned_units: number;
    return_lines: number;
    return_value: string;
    sold_units: number;
    return_rate: string | null;
    net_sales: string;
  }[];
  countries: {
    country: string;
    sold_units: number;
    returned_units: number;
    return_value: string;
    return_rate: string | null;
  }[];
}

export interface BasketPair {
  product_a: { product_id: string; source_product_code: string; description: string };
  product_b: { product_id: string; source_product_code: string; description: string };
  invoices: number;
  support: string;
  confidence_a_to_b: string;
  confidence_b_to_a: string;
  lift: string | null;
}

export interface BasketAnalysis {
  has_data: boolean;
  date_from: string | null;
  date_to: string | null;
  invoices: number;
  pairs: BasketPair[];
}

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly http = inject(HttpClient);

  async summary(query: SalesQuery = {}): Promise<SalesSummary> {
    return firstValueFrom(
      this.http.get<SalesSummary>(`${API_BASE_URL}/analytics/sales/summary`, {
        params: this.params(query),
      }),
    );
  }

  async trend(query: SalesQuery & { granularity?: Granularity } = {}): Promise<SalesTrend> {
    let params = this.params(query);
    if (query.granularity) {
      params = params.set('granularity', query.granularity);
    }
    return firstValueFrom(
      this.http.get<SalesTrend>(`${API_BASE_URL}/analytics/sales/trend`, { params }),
    );
  }

  async products(
    query: SalesQuery & { search?: string; limit?: number } = {},
  ): Promise<ProductPerformance> {
    let params = this.params(query);
    if (query.search) {
      params = params.set('search', query.search);
    }
    if (query.limit) {
      params = params.set('limit', String(query.limit));
    }
    return firstValueFrom(
      this.http.get<ProductPerformance>(`${API_BASE_URL}/analytics/products/performance`, {
        params,
      }),
    );
  }

  async productDetail(productId: string, query: SalesQuery = {}): Promise<ProductDetail> {
    return firstValueFrom(
      this.http.get<ProductDetail>(`${API_BASE_URL}/analytics/products/${productId}`, {
        params: this.params({
          date_from: query.date_from,
          date_to: query.date_to,
          compare: query.compare,
          compare_from: query.compare_from,
          compare_to: query.compare_to,
        }),
      }),
    );
  }

  async geography(query: SalesQuery = {}): Promise<GeographyPerformance> {
    return firstValueFrom(
      this.http.get<GeographyPerformance>(`${API_BASE_URL}/analytics/geography/performance`, {
        params: this.params(query),
      }),
    );
  }

  async returns(query: SalesQuery = {}): Promise<ReturnsAnalysis> {
    return firstValueFrom(
      this.http.get<ReturnsAnalysis>(`${API_BASE_URL}/analytics/returns`, {
        params: this.params(query),
      }),
    );
  }

  async basket(query: SalesQuery = {}): Promise<BasketAnalysis> {
    return firstValueFrom(
      this.http.get<BasketAnalysis>(`${API_BASE_URL}/analytics/basket`, {
        params: this.params(query),
      }),
    );
  }

  private params(query: SalesQuery): HttpParams {
    let params = new HttpParams();
    if (query.dataset) {
      params = params.set('dataset', query.dataset);
    }
    if (query.date_from) {
      params = params.set('date_from', query.date_from);
    }
    if (query.date_to) {
      params = params.set('date_to', query.date_to);
    }
    if (query.compare && query.compare !== 'previous') {
      params = params.set('compare', query.compare);
    }
    if (query.compare === 'custom' && query.compare_from) {
      params = params.set('compare_from', query.compare_from);
    }
    if (query.compare === 'custom' && query.compare_to) {
      params = params.set('compare_to', query.compare_to);
    }
    return params;
  }
}

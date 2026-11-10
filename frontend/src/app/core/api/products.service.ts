import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from './api.config';

export type ProductDirection = 'growing' | 'stable' | 'declining' | 'new' | 'returns';

export interface ProductQuery {
  dataset?: string;
  date_from?: string;
  date_to?: string;
  search?: string;
  compare?: 'previous' | 'year' | 'custom';
  compare_from?: string;
  compare_to?: string;
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
  direction: ProductDirection;
}

export interface ProductPerformance {
  has_data: boolean;
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

@Injectable({ providedIn: 'root' })
export class ProductsService {
  private readonly http = inject(HttpClient);

  async performance(query: ProductQuery = {}, limit = 50): Promise<ProductPerformance> {
    return firstValueFrom(
      this.http.get<ProductPerformance>(`${API_BASE_URL}/analytics/products/performance`, {
        params: this.params(query).set('limit', String(limit)),
      }),
    );
  }

  private params(query: ProductQuery): HttpParams {
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
    if (query.search) {
      params = params.set('search', query.search);
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

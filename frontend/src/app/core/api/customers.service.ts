import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from './api.config';

export type RfmSort = 'net' | 'orders' | 'recency' | 'last' | 'customer';

export interface CustomerQuery {
  dataset?: string;
  date_from?: string;
  date_to?: string;
  search?: string;
  segment?: string;
  sort?: RfmSort;
  limit?: number;
  offset?: number;
}

export interface CustomerSummary {
  has_data: boolean;
  date_from: string | null;
  date_to: string | null;
  identifiable_customers: number;
  repeat_customers: number;
  repeat_purchase_rate: string | null;
  average_orders: string | null;
  historical_value: string;
  average_historical_value: string | null;
  month_1_retention: string | null;
  cohort_count: number;
}

export interface RfmCustomer {
  customer_id: string;
  source_customer_id: string;
  dataset_id: string;
  dataset_name: string;
  last_purchase: string;
  recency_days: number;
  orders: number;
  net_sales: string;
  r: number;
  f: number;
  m: number;
  segment: string;
  segment_label: string;
}

export interface RfmSegment {
  key: string;
  label: string;
  customers: number;
  net_sales: string;
  share: string | null;
}

export interface RfmResponse {
  has_data: boolean;
  date_from: string | null;
  date_to: string | null;
  as_of: string | null;
  total: number;
  customers: RfmCustomer[];
  segments: RfmSegment[];
}

export interface CustomerDetail {
  has_data: boolean;
  customer: {
    customer_id: string;
    source_customer_id: string;
    dataset_id: string;
    dataset_name: string;
  } | null;
  date_from: string | null;
  date_to: string | null;
  orders: number;
  net_sales: string;
  first_purchase: string | null;
  last_purchase: string | null;
  average_order_value: string | null;
  share_of_net_sales: string | null;
  segment: string | null;
  segment_label: string | null;
  recency_days: number | null;
  r: number | null;
  f: number | null;
  m: number | null;
  selection_average_net_sales: string | null;
  timeline: { invoice: string; date: string; net_sales: string; lines: number; units: number }[];
  products: {
    product_id: string;
    source_product_code: string;
    description: string;
    net_sales: string;
    units: number;
    orders: number;
  }[];
}

export interface SegmentRules {
  recency_days_max?: number | null;
  recency_days_min?: number | null;
  orders_min?: number | null;
  net_sales_min?: string | number | null;
  rfm_segment?: string | null;
  rfm_score_min?: number | null;
}

export interface CustomerSegment {
  id: string;
  name: string;
  description: string;
  dataset: string | null;
  rules: SegmentRules;
  created_at: string;
  updated_at: string;
}

export interface SegmentMembers {
  has_data: boolean;
  date_from: string | null;
  date_to: string | null;
  total: number;
  net_sales: string;
  customers: {
    customer_id: string;
    source_customer_id: string;
    dataset_id: string;
    dataset_name: string;
    segment: string;
    segment_label: string;
    recency_days: number;
    orders: number;
    net_sales: string;
    last_purchase: string;
  }[];
}

export interface RetentionMonth {
  month_offset: number;
  month: string;
  customers: number;
  rate: string;
}

export interface RetentionCohort {
  cohort: string;
  size: number;
  months: RetentionMonth[];
}

export interface RetentionResponse {
  has_data: boolean;
  date_from: string | null;
  date_to: string | null;
  month_1_retention: string | null;
  cohorts: RetentionCohort[];
}

@Injectable({ providedIn: 'root' })
export class CustomersService {
  private readonly http = inject(HttpClient);

  async summary(query: CustomerQuery = {}): Promise<CustomerSummary> {
    return firstValueFrom(
      this.http.get<CustomerSummary>(`${API_BASE_URL}/customers/summary`, {
        params: this.params(query),
      }),
    );
  }

  async rfm(query: CustomerQuery = {}, limit = 50): Promise<RfmResponse> {
    let params = this.params(query).set('limit', String(limit));
    if (query.offset) {
      params = params.set('offset', String(query.offset));
    }
    if (query.segment) {
      params = params.set('segment', query.segment);
    }
    if (query.sort) {
      params = params.set('sort', query.sort);
    }
    return firstValueFrom(this.http.get<RfmResponse>(`${API_BASE_URL}/customers/rfm`, { params }));
  }

  async customer(customerId: string, query: CustomerQuery = {}): Promise<CustomerDetail> {
    return firstValueFrom(
      this.http.get<CustomerDetail>(`${API_BASE_URL}/customers/${customerId}`, {
        params: this.params({ date_from: query.date_from, date_to: query.date_to }),
      }),
    );
  }

  async segments(): Promise<CustomerSegment[]> {
    const response = await firstValueFrom(
      this.http.get<{ segments: CustomerSegment[] }>(`${API_BASE_URL}/customers/segments`),
    );
    return response.segments;
  }

  async createSegment(payload: {
    name: string;
    description?: string;
    dataset?: string | null;
    rules: SegmentRules;
  }): Promise<CustomerSegment> {
    return firstValueFrom(
      this.http.post<CustomerSegment>(`${API_BASE_URL}/customers/segments`, payload),
    );
  }

  async updateSegment(
    id: string,
    payload: { name?: string; description?: string; rules?: SegmentRules },
  ): Promise<CustomerSegment> {
    return firstValueFrom(
      this.http.patch<CustomerSegment>(`${API_BASE_URL}/customers/segments/${id}`, payload),
    );
  }

  async deleteSegment(id: string): Promise<void> {
    await firstValueFrom(this.http.delete<void>(`${API_BASE_URL}/customers/segments/${id}`));
  }

  async segmentMembers(id: string, query: CustomerQuery = {}): Promise<SegmentMembers> {
    return firstValueFrom(
      this.http.get<SegmentMembers>(`${API_BASE_URL}/customers/segments/${id}/members`, {
        params: this.params(query),
      }),
    );
  }

  async retention(query: CustomerQuery = {}): Promise<RetentionResponse> {
    return firstValueFrom(
      this.http.get<RetentionResponse>(`${API_BASE_URL}/customers/retention`, {
        params: this.params(query),
      }),
    );
  }

  private params(query: CustomerQuery): HttpParams {
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
    return params;
  }
}

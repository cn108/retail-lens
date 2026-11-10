import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from './api.config';

export type ForecastStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface ForecastDataset {
  id: string;
  name: string;
}

export interface ForecastModelMetrics {
  name: string;
  version: string;
  mae: number;
  rmse: number;
}

export interface ForecastMetrics {
  model: ForecastModelMetrics;
  baseline: ForecastModelMetrics;
  improvement_percent: number | null;
  split: {
    training_periods: number;
    validation_periods: number;
    test_periods: number;
  };
  alpha: number;
  beta: number;
  interval: string;
  minimum_history_months: number;
}

export interface ForecastHistoryPoint {
  period: string;
  amount: string;
}

export interface ForecastPoint {
  target_date: string;
  predicted_amount: string;
  lower_bound: string;
  upper_bound: string;
}

export interface ForecastAnomaly {
  id: string;
  observed_date: string;
  observed_amount: string;
  expected_amount: string;
  deviation_amount: string;
  score: string;
  direction: 'above' | 'below';
  note: string;
  acknowledged_at: string | null;
}

export interface ForecastRun {
  id: string;
  status: ForecastStatus;
  granularity: string;
  horizon: number;
  dataset: ForecastDataset | null;
  model_name: string;
  model_version: string;
  training_start: string | null;
  training_end: string | null;
  metrics: ForecastMetrics;
  anomaly_method: string;
  anomaly_count: number;
  error_message: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface ForecastRunDetail extends ForecastRun {
  history: ForecastHistoryPoint[];
  points: ForecastPoint[];
  anomalies: ForecastAnomaly[];
}

@Injectable({ providedIn: 'root' })
export class ForecastingService {
  private readonly http = inject(HttpClient);

  async list(datasetId?: string, limit = 20): Promise<ForecastRun[]> {
    let params = new HttpParams().set('limit', String(limit));
    if (datasetId) {
      params = params.set('dataset', datasetId);
    }
    return firstValueFrom(
      this.http.get<ForecastRun[]>(`${API_BASE_URL}/forecasting/runs`, { params }),
    );
  }

  async create(datasetId: string | null, horizon: number): Promise<ForecastRun> {
    return firstValueFrom(
      this.http.post<ForecastRun>(`${API_BASE_URL}/forecasting/runs`, {
        dataset: datasetId,
        horizon,
      }),
    );
  }

  async triageAnomaly(
    runId: string,
    anomalyId: string,
    change: { note?: string; acknowledged?: boolean },
  ): Promise<{ id: string; note: string; acknowledged_at: string | null }> {
    return firstValueFrom(
      this.http.patch<{ id: string; note: string; acknowledged_at: string | null }>(
        `${API_BASE_URL}/forecasting/runs/${runId}/anomalies/${anomalyId}`,
        change,
      ),
    );
  }

  async get(runId: string): Promise<ForecastRunDetail> {
    return firstValueFrom(
      this.http.get<ForecastRunDetail>(`${API_BASE_URL}/forecasting/runs/${runId}`),
    );
  }
}

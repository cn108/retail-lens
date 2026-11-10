import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from './api.config';

export type AlertMetric =
  'net_sales' | 'orders' | 'average_order_value' | 'customers' | 'return_rate' | 'discount_rate';

export type AlertState = 'ok' | 'breached' | 'unknown';
export type AlertComparator = 'below' | 'above';

export interface MetricChoice {
  value: string;
  label: string;
}

export interface AlertEvent {
  id: string;
  value: string;
  threshold: string;
  message: string;
  triggered_at: string;
  acknowledged_at: string | null;
}

export interface AlertRule {
  id: string;
  name: string;
  metric: AlertMetric;
  metric_label: string;
  comparator: AlertComparator;
  threshold: string;
  window_days: number;
  dataset: string | null;
  enabled: boolean;
  last_checked_at: string | null;
  last_value: string | null;
  last_state: AlertState;
  events: AlertEvent[];
}

export interface AlertList {
  metrics: MetricChoice[];
  rules: AlertRule[];
}

export interface TargetProgress {
  id: string;
  name: string;
  metric: AlertMetric;
  metric_label: string;
  target: string;
  actual: string;
  attainment_percent: string | null;
  expected_percent: string;
  pace: 'ahead' | 'behind' | 'unknown';
  period_start: string;
  period_end: string;
  days_elapsed: number;
  days_total: number;
  dataset: string | null;
}

export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly';

export interface ReportSchedule {
  id: string;
  report: string;
  report_name: string;
  frequency: ScheduleFrequency;
  format: 'csv' | 'pdf';
  recipients: string[];
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
}

export interface BoardWidget {
  type: string;
  title?: string;
}

export interface Board {
  id: string;
  name: string;
  description: string;
  widgets: BoardWidget[];
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

@Injectable({ providedIn: 'root' })
export class MonitoringService {
  private readonly http = inject(HttpClient);

  async alerts(): Promise<AlertList> {
    return firstValueFrom(this.http.get<AlertList>(`${API_BASE_URL}/monitoring/alerts`));
  }

  async createAlert(payload: {
    name: string;
    metric: AlertMetric;
    comparator: AlertComparator;
    threshold: string;
    window_days: number;
    dataset?: string | null;
    enabled?: boolean;
  }): Promise<AlertRule> {
    return firstValueFrom(this.http.post<AlertRule>(`${API_BASE_URL}/monitoring/alerts`, payload));
  }

  async updateAlert(
    id: string,
    payload: { enabled?: boolean; threshold?: string; window_days?: number },
  ): Promise<AlertRule> {
    return firstValueFrom(
      this.http.patch<AlertRule>(`${API_BASE_URL}/monitoring/alerts/${id}`, payload),
    );
  }

  async deleteAlert(id: string): Promise<void> {
    await firstValueFrom(this.http.delete<void>(`${API_BASE_URL}/monitoring/alerts/${id}`));
  }

  async evaluateAlerts(): Promise<AlertList & { created_events: number }> {
    return firstValueFrom(
      this.http.post<AlertList & { created_events: number }>(
        `${API_BASE_URL}/monitoring/alerts/evaluate`,
        {},
      ),
    );
  }

  async acknowledgeEvent(id: string): Promise<void> {
    await firstValueFrom(
      this.http.post<void>(`${API_BASE_URL}/monitoring/alert-events/${id}/acknowledge`, {}),
    );
  }

  async targets(): Promise<TargetProgress[]> {
    const response = await firstValueFrom(
      this.http.get<{ targets: TargetProgress[] }>(`${API_BASE_URL}/monitoring/targets`),
    );
    return response.targets;
  }

  async createTarget(payload: {
    name: string;
    metric: AlertMetric;
    amount: string;
    period_start: string;
    period_end: string;
    dataset?: string | null;
  }): Promise<TargetProgress> {
    return firstValueFrom(
      this.http.post<TargetProgress>(`${API_BASE_URL}/monitoring/targets`, payload),
    );
  }

  async deleteTarget(id: string): Promise<void> {
    await firstValueFrom(this.http.delete<void>(`${API_BASE_URL}/monitoring/targets/${id}`));
  }

  async schedules(): Promise<ReportSchedule[]> {
    const response = await firstValueFrom(
      this.http.get<{ schedules: ReportSchedule[] }>(`${API_BASE_URL}/monitoring/schedules`),
    );
    return response.schedules;
  }

  async createSchedule(payload: {
    report: string;
    frequency: ScheduleFrequency;
    format: 'csv' | 'pdf';
    recipients: string;
    enabled?: boolean;
  }): Promise<ReportSchedule> {
    return firstValueFrom(
      this.http.post<ReportSchedule>(`${API_BASE_URL}/monitoring/schedules`, payload),
    );
  }

  async updateSchedule(
    id: string,
    payload: {
      frequency?: ScheduleFrequency;
      format?: 'csv' | 'pdf';
      recipients?: string;
      enabled?: boolean;
    },
  ): Promise<ReportSchedule> {
    return firstValueFrom(
      this.http.patch<ReportSchedule>(`${API_BASE_URL}/monitoring/schedules/${id}`, payload),
    );
  }

  async deleteSchedule(id: string): Promise<void> {
    await firstValueFrom(this.http.delete<void>(`${API_BASE_URL}/monitoring/schedules/${id}`));
  }

  async boards(): Promise<Board[]> {
    const response = await firstValueFrom(
      this.http.get<{ boards: Board[] }>(`${API_BASE_URL}/monitoring/boards`),
    );
    return response.boards;
  }

  async createBoard(payload: {
    name: string;
    description?: string;
    widgets: BoardWidget[];
  }): Promise<Board> {
    return firstValueFrom(this.http.post<Board>(`${API_BASE_URL}/monitoring/boards`, payload));
  }

  async updateBoard(
    id: string,
    payload: { name?: string; description?: string; widgets?: BoardWidget[] },
  ): Promise<Board> {
    return firstValueFrom(
      this.http.patch<Board>(`${API_BASE_URL}/monitoring/boards/${id}`, payload),
    );
  }

  async deleteBoard(id: string): Promise<void> {
    await firstValueFrom(this.http.delete<void>(`${API_BASE_URL}/monitoring/boards/${id}`));
  }
}

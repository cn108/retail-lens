import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from './api.config';

export type ReportKind = 'sales' | 'customers' | 'products';
export type ReportFormat = 'csv' | 'pdf';
export type ExportStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type ReportValueFormat = 'text' | 'money' | 'number' | 'percent';

export interface ReportDataset {
  id: string;
  name: string;
}

export interface SavedReportSummary {
  id: string;
  name: string;
  kind: ReportKind;
  kind_label: string;
  dataset: ReportDataset | null;
  date_from: string | null;
  date_to: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ReportValue = string | number | null;

export interface ReportSummaryCard {
  label: string;
  value: ReportValue;
  format: ReportValueFormat;
  note: string;
}

export interface ReportColumn {
  key: string;
  label: string;
  format: ReportValueFormat;
}

export interface ReportSection {
  key: string;
  title: string;
  description: string;
  columns: ReportColumn[];
  rows: Record<string, ReportValue>[];
}

export interface ReportDefinition {
  metric: string;
  definition: string;
  grain: string;
  exclusions: string;
}

export interface ReportPeriod {
  date_from: string | null;
  date_to: string | null;
}

export interface SavedReportDetail extends SavedReportSummary {
  generated_at: string;
  organisation_name: string;
  currency: string;
  has_data: boolean;
  period: ReportPeriod;
  comparison: ReportPeriod;
  summary: ReportSummaryCard[];
  sections: ReportSection[];
  definitions: ReportDefinition[];
  notes: string[];
}

export interface CreateReportInput {
  name: string;
  kind: ReportKind;
  dataset: string | null;
  date_from?: string | null;
  date_to?: string | null;
}

export type UpdateReportInput = Partial<CreateReportInput>;

export interface ReportExport {
  id: string;
  report_id: string;
  report_name: string;
  format: ReportFormat;
  status: ExportStatus;
  filename: string;
  row_count: number;
  size_bytes: number;
  error_message: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  download_url: string | null;
}

@Injectable({ providedIn: 'root' })
export class ReportingService {
  private readonly http = inject(HttpClient);

  async list(): Promise<SavedReportSummary[]> {
    return firstValueFrom(this.http.get<SavedReportSummary[]>(`${API_BASE_URL}/reports`));
  }

  async create(input: CreateReportInput): Promise<SavedReportDetail> {
    return firstValueFrom(this.http.post<SavedReportDetail>(`${API_BASE_URL}/reports`, input));
  }

  async get(reportId: string): Promise<SavedReportDetail> {
    return firstValueFrom(this.http.get<SavedReportDetail>(`${API_BASE_URL}/reports/${reportId}`));
  }

  async update(reportId: string, input: UpdateReportInput): Promise<SavedReportDetail> {
    return firstValueFrom(
      this.http.patch<SavedReportDetail>(`${API_BASE_URL}/reports/${reportId}`, input),
    );
  }

  async remove(reportId: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${API_BASE_URL}/reports/${reportId}`));
  }

  async listAllExports(activeOnly = false, limit = 20): Promise<ReportExport[]> {
    let params = new HttpParams().set('limit', String(limit));
    if (activeOnly) {
      params = params.set('active', '1');
    }
    return firstValueFrom(
      this.http.get<ReportExport[]>(`${API_BASE_URL}/reports/exports`, { params }),
    );
  }

  async listExports(reportId: string, limit = 20): Promise<ReportExport[]> {
    const params = new HttpParams().set('limit', String(limit));
    return firstValueFrom(
      this.http.get<ReportExport[]>(`${API_BASE_URL}/reports/${reportId}/exports`, {
        params,
      }),
    );
  }

  async createExport(reportId: string, format: ReportFormat): Promise<ReportExport> {
    return firstValueFrom(
      this.http.post<ReportExport>(`${API_BASE_URL}/reports/${reportId}/exports`, {
        format,
      }),
    );
  }

  async download(reportId: string, jobId: string): Promise<Blob> {
    const response = await firstValueFrom(
      this.http.get(`${API_BASE_URL}/reports/${reportId}/exports/${jobId}/download`, {
        observe: 'response',
        responseType: 'blob',
      }),
    );
    if (!response.body) {
      throw new Error('The export download was empty.');
    }
    return response.body;
  }
}

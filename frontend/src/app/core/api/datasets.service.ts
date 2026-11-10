import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from './api.config';

export type DatasetStatus = 'draft' | 'mapped' | 'processing' | 'ready' | 'failed';
export type InferredType = 'text' | 'integer' | 'decimal' | 'date' | 'boolean';
export type ProcessingStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface ProcessingRun {
  id: string;
  status: ProcessingStatus;
  started_at: string | null;
  finished_at: string | null;
  rows_read: number;
  rows_loaded: number;
  rows_rejected: number;
  summary: Record<string, number>;
  error_message: string;
  created_at: string;
}

export interface WarehouseCounts {
  sales_rows: number;
  return_rows: number;
  raw_rows: number;
  issues: number;
  customers: number;
  products: number;
  countries: number;
}

export interface ProcessingSummary {
  latest_run: ProcessingRun | null;
  warehouse: WarehouseCounts;
  can_process: boolean;
}

export interface QualityIssue {
  id: string;
  row_number: number;
  code: string;
  message: string;
  source_column: string;
  raw_value: string;
}

export interface DatasetSummary {
  id: string;
  name: string;
  status: DatasetStatus;
  row_count: number;
  column_count: number;
  filename: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_processed_at: string | null;
  last_run_status: ProcessingStatus | null;
  rows_rejected: number;
  quality_issue_count: number;
}

export interface DatasetColumn {
  id: string;
  position: number;
  source_name: string;
  inferred_type: InferredType;
  canonical_field: string;
  suggested_field: string;
  null_count: number;
  sample_values: string[];
}

export interface DatasetDetail extends DatasetSummary {
  encoding: string | null;
  delimiter: string | null;
  warnings: string[];
  imported_at: string | null;
  mapping_complete: boolean;
  processing: ProcessingSummary;
  columns: DatasetColumn[];
}

export interface CanonicalField {
  key: string;
  label: string;
  description: string;
  accepts: InferredType[];
  required: boolean;
}

export interface CanonicalFieldCatalogue {
  fields: CanonicalField[];
  required: string[];
}

export interface QualitySummary {
  dataset_count: number;
  rows_rejected: number;
  open_issues: number;
  reasons: { code: string; count: number }[];
  datasets: {
    dataset_id: string;
    name: string;
    status: DatasetStatus;
    rows_read: number;
    rows_rejected: number;
    issues: number;
    reasons: { code: string; count: number }[];
    last_run_at: string | null;
  }[];
}

@Injectable({ providedIn: 'root' })
export class DatasetsService {
  private readonly http = inject(HttpClient);

  async list(): Promise<DatasetSummary[]> {
    return firstValueFrom(this.http.get<DatasetSummary[]>(`${API_BASE_URL}/datasets`));
  }

  async get(datasetId: string): Promise<DatasetDetail> {
    return firstValueFrom(this.http.get<DatasetDetail>(`${API_BASE_URL}/datasets/${datasetId}`));
  }

  async canonicalFields(): Promise<CanonicalFieldCatalogue> {
    return firstValueFrom(
      this.http.get<CanonicalFieldCatalogue>(`${API_BASE_URL}/datasets/canonical-fields`),
    );
  }

  async upload(file: File, name: string): Promise<DatasetDetail> {
    const body = new FormData();
    body.append('file', file);
    if (name.trim()) {
      body.append('name', name.trim());
    }
    return firstValueFrom(this.http.post<DatasetDetail>(`${API_BASE_URL}/datasets`, body));
  }

  async updateMapping(datasetId: string, mapping: Record<string, string>): Promise<DatasetDetail> {
    return firstValueFrom(
      this.http.put<DatasetDetail>(`${API_BASE_URL}/datasets/${datasetId}/mapping`, {
        mapping,
      }),
    );
  }

  async process(datasetId: string): Promise<ProcessingRun> {
    return firstValueFrom(
      this.http.post<ProcessingRun>(`${API_BASE_URL}/datasets/${datasetId}/process`, {}),
    );
  }

  async issues(datasetId: string, limit = 50): Promise<QualityIssue[]> {
    return firstValueFrom(
      this.http.get<QualityIssue[]>(`${API_BASE_URL}/datasets/${datasetId}/issues`, {
        params: { limit: String(limit) },
      }),
    );
  }

  async qualitySummary(): Promise<QualitySummary> {
    return firstValueFrom(
      this.http.get<QualitySummary>(`${API_BASE_URL}/datasets/quality-summary`),
    );
  }

  async remove(datasetId: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${API_BASE_URL}/datasets/${datasetId}`));
  }
}

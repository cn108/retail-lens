import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { DatasetDetail, DatasetsService } from './datasets.service';

const detail: DatasetDetail = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'February sales',
  status: 'draft',
  row_count: 3,
  column_count: 2,
  filename: 'sales.csv',
  created_by: 'owner@example.com',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  last_processed_at: null,
  last_run_status: null,
  rows_rejected: 0,
  quality_issue_count: 0,
  encoding: 'utf-8',
  delimiter: ',',
  warnings: [],
  imported_at: '2026-01-01T00:00:00Z',
  mapping_complete: false,
  processing: {
    latest_run: null,
    warehouse: {
      sales_rows: 0,
      return_rows: 0,
      raw_rows: 0,
      issues: 0,
      customers: 0,
      products: 0,
      countries: 0,
    },
    can_process: false,
  },
  columns: [],
};

describe('DatasetsService', () => {
  let service: DatasetsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(DatasetsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('uploads the file as multipart form data', async () => {
    const file = new File(['InvoiceNo\nINV-1'], 'sales.csv', { type: 'text/csv' });
    const upload = service.upload(file, 'February sales');

    const request = http.expectOne('/api/v1/datasets');
    expect(request.request.method).toBe('POST');
    const body = request.request.body as FormData;
    expect(body.get('name')).toBe('February sales');
    expect((body.get('file') as File).name).toBe('sales.csv');
    request.flush(detail);

    await upload;
  });

  it('sends the whole mapping on save', async () => {
    const save = service.updateMapping(detail.id, {
      'column-1': 'invoice_id',
      'column-2': '',
    });

    const request = http.expectOne(`/api/v1/datasets/${detail.id}/mapping`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({
      mapping: { 'column-1': 'invoice_id', 'column-2': '' },
    });
    request.flush({ ...detail, status: 'mapped' });

    const saved = await save;
    expect(saved.status).toBe('mapped');
  });
});

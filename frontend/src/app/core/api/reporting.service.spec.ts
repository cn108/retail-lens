import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  ReportExport,
  SavedReportDetail,
  SavedReportSummary,
  ReportingService,
} from './reporting.service';

const summary: SavedReportSummary = {
  id: 'report-1',
  name: 'Board pack',
  kind: 'sales',
  kind_label: 'Sales performance',
  dataset: { id: 'dataset-1', name: 'Monthly sales' },
  date_from: null,
  date_to: null,
  created_by: 'owner@example.com',
  created_at: '2026-01-02T10:00:00Z',
  updated_at: '2026-01-02T10:00:00Z',
};

const detail: SavedReportDetail = {
  ...summary,
  generated_at: '2026-01-02T10:00:00+00:00',
  organisation_name: 'Acme Retail',
  currency: 'GBP',
  has_data: true,
  period: { date_from: '2024-01-01', date_to: '2024-02-29' },
  comparison: { date_from: '2023-11-01', date_to: '2023-12-31' },
  summary: [{ label: 'Net sales', value: '40.0000', format: 'money', note: 'After returns' }],
  sections: [
    {
      key: 'monthly_sales',
      title: 'Monthly net sales',
      description: '',
      columns: [{ key: 'net', label: 'Net sales', format: 'money' }],
      rows: [{ net: '40.0000' }],
    },
  ],
  definitions: [
    {
      metric: 'Net sales',
      definition: 'Sales after discounts and returns.',
      grain: 'Line',
      exclusions: 'Rejected rows',
    },
  ],
  notes: [],
};

const job: ReportExport = {
  id: 'job-1',
  report_id: summary.id,
  report_name: summary.name,
  format: 'csv',
  status: 'succeeded',
  filename: 'board-pack-2026-01-02.csv',
  row_count: 1,
  size_bytes: 1200,
  error_message: '',
  created_at: '2026-01-02T10:00:00Z',
  started_at: '2026-01-02T10:00:01Z',
  finished_at: '2026-01-02T10:00:02Z',
  download_url: '/api/v1/reports/report-1/exports/job-1/download',
};

describe('ReportingService', () => {
  let service: ReportingService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ReportingService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists saved reports', async () => {
    const request$ = service.list();
    const request = http.expectOne('/api/v1/reports');
    expect(request.request.method).toBe('GET');
    request.flush([summary]);

    const result = await request$;
    expect(result[0].kind_label).toBe('Sales performance');
  });

  it('creates a report with its filters', async () => {
    const request$ = service.create({
      name: 'Board pack',
      kind: 'sales',
      dataset: 'dataset-1',
      date_from: '2024-01-01',
      date_to: '2024-02-29',
    });
    const request = http.expectOne('/api/v1/reports');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      name: 'Board pack',
      kind: 'sales',
      dataset: 'dataset-1',
      date_from: '2024-01-01',
      date_to: '2024-02-29',
    });
    request.flush(detail);

    expect((await request$).summary[0].value).toBe('40.0000');
  });

  it('loads a saved report detail', async () => {
    const request$ = service.get('report-1');
    const request = http.expectOne('/api/v1/reports/report-1');
    request.flush(detail);

    const result = await request$;
    expect(result.sections[0].rows[0]['net']).toBe('40.0000');
    expect(result.definitions[0].metric).toBe('Net sales');
  });

  it('updates a saved report', async () => {
    const request$ = service.update('report-1', { name: 'Updated pack' });
    const request = http.expectOne('/api/v1/reports/report-1');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ name: 'Updated pack' });
    request.flush({ ...detail, name: 'Updated pack' });

    expect((await request$).name).toBe('Updated pack');
  });

  it('lists all organisation exports for the activity feed', async () => {
    const request$ = service.listAllExports(true, 5);
    const request = http.expectOne(
      (candidate) =>
        candidate.url === '/api/v1/reports/exports' &&
        candidate.params.get('active') === '1' &&
        candidate.params.get('limit') === '5',
    );
    request.flush([job]);

    expect((await request$)[0].report_name).toBe('Board pack');
  });

  it('lists and starts exports for a report', async () => {
    const list$ = service.listExports('report-1', 5);
    const list = http.expectOne(
      (candidate) =>
        candidate.url === '/api/v1/reports/report-1/exports' &&
        candidate.params.get('limit') === '5',
    );
    list.flush([job]);
    expect((await list$)[0].status).toBe('succeeded');

    const create$ = service.createExport('report-1', 'pdf');
    const create = http.expectOne('/api/v1/reports/report-1/exports');
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual({ format: 'pdf' });
    create.flush({ ...job, id: 'job-2', format: 'pdf', status: 'queued' });

    expect((await create$).status).toBe('queued');
  });

  it('downloads the generated file as a blob', async () => {
    const request$ = service.download('report-1', 'job-1');
    const request = http.expectOne('/api/v1/reports/report-1/exports/job-1/download');
    request.flush(new Blob(['Name,Board pack'], { type: 'text/csv' }));

    const blob = await request$;
    expect(blob.type).toBe('text/csv');
    expect(await blob.text()).toContain('Board pack');
  });
});

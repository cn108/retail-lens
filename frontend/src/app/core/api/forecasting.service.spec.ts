import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ForecastRun, ForecastRunDetail, ForecastingService } from './forecasting.service';

const metrics = {
  model: { name: 'Holt linear trend', version: 'holt-linear-v1', mae: 12.5, rmse: 15.25 },
  baseline: { name: 'Seasonal naive', version: 'seasonal-naive-v1', mae: 20, rmse: 24 },
  improvement_percent: 37.5,
  split: { training_periods: 14, validation_periods: 5, test_periods: 5 },
  alpha: 0.3,
  beta: 0.1,
  interval: '95% (±1.96 × test RMSE)',
  minimum_history_months: 12,
};

const run: ForecastRun = {
  id: 'run-1',
  status: 'succeeded',
  granularity: 'month',
  horizon: 3,
  dataset: { id: 'dataset-1', name: 'Monthly sales' },
  model_name: 'Holt linear trend',
  model_version: 'holt-linear-v1',
  training_start: '2024-01-01',
  training_end: '2025-12-01',
  metrics,
  anomaly_method: 'Tukey IQR fences (mean ± 3σ fallback)',
  anomaly_count: 1,
  error_message: '',
  created_at: '2026-01-02T10:00:00Z',
  started_at: '2026-01-02T10:00:01Z',
  finished_at: '2026-01-02T10:00:02Z',
};

const detail: ForecastRunDetail = {
  ...run,
  history: [
    { period: '2025-11-01', amount: '1000.0000' },
    { period: '2025-12-01', amount: '1100.0000' },
  ],
  points: [
    {
      target_date: '2026-01-01',
      predicted_amount: '1200.0000',
      lower_bound: '1000.0000',
      upper_bound: '1400.0000',
    },
  ],
  anomalies: [
    {
      id: 'anomaly-1',
      note: '',
      acknowledged_at: null,
      observed_date: '2025-04-01',
      observed_amount: '2000.0000',
      expected_amount: '1100.0000',
      deviation_amount: '900.0000',
      score: '3.10',
      direction: 'above',
    },
  ],
};

describe('ForecastingService', () => {
  let service: ForecastingService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ForecastingService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists runs with the dataset filter and limit', async () => {
    const request$ = service.list('dataset-1', 5);

    const request = http.expectOne(
      (candidate) =>
        candidate.url === '/api/v1/forecasting/runs' &&
        candidate.params.get('dataset') === 'dataset-1' &&
        candidate.params.get('limit') === '5',
    );
    expect(request.request.method).toBe('GET');
    request.flush([run]);

    const result = await request$;
    expect(result[0].model_version).toBe('holt-linear-v1');
  });

  it('creates a run with the dataset and horizon', async () => {
    const request$ = service.create('dataset-1', 6);

    const request = http.expectOne('/api/v1/forecasting/runs');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ dataset: 'dataset-1', horizon: 6 });
    request.flush({ ...run, status: 'queued' });

    expect((await request$).status).toBe('queued');
  });

  it('creates an organisation-wide run when no dataset is selected', async () => {
    const request$ = service.create(null, 3);

    const request = http.expectOne('/api/v1/forecasting/runs');
    expect(request.request.body).toEqual({ dataset: null, horizon: 3 });
    request.flush(run);
    await request$;
  });

  it('loads one run with its history, points and anomalies', async () => {
    const request$ = service.get('run-1');

    const request = http.expectOne('/api/v1/forecasting/runs/run-1');
    request.flush(detail);

    const result = await request$;
    expect(result.points[0].predicted_amount).toBe('1200.0000');
    expect(result.anomalies[0].direction).toBe('above');
    expect(result.metrics.improvement_percent).toBe(37.5);
  });
});

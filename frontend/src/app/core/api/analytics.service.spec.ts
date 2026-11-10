import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { AnalyticsService, SalesSummary, SalesTrend } from './analytics.service';

const summary: SalesSummary = {
  has_data: true,
  date_from: '2024-01-01',
  date_to: '2024-01-31',
  comparison_date_from: '2023-12-01',
  comparison_date_to: '2023-12-31',
  gross_sales: '100.0000',
  net_sales: '90.0000',
  eligible_orders: 3,
  average_order_value: '30.0000',
  unique_customers: 2,
  sales_growth_percent: '12.50',
  previous_net_sales: '80.0000',
  datasets: [{ id: 'dataset-1', name: 'January' }],
};

const trend: SalesTrend = {
  granularity: 'week',
  has_data: true,
  date_from: '2024-01-01',
  date_to: '2024-01-31',
  points: [],
};

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AnalyticsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('sends the dataset and date filters with the summary request', async () => {
    const request$ = service.summary({
      dataset: 'dataset-1',
      date_from: '2024-01-01',
      date_to: '2024-01-31',
    });

    const request = http.expectOne(
      (candidate) =>
        candidate.url === '/api/v1/analytics/sales/summary' &&
        candidate.params.get('dataset') === 'dataset-1' &&
        candidate.params.get('date_from') === '2024-01-01' &&
        candidate.params.get('date_to') === '2024-01-31',
    );
    expect(request.request.method).toBe('GET');
    request.flush(summary);

    expect((await request$).net_sales).toBe('90.0000');
  });

  it('sends the selected granularity with the trend request', async () => {
    const request$ = service.trend({ granularity: 'week' });

    const request = http.expectOne(
      (candidate) =>
        candidate.url === '/api/v1/analytics/sales/trend' &&
        candidate.params.get('granularity') === 'week',
    );
    request.flush(trend);

    expect((await request$).granularity).toBe('week');
  });
});

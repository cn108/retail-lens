import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  CustomerSummary,
  CustomersService,
  RetentionResponse,
  RfmResponse,
} from './customers.service';

const summary: CustomerSummary = {
  has_data: true,
  date_from: '2024-01-01',
  date_to: '2024-03-31',
  identifiable_customers: 4,
  repeat_customers: 3,
  repeat_purchase_rate: '75.00',
  average_orders: '2.00',
  historical_value: '150.0000',
  average_historical_value: '37.5000',
  month_1_retention: '50.00',
  cohort_count: 2,
};

const rfm: RfmResponse = {
  has_data: true,
  date_from: '2024-01-01',
  date_to: '2024-03-31',
  as_of: '2024-03-31',
  total: 0,
  customers: [],
  segments: [],
};

const retention: RetentionResponse = {
  has_data: true,
  date_from: '2024-01-01',
  date_to: '2024-03-31',
  month_1_retention: '50.00',
  cohorts: [],
};

describe('CustomersService', () => {
  let service: CustomersService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(CustomersService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('sends dataset and date filters with the summary request', async () => {
    const request$ = service.summary({
      dataset: 'dataset-1',
      date_from: '2024-01-01',
      date_to: '2024-03-31',
    });

    const request = http.expectOne(
      (candidate) =>
        candidate.url === '/api/v1/customers/summary' &&
        candidate.params.get('dataset') === 'dataset-1' &&
        candidate.params.get('date_from') === '2024-01-01' &&
        candidate.params.get('date_to') === '2024-03-31',
    );
    expect(request.request.method).toBe('GET');
    request.flush(summary);

    expect((await request$).repeat_purchase_rate).toBe('75.00');
  });

  it('sends the RFM limit and reads the segment payload', async () => {
    const request$ = service.rfm({ date_to: '2024-03-31' }, 10);

    const request = http.expectOne(
      (candidate) =>
        candidate.url === '/api/v1/customers/rfm' &&
        candidate.params.get('limit') === '10' &&
        candidate.params.get('date_to') === '2024-03-31',
    );
    request.flush(rfm);

    expect((await request$).as_of).toBe('2024-03-31');
  });

  it('sends the RFM search term when focusing one customer', async () => {
    const request$ = service.rfm({ search: 'ACME-1' }, 8);

    const request = http.expectOne(
      (candidate) =>
        candidate.url === '/api/v1/customers/rfm' &&
        candidate.params.get('search') === 'ACME-1' &&
        candidate.params.get('limit') === '8',
    );
    request.flush(rfm);

    await request$;
  });

  it('loads the retention matrix', async () => {
    const request$ = service.retention();

    const request = http.expectOne('/api/v1/customers/retention');
    request.flush(retention);

    expect((await request$).month_1_retention).toBe('50.00');
  });
});

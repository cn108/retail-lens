import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ProductPerformance, ProductsService } from './products.service';

const performance: ProductPerformance = {
  has_data: true,
  date_from: '2024-03-01',
  date_to: '2024-03-31',
  comparison_date_from: '2024-01-30',
  comparison_date_to: '2024-02-29',
  net_sales: '45.0000',
  product_count: 3,
  top_product_share: '44.44',
  declining_products: 1,
  rows: [],
};

describe('ProductsService', () => {
  let service: ProductsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ProductsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('sends filters and the row limit', async () => {
    const request$ = service.performance(
      {
        dataset: 'dataset-1',
        date_from: '2024-03-01',
        date_to: '2024-03-31',
        search: 'SKU-1',
      },
      25,
    );

    const request = http.expectOne(
      (candidate) =>
        candidate.url === '/api/v1/analytics/products/performance' &&
        candidate.params.get('dataset') === 'dataset-1' &&
        candidate.params.get('date_from') === '2024-03-01' &&
        candidate.params.get('date_to') === '2024-03-31' &&
        candidate.params.get('search') === 'SKU-1' &&
        candidate.params.get('limit') === '25',
    );
    expect(request.request.method).toBe('GET');
    request.flush(performance);

    const result = await request$;
    expect(result.product_count).toBe(3);
    expect(result.declining_products).toBe(1);
  });
});

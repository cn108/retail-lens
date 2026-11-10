import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { CustomersService, RfmCustomer } from '../core/api/customers.service';
import { DatasetSummary, DatasetsService } from '../core/api/datasets.service';
import { ProductPerformance, ProductsService } from '../core/api/products.service';
import { ReportingService, SavedReportSummary } from '../core/api/reporting.service';
import { CommandPalette } from './command-palette';

const reports: SavedReportSummary[] = [
  {
    id: 'report-1',
    name: 'Monthly board pack',
    kind: 'sales',
    kind_label: 'Sales performance',
    dataset: { id: 'dataset-1', name: 'December sales' },
    date_from: null,
    date_to: null,
    created_by: 'owner@example.com',
    created_at: '2026-01-02T10:00:00Z',
    updated_at: '2026-01-02T10:00:00Z',
  },
];

const customers: RfmCustomer[] = [
  {
    customer_id: 'customer-key-1',
    source_customer_id: 'ACME-1',
    dataset_id: 'dataset-1',
    dataset_name: 'December sales',
    last_purchase: '2024-12-03',
    recency_days: 10,
    orders: 3,
    net_sales: '120.0000',
    r: 4,
    f: 4,
    m: 4,
    segment: 'champion',
    segment_label: 'Champion',
  },
];

const products: ProductPerformance = {
  has_data: true,
  date_from: '2024-12-01',
  date_to: '2024-12-31',
  comparison_date_from: '2024-10-31',
  comparison_date_to: '2024-11-30',
  net_sales: '100.0000',
  product_count: 1,
  top_product_share: '100.00',
  declining_products: 0,
  rows: [
    {
      product_id: 'product-key-1',
      source_product_code: 'ACME-WIDGET',
      description: 'Acme widget',
      dataset_id: 'dataset-1',
      dataset_name: 'December sales',
      net_sales: '100.0000',
      gross_sales: '110.0000',
      share: '100.00',
      units: 4,
      orders: 2,
      returned_units: 0,
      return_lines: 0,
      previous_net_sales: '0.0000',
      change_percent: null,
      direction: 'new',
    },
  ],
};

const datasets: DatasetSummary[] = [
  {
    id: 'dataset-1',
    name: 'December sales',
    status: 'ready',
    row_count: 1200,
    column_count: 8,
    filename: 'december-sales.csv',
    created_by: 'owner@example.com',
    created_at: '2026-01-01T10:00:00Z',
    updated_at: '2026-01-01T10:00:00Z',
    last_processed_at: '2026-01-01T10:05:00Z',
    last_run_status: 'succeeded',
    rows_rejected: 0,
    quality_issue_count: 0,
  },
];

describe('CommandPalette', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = () => undefined;
  });

  let fixture: ComponentFixture<CommandPalette>;
  let palette: CommandPalette;
  let navigateCalls: { commands: unknown[]; extras: unknown }[];

  beforeEach(async () => {
    navigateCalls = [];
    await TestBed.configureTestingModule({
      imports: [CommandPalette],
      providers: [
        {
          provide: ReportingService,
          useValue: { list: async () => reports },
        },
        {
          provide: DatasetsService,
          useValue: { list: async () => datasets },
        },
        {
          provide: CustomersService,
          useValue: {
            rfm: async () => ({
              has_data: true,
              date_from: '2024-12-01',
              date_to: '2024-12-31',
              as_of: '2024-12-31',
              customers,
              segments: [],
            }),
          },
        },
        {
          provide: ProductsService,
          useValue: { performance: async () => products },
        },
        {
          provide: Router,
          useValue: {
            navigate: async (commands: unknown[], extras: unknown) => {
              navigateCalls.push({ commands, extras });
              return true;
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommandPalette);
    palette = fixture.componentInstance;
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
  });

  it('groups pages, saved reports and datasets', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Pages');
    expect(text).toContain('Saved reports');
    expect(text).toContain('Monthly board pack');
    expect(text).toContain('Datasets');
    expect(text).toContain('December sales');
    expect(text).toContain('Ready · 1,200 rows');
  });

  it('filters across each group and shows an explicit empty state', async () => {
    palette.updateQuery('board');
    fixture.detectChanges();
    let text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Monthly board pack');
    expect(text).not.toContain('Ready · 1,200 rows');

    palette.updateQuery('missing item');
    await new Promise((resolve) => setTimeout(resolve, 220));
    fixture.detectChanges();
    text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('No matches');
    expect(text).not.toContain('Monthly board pack');
  });

  it('searches customers and products and opens the matching detail page', async () => {
    palette.updateQuery('acme');
    await new Promise((resolve) => setTimeout(resolve, 220));
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Customers');
    expect(text).toContain('ACME-1');
    expect(text).toContain('Champion · December sales');
    expect(text).toContain('Products');
    expect(text).toContain('ACME-WIDGET');

    const customer = palette.results().find((slot) => slot.item.kind === 'customer');
    expect(customer).toBeDefined();
    await palette.select(customer!.item);
    await settle();
    expect(navigateCalls[0]).toEqual({
      commands: ['/customers/customer-key-1'],
      extras: undefined,
    });

    const product = palette.results().find((slot) => slot.item.kind === 'product');
    expect(product).toBeDefined();
    await palette.select(product!.item);
    await settle();
    expect(navigateCalls[1]).toEqual({
      commands: ['/products/product-key-1'],
      extras: undefined,
    });
  });

  it('opens the highlighted result with Enter', async () => {
    palette.updateQuery('board');
    fixture.detectChanges();
    expect(palette.results().map((slot) => slot.item.label)).toEqual([
      'Boards',
      'Monthly board pack',
    ]);

    palette.onInputKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    palette.onInputKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));
    await settle();

    expect(navigateCalls[0].commands).toEqual(['/reports/report-1']);
  });

  it('moves the highlighted result with the arrow keys', () => {
    palette.updateQuery('sales');
    fixture.detectChanges();
    expect(palette.activeItem()?.label).toBe('Sales');

    palette.onInputKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(palette.activeItem()?.label).toBe('Forecasting');

    palette.onInputKeydown(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(palette.activeItem()?.label).toBe('Sales');
  });

  it('closes on Escape and marks the event handled', () => {
    let closed = 0;
    palette.closed.subscribe(() => (closed += 1));
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });

    palette.onDialogKeydown(event);

    expect(closed).toBe(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('keeps the analysis scope when opening an analysis page', async () => {
    palette.updateQuery('sales');
    fixture.detectChanges();

    palette.onInputKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));
    await settle();

    expect(navigateCalls[0]).toEqual({
      commands: ['/sales'],
      extras: {
        queryParams: { customer: null, product: null },
        queryParamsHandling: 'preserve',
      },
    });
  });
});

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

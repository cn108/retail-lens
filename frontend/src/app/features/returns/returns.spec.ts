import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AnalyticsService, ReturnsAnalysis } from '../../core/api/analytics.service';
import { DatasetSummary, DatasetsService } from '../../core/api/datasets.service';
import { AuthService } from '../../core/auth/auth.service';
import { Returns } from './returns';

const report: ReturnsAnalysis = {
  has_data: true,
  date_from: '2024-12-01',
  date_to: '2024-12-03',
  sales_lines: 4,
  return_lines: 1,
  sold_units: 26,
  returned_units: 1,
  return_rate: '3.85',
  gross_sales: '100.0000',
  discount_total: '10.0000',
  discount_rate: '10.00',
  return_value: '5.0000',
  net_sales: '85.0000',
  bridge: [
    { label: 'Gross sales', amount: '100.0000' },
    { label: 'Discounts', amount: '-10.0000' },
    { label: 'Returns', amount: '-5.0000' },
    { label: 'Net sales', amount: '85.0000' },
  ],
  products: [
    {
      product_id: '3',
      source_product_code: '84879',
      description: 'Assorted colour bird ornament',
      dataset_id: 'dataset-1',
      dataset_name: 'December sales',
      returned_units: 1,
      return_lines: 1,
      return_value: '5.0000',
      sold_units: 6,
      return_rate: '16.67',
      net_sales: '30.0000',
    },
    {
      product_id: '4',
      source_product_code: '71053',
      description: 'White metal lantern',
      dataset_id: 'dataset-1',
      dataset_name: 'December sales',
      returned_units: 0,
      return_lines: 0,
      return_value: '0.0000',
      sold_units: 4,
      return_rate: '0.00',
      net_sales: '20.0000',
    },
  ],
  countries: [
    {
      country: 'United Kingdom',
      sold_units: 26,
      returned_units: 1,
      return_value: '5.0000',
      return_rate: '3.85',
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

describe('Returns & discounts', () => {
  let fixture: ComponentFixture<Returns>;
  let page: Returns;
  let analytics: { returns: ReturnType<typeof vi.fn> };
  let clipboard: { writeText: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    analytics = { returns: vi.fn(async () => report) };
    clipboard = { writeText: vi.fn(async () => undefined) };
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });

    await TestBed.configureTestingModule({
      imports: [Returns],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            activeOrganisation: signal({
              id: 'org-1',
              name: 'Northwind Retail',
              slug: 'northwind-retail',
              currency: 'GBP',
              role: 'owner',
            }),
          },
        },
        { provide: DatasetsService, useValue: { list: async () => datasets } },
        { provide: AnalyticsService, useValue: analytics },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Returns);
    page = fixture.componentInstance;
    await settle(fixture);
  });

  it('renders the rate, value and net sales headline numbers', () => {
    const text = textOf(fixture);

    expect(text).toContain('3.85%');
    expect(text).toContain('1 of 26 units');
    expect(text).toContain('10.00%');
    expect(text).toContain('£10.00 given away');
    expect(text).toContain('£5.00');
    expect(text).toContain('1 return lines across 4 sale lines');
    expect(text).toContain('£85.00');
  });

  it('draws the gross-to-net bridge in order with signed amounts', () => {
    const labels = [...fixture.nativeElement.querySelectorAll('.grid > span:first-child')].map(
      (span: HTMLElement) => span.textContent?.trim(),
    );
    expect(labels).toEqual(['Gross sales', 'Discounts', 'Returns', 'Net sales']);

    expect(textOf(fixture)).toContain('-£10.00');
    expect(textOf(fixture)).toContain('-£5.00');
    expect(page.bridgeWidth('-5.0000')).toBe(5);
    expect(page.bridgeWidth('0.0000')).toBe(2);
  });

  it('lists only returned products, worst rate first, with a detail link', () => {
    const text = textOf(fixture);
    expect(text).toContain('Assorted colour bird ornament');
    expect(text).toContain('84879 · December sales');
    expect(text).toContain('£5.00');
    expect(text).toContain('16.67%');

    const link = fixture.nativeElement.querySelector('tbody a[href="/products/3"]');
    expect(link).not.toBeNull();

    expect(page.highReturn('16.67')).toBe(true);
    expect(page.highReturn('10')).toBe(false);
    expect(page.highReturn(null)).toBe(false);
  });

  it('labels the returns by country table with returned value', () => {
    const text = textOf(fixture);
    expect(text).toContain('United Kingdom');
    expect(text).toContain('26');
  });

  it('says so when nothing was returned', async () => {
    analytics.returns.mockResolvedValueOnce({ ...report, products: [] });
    await page.reload();
    await settle(fixture);

    expect(textOf(fixture)).toContain('No returned units in this range. That is good news.');
  });

  it('reports a failed clipboard copy instead of claiming success', async () => {
    clipboard.writeText.mockRejectedValueOnce(new Error('denied'));
    await page.copyProducts();
    fixture.detectChanges();

    expect(textOf(fixture)).toContain('Copy failed.');
    expect(textOf(fixture)).not.toContain('Copied to the clipboard.');
  });

  it('exports the product and country tables with their own filenames', () => {
    const names: string[] = [];
    URL.createObjectURL = vi.fn(() => 'blob:returns');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });

    page.exportProducts();
    page.exportCountries();

    expect(names).toEqual(['returns-by-product.csv', 'returns-by-country.csv']);
  });

  it('shows the empty state when the range has no sales at all', async () => {
    analytics.returns.mockResolvedValueOnce({ ...report, has_data: false, bridge: [] });
    await page.reload();
    await settle(fixture);

    expect(textOf(fixture)).toContain('No sales or returns in this range');
  });

  it('surfaces a load failure and retries on demand', async () => {
    analytics.returns.mockRejectedValueOnce(
      new HttpErrorResponse({
        status: 500,
        error: { error: { message: 'Warehouse unavailable' } },
      }),
    );
    await page.reload();
    await settle(fixture);

    expect(textOf(fixture)).toContain('Warehouse unavailable');

    const retry = [...fixture.nativeElement.querySelectorAll('button')].find(
      (button: HTMLButtonElement) => button.textContent?.trim() === 'Retry',
    ) as HTMLButtonElement;
    retry.click();
    await settle(fixture);

    expect(textOf(fixture)).not.toContain('Warehouse unavailable');
    expect(textOf(fixture)).toContain('£85.00');
  });
});

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}

function textOf(fixture: ComponentFixture<unknown>): string {
  return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ').trim();
}

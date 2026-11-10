import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AnalyticsService, GeographyPerformance } from '../../core/api/analytics.service';
import { DatasetSummary, DatasetsService } from '../../core/api/datasets.service';
import { AuthService } from '../../core/auth/auth.service';
import { TablePreferencesService } from '../../shared/table-tools';
import { Geography } from './geography';

const report: GeographyPerformance = {
  has_data: true,
  compare: 'previous',
  date_from: '2024-12-01',
  date_to: '2024-12-03',
  comparison_date_from: '2024-11-28',
  comparison_date_to: '2024-11-30',
  net_sales: '80.0000',
  country_count: 3,
  top_country_share: '62.50',
  rows: [
    {
      country: 'United Kingdom',
      net_sales: '50.0000',
      gross_sales: '55.0000',
      discount_total: '0.0000',
      share: '62.50',
      units: 8,
      orders: 4,
      customers: 3,
      returned_units: 0,
      return_value: '0.0000',
      return_rate: '0.00',
      previous_net_sales: '40.0000',
      change_percent: '25.00',
      direction: 'growing',
    },
    {
      country: 'Germany',
      net_sales: '20.0000',
      gross_sales: '22.0000',
      discount_total: '0.0000',
      share: '25.00',
      units: 4,
      orders: 2,
      customers: 2,
      returned_units: 1,
      return_value: '2.5000',
      return_rate: '12.50',
      previous_net_sales: '25.0000',
      change_percent: '-20.00',
      direction: 'declining',
    },
    {
      country: 'Unassigned',
      net_sales: '10.0000',
      gross_sales: '10.0000',
      discount_total: '0.0000',
      share: '12.50',
      units: 2,
      orders: 1,
      customers: 1,
      returned_units: 0,
      return_value: '0.0000',
      return_rate: '0.00',
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

describe('Geography', () => {
  let fixture: ComponentFixture<Geography>;
  let page: Geography;
  let analytics: { geography: ReturnType<typeof vi.fn> };
  let clipboard: { writeText: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    analytics = { geography: vi.fn(async () => report) };
    clipboard = { writeText: vi.fn(async () => undefined) };
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });

    await TestBed.configureTestingModule({
      imports: [Geography],
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

    fixture = TestBed.createComponent(Geography);
    page = fixture.componentInstance;
    await settle(fixture);
  });

  it('renders headline metrics, the comparison window and every country row', () => {
    const text = textOf(fixture);

    expect(text).toContain('£80.00');
    expect(text).toContain('3');
    expect(text).toContain('62.50%');
    expect(text).toContain('1 Dec 2024 – 3 Dec 2024');
    expect(text).toContain('vs 28 Nov 2024 – 30 Nov 2024');

    expect(text).toContain('United Kingdom');
    expect(text).toContain('£50.00');
    expect(rows(fixture)).toHaveLength(3);
  });

  it('marks unmapped geography instead of dropping it', () => {
    const unassigned = rows(fixture)[2] as HTMLElement;

    expect(unassigned.textContent).toContain('Unassigned');
    expect(unassigned.textContent).toContain('no geography mapped');
  });

  it('picks the market with the highest recorded return rate', () => {
    expect(page.worstReturnCountry()).toBe('Germany');
    expect(textOf(fixture)).toContain('Germany');
  });

  it('colours change by direction and sizes the share bar from the percent value', () => {
    const growing = findText(fixture, '+25.00%');
    const declining = findText(fixture, '-20.00%');

    expect(growing.className).toContain('text-teal-700');
    expect(declining.className).toContain('text-amber-700');
    expect(page.shareWidth('62.50')).toBe(62.5);
    expect(page.shareWidth('140')).toBe(100);
    expect(page.shareWidth(null)).toBe(0);
  });

  it('hides and restores a column through the shared table preferences', () => {
    const headers = () =>
      [...fixture.nativeElement.querySelectorAll('thead th')].map((th: HTMLElement) =>
        th.textContent?.trim(),
      );
    expect(headers()).toContain('Orders');

    TestBed.inject(TablePreferencesService).toggleColumn('geography', 'orders');
    fixture.detectChanges();
    expect(headers()).not.toContain('Orders');

    TestBed.inject(TablePreferencesService).toggleColumn('geography', 'orders');
    fixture.detectChanges();
    expect(headers()).toContain('Orders');
  });

  it('copies the visible rows as tab-separated text', async () => {
    await page.copyRows();
    fixture.detectChanges();

    expect(clipboard.writeText).toHaveBeenCalledOnce();
    const copied = clipboard.writeText.mock.calls[0][0] as string;
    expect(copied.split('\n')[0]).toBe('Country\tNet sales\tOrders\tReturn rate %');
    expect(copied).toContain('United Kingdom\t50.0000\t4\t0.00');
    expect(textOf(fixture)).toContain('Copied the table to the clipboard.');
  });

  it('exports every row, including the comparison columns', async () => {
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:geography';
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    page.exportCsv();

    const csv = await blobs[0].text();
    expect(csv.split('\r\n')[0]).toBe(
      'Country,Net sales,Gross sales,Share %,Orders,Customers,Returned units,Return rate %,Previous net sales,Change %',
    );
    expect(csv).toContain('Germany,20.0000,22.0000,25.00,2,2,1,12.50,25.0000,-20.00');
  });

  it('shows an empty state when the range has no sales', async () => {
    analytics.geography.mockResolvedValueOnce({ ...report, has_data: false, rows: [] });
    await page.reload();
    await settle(fixture);

    expect(textOf(fixture)).toContain('No sales in this range');
    expect(rows(fixture)).toHaveLength(0);
  });

  it('surfaces a load failure and retries on demand', async () => {
    analytics.geography.mockRejectedValueOnce(
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
    expect(retry).toBeDefined();

    retry.click();
    await settle(fixture);

    expect(textOf(fixture)).not.toContain('Warehouse unavailable');
    expect(textOf(fixture)).toContain('United Kingdom');
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

function rows(fixture: ComponentFixture<unknown>): Element[] {
  return [...(fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr')];
}

function findText(fixture: ComponentFixture<unknown>, text: string): HTMLElement {
  const element = [...(fixture.nativeElement as HTMLElement).querySelectorAll('span')].find(
    (span) => span.textContent?.trim() === text,
  ) as HTMLElement | undefined;
  if (!element) {
    throw new Error(`Could not find "${text}" in the rendered page.`);
  }
  return element;
}

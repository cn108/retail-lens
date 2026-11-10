import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AnalyticsService,
  BasketAnalysis,
  GeographyPerformance,
  ProductPerformance,
  ReturnsAnalysis,
  SalesSummary,
  SalesTrend,
} from '../../core/api/analytics.service';
import { DatasetSummary, DatasetsService } from '../../core/api/datasets.service';
import { AlertList, Board, MonitoringService } from '../../core/api/monitoring.service';
import { AuthService } from '../../core/auth/auth.service';
import { Boards } from './boards';

const summary: SalesSummary = {
  has_data: true,
  compare: 'previous',
  date_from: '2024-12-01',
  date_to: '2024-12-03',
  comparison_date_from: '2024-11-28',
  comparison_date_to: '2024-11-30',
  gross_sales: '1300.0000',
  net_sales: '1200.0000',
  eligible_orders: 12,
  average_order_value: '100.0000',
  unique_customers: 9,
  sales_growth_percent: '12.50',
  previous_net_sales: '1000.0000',
  datasets: [],
};

const trend: SalesTrend = {
  granularity: 'month',
  has_data: true,
  date_from: '2024-12-01',
  date_to: '2024-12-03',
  compare: 'previous',
  comparison: null,
  points: [
    {
      period_start: '2024-12-01',
      period_end: '2024-12-31',
      label: 'Dec 2024',
      gross_sales: '1300.0000',
      net_sales: '1200.0000',
      orders: 12,
    },
  ],
};

const geography: GeographyPerformance = {
  has_data: true,
  compare: 'previous',
  date_from: '2024-12-01',
  date_to: '2024-12-03',
  comparison_date_from: '2024-11-28',
  comparison_date_to: '2024-11-30',
  net_sales: '1200.0000',
  country_count: 1,
  top_country_share: '100.00',
  rows: [
    {
      country: 'United Kingdom',
      net_sales: '1200.0000',
      gross_sales: '1300.0000',
      discount_total: '0.0000',
      share: '100.00',
      units: 30,
      orders: 12,
      customers: 9,
      returned_units: 0,
      return_value: '0.0000',
      return_rate: '0.00',
      previous_net_sales: '1000.0000',
      change_percent: '20.00',
      direction: 'growing',
    },
  ],
};

const returns: ReturnsAnalysis = {
  has_data: true,
  date_from: '2024-12-01',
  date_to: '2024-12-03',
  sales_lines: 4,
  return_lines: 1,
  sold_units: 26,
  returned_units: 1,
  return_rate: '3.85',
  gross_sales: '1300.0000',
  discount_total: '10.0000',
  discount_rate: '0.77',
  return_value: '5.0000',
  net_sales: '1200.0000',
  bridge: [],
  products: [],
  countries: [],
};

const basket: BasketAnalysis = {
  has_data: true,
  date_from: '2024-12-01',
  date_to: '2024-12-03',
  invoices: 3,
  pairs: [
    {
      product_a: { product_id: '1', source_product_code: 'ALPHA', description: 'Alpha' },
      product_b: { product_id: '2', source_product_code: 'BETA', description: 'Beta' },
      invoices: 2,
      support: '50.00',
      confidence_a_to_b: '66.67',
      confidence_b_to_a: '100.00',
      lift: '2.50',
    },
  ],
};

const products: ProductPerformance = {
  has_data: true,
  compare: 'previous',
  date_from: '2024-12-01',
  date_to: '2024-12-03',
  comparison_date_from: '2024-11-28',
  comparison_date_to: '2024-11-30',
  net_sales: '1200.0000',
  product_count: 1,
  top_product_share: '100.00',
  declining_products: 0,
  rows: [
    {
      product_id: '3',
      source_product_code: '84879',
      description: 'Bird ornament',
      dataset_id: 'dataset-1',
      dataset_name: 'December sales',
      net_sales: '800.0000',
      gross_sales: '850.0000',
      share: '66.67',
      units: 20,
      orders: 8,
      returned_units: 1,
      return_lines: 1,
      previous_net_sales: '700.0000',
      change_percent: '14.29',
      direction: 'growing',
    },
  ],
};

const breachedAlerts: AlertList = {
  metrics: [{ value: 'net_sales', label: 'Net sales' }],
  rules: [
    {
      id: 'rule-1',
      name: 'Net sales floor',
      metric: 'net_sales',
      metric_label: 'Net sales',
      comparator: 'below',
      threshold: '1000.0000',
      window_days: 30,
      dataset: null,
      enabled: true,
      last_checked_at: '2026-11-10T21:25:00Z',
      last_value: '0.0000',
      last_state: 'breached',
      events: [],
    },
    {
      id: 'rule-2',
      name: 'Orders ceiling',
      metric: 'orders',
      metric_label: 'Orders',
      comparator: 'above',
      threshold: '50.0000',
      window_days: 30,
      dataset: null,
      enabled: true,
      last_checked_at: '2026-11-10T21:25:00Z',
      last_value: '3.0000',
      last_state: 'ok',
      events: [],
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

function board(id: string, name: string, widgets: string[]): Board {
  return {
    id,
    name,
    description: '',
    widgets: widgets.map((type) => ({ type })),
    created_at: '2026-11-01T09:00:00Z',
    updated_at: '2026-11-01T09:00:00Z',
    created_by: null,
  };
}

describe('Boards', () => {
  let fixture: ComponentFixture<Boards>;
  let page: Boards;
  let store: Board[];
  let monitoring: {
    boards: ReturnType<typeof vi.fn>;
    createBoard: ReturnType<typeof vi.fn>;
    deleteBoard: ReturnType<typeof vi.fn>;
    targets: ReturnType<typeof vi.fn>;
    alerts: ReturnType<typeof vi.fn>;
  };
  let analytics: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    store = [
      board('board-1', 'Weekly trading review', ['kpi', 'trend']),
      board('board-2', 'Ops board', ['geography', 'alerts', 'top_products', 'basket']),
    ];
    monitoring = {
      boards: vi.fn(async () => store),
      createBoard: vi.fn(async (payload: { name: string; widgets: { type: string }[] }) => {
        const created = board(
          'board-3',
          payload.name,
          payload.widgets.map((item) => item.type),
        );
        store = [...store, created];
        return created;
      }),
      deleteBoard: vi.fn(async (id: string) => {
        store = store.filter((item) => item.id !== id);
      }),
      targets: vi.fn(async () => []),
      alerts: vi.fn(async () => breachedAlerts),
    };
    analytics = {
      summary: vi.fn(async () => summary),
      trend: vi.fn(async () => trend),
      geography: vi.fn(async () => geography),
      returns: vi.fn(async () => returns),
      basket: vi.fn(async () => basket),
      products: vi.fn(async () => products),
    };

    await TestBed.configureTestingModule({
      imports: [Boards],
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
        { provide: MonitoringService, useValue: monitoring },
        { provide: DatasetsService, useValue: { list: async () => datasets } },
        { provide: AnalyticsService, useValue: analytics },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Boards);
    page = fixture.componentInstance;
    await settle(fixture);
  });

  it('lists boards, selects the first and loads only its widgets', () => {
    const text = textOf(fixture);

    expect(text).toContain('Weekly trading review');
    expect(text).toContain('Ops board');
    expect(page.selected()?.id).toBe('board-1');

    expect(analytics['summary']).toHaveBeenCalledOnce();
    expect(analytics['trend']).toHaveBeenCalledOnce();
    expect(analytics['geography']).not.toHaveBeenCalled();
    expect(analytics['basket']).not.toHaveBeenCalled();

    expect(text).toContain('£1,200.00');
    expect(text).toContain('Dec 2024');
  });

  it('renders geography, cross-sell and products widgets for the selected board', async () => {
    await page.select(store[1]);
    await settle(fixture);
    const text = textOf(fixture);

    expect(analytics['geography']).toHaveBeenCalledOnce();
    expect(analytics['basket']).toHaveBeenCalledOnce();
    expect(analytics['products']).toHaveBeenCalledOnce();

    expect(text).toContain('United Kingdom');
    expect(text).toContain('ALPHA +');
    expect(text).toContain('BETA');
    expect(text).toContain('2.50×');
    expect(text).toContain('Bird ornament');
    expect(text).toContain('£800.00');
  });

  it('shows only breaching rules in the alerts widget', async () => {
    await page.select(store[1]);
    await settle(fixture);
    const text = textOf(fixture);

    expect(text).toContain('Net sales floor');
    expect(text).toContain('observed 0.0000 against 1000.0000');
    expect(text).not.toContain('Orders ceiling');
  });

  it('says nothing is breaching when every rule is within threshold', async () => {
    monitoring.alerts.mockResolvedValue({
      metrics: breachedAlerts.metrics,
      rules: [breachedAlerts.rules[1]],
    });
    await page.select(store[1]);
    await settle(fixture);

    expect(textOf(fixture)).toContain('Nothing is breaching.');
  });

  it('creates a board from the chosen widgets, then opens it', async () => {
    page.patchDraft({ name: '  Ops daily  ', widgets: ['basket'] });

    await page.createBoard(submitEvent());
    await settle(fixture);

    expect(monitoring.createBoard).toHaveBeenCalledWith({
      name: 'Ops daily',
      widgets: [{ type: 'basket' }],
    });
    expect(page.selected()?.name).toBe('Ops daily');
    expect(page.draft()).toEqual({ name: '', widgets: ['kpi', 'trend'] });
    expect(textOf(fixture)).toContain('ALPHA +');
    expect(textOf(fixture)).toContain('2.50×');
  });

  it('validates the board name and widget selection', async () => {
    await page.createBoard(submitEvent());
    fixture.detectChanges();
    expect(textOf(fixture)).toContain('Give the board a name.');

    page.patchDraft({ name: 'Empty board', widgets: [] });
    await page.createBoard(submitEvent());
    fixture.detectChanges();
    expect(textOf(fixture)).toContain('Choose at least one widget.');

    expect(monitoring.createBoard).not.toHaveBeenCalled();
  });

  it('deletes the open board and returns to the empty selection', async () => {
    await page.deleteBoard(store[0]);
    await settle(fixture);

    expect(monitoring.deleteBoard).toHaveBeenCalledWith('board-1');
    expect(page.selected()?.id).toBe('board-2');
    expect(textOf(fixture)).not.toContain('Weekly trading review');

    await page.deleteBoard(store[0]);
    await settle(fixture);

    expect(page.selected()).toBeNull();
    expect(textOf(fixture)).toContain('Pick a board');
  });
});

function submitEvent(): Event {
  return new Event('submit', { cancelable: true });
}

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

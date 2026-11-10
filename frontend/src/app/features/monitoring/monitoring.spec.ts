import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DatasetSummary, DatasetsService } from '../../core/api/datasets.service';
import {
  AlertList,
  MonitoringService,
  ReportSchedule,
  TargetProgress,
} from '../../core/api/monitoring.service';
import { ReportingService, SavedReportSummary } from '../../core/api/reporting.service';
import { AuthService } from '../../core/auth/auth.service';
import { Monitoring } from './monitoring';

const alertList: AlertList = {
  metrics: [
    { value: 'net_sales', label: 'Net sales' },
    { value: 'orders', label: 'Orders' },
  ],
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
      events: [
        {
          id: 'event-1',
          value: '0.0000',
          threshold: '1000.0000',
          message: 'Net sales below threshold',
          triggered_at: '2026-11-10T21:25:00Z',
          acknowledged_at: null,
        },
      ],
    },
  ],
};

const targets: TargetProgress[] = [
  {
    id: 'target-1',
    name: 'Q4 net sales',
    metric: 'net_sales',
    metric_label: 'Net sales',
    target: '10000.0000',
    actual: '5000.0000',
    attainment_percent: '50.00',
    expected_percent: '40.00',
    pace: 'ahead',
    period_start: '2024-10-01',
    period_end: '2024-12-31',
    days_elapsed: 40,
    days_total: 92,
    dataset: null,
  },
];

const schedules: ReportSchedule[] = [
  {
    id: 'schedule-1',
    report: 'report-1',
    report_name: 'Monthly board pack',
    frequency: 'weekly',
    format: 'csv',
    recipients: ['ops@example.com', 'cfo@example.com'],
    enabled: true,
    next_run_at: '2026-11-17T08:00:00Z',
    last_run_at: '2026-11-10T08:00:00Z',
    last_status: 'email_failed',
    last_error: 'SMTP 550 mailbox unavailable',
  },
];

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

describe('Monitoring', () => {
  let fixture: ComponentFixture<Monitoring>;
  let page: Monitoring;
  let api: {
    alerts: ReturnType<typeof vi.fn>;
    createAlert: ReturnType<typeof vi.fn>;
    updateAlert: ReturnType<typeof vi.fn>;
    deleteAlert: ReturnType<typeof vi.fn>;
    acknowledgeEvent: ReturnType<typeof vi.fn>;
    evaluateAlerts: ReturnType<typeof vi.fn>;
    targets: ReturnType<typeof vi.fn>;
    createTarget: ReturnType<typeof vi.fn>;
    deleteTarget: ReturnType<typeof vi.fn>;
    schedules: ReturnType<typeof vi.fn>;
    createSchedule: ReturnType<typeof vi.fn>;
    updateSchedule: ReturnType<typeof vi.fn>;
    deleteSchedule: ReturnType<typeof vi.fn>;
  };
  let reporting: { list: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    api = {
      alerts: vi.fn(async () => alertList),
      createAlert: vi.fn(async () => alertList.rules[0]),
      updateAlert: vi.fn(async () => alertList.rules[0]),
      deleteAlert: vi.fn(async () => undefined),
      acknowledgeEvent: vi.fn(async () => alertList.rules[0].events[0]),
      evaluateAlerts: vi.fn(async () => ({ ...alertList, created_events: 1 })),
      targets: vi.fn(async () => targets),
      createTarget: vi.fn(async () => targets[0]),
      deleteTarget: vi.fn(async () => undefined),
      schedules: vi.fn(async () => schedules),
      createSchedule: vi.fn(async () => schedules[0]),
      updateSchedule: vi.fn(async () => schedules[0]),
      deleteSchedule: vi.fn(async () => undefined),
    };
    reporting = { list: vi.fn(async () => reports) };

    await TestBed.configureTestingModule({
      imports: [Monitoring],
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
        { provide: MonitoringService, useValue: api },
        { provide: DatasetsService, useValue: { list: async () => datasets } },
        { provide: ReportingService, useValue: reporting },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Monitoring);
    page = fixture.componentInstance;
    await settle(fixture);
  });

  it('loads every section and shows the breached rule with its event', () => {
    const text = textOf(fixture);

    expect(page.counts()).toEqual({ alerts: 1, targets: 1, schedules: 1 });
    expect(text).toContain('Net sales floor');
    expect(text).toContain('Breached');
    expect(text).toContain('Net sales below');
    expect(text).toContain('1000.0000');
    expect(text).toContain('10 Nov 2026');
    expect(text).toContain('Acknowledge');
  });

  it('evaluates alerts on demand and reports what happened', async () => {
    await page.evaluateNow();
    fixture.detectChanges();

    expect(api.evaluateAlerts).toHaveBeenCalledOnce();
    expect(textOf(fixture)).toContain('Checked every enabled alert: 1 new breach.');

    api.evaluateAlerts.mockResolvedValueOnce({ ...alertList, created_events: 0 });
    await page.evaluateNow();
    fixture.detectChanges();

    expect(textOf(fixture)).toContain('no new breaches');
  });

  it('creates an alert from the trimmed draft and refreshes the list', async () => {
    page.patchAlertDraft({
      name: '  Margin floor  ',
      threshold: '250',
      window_days: 14,
      dataset: 'dataset-1',
    });

    await page.createAlert(submitEvent());
    fixture.detectChanges();

    expect(api.createAlert).toHaveBeenCalledWith({
      name: 'Margin floor',
      metric: 'net_sales',
      comparator: 'below',
      threshold: '250',
      window_days: 14,
      dataset: 'dataset-1',
    });
    expect(page.alertDraft().name).toBe('');
    expect(api.alerts).toHaveBeenCalledTimes(2);
  });

  it('refuses to create an alert without a name', async () => {
    page.patchAlertDraft({ name: '   ' });

    await page.createAlert(submitEvent());
    fixture.detectChanges();

    expect(api.createAlert).not.toHaveBeenCalled();
    expect(textOf(fixture)).toContain('Give the alert a name.');
  });

  it('acknowledges an event and reloads the rules', async () => {
    await page.acknowledge('event-1');

    expect(api.acknowledgeEvent).toHaveBeenCalledWith('event-1');
    expect(api.alerts).toHaveBeenCalledTimes(2);
  });

  it('shows target pace and allows deleting a target', async () => {
    page.section.set('targets');
    fixture.detectChanges();
    const text = textOf(fixture);

    expect(text).toContain('Q4 net sales');
    expect(text).toContain('Ahead of pace');
    expect(text).toContain('£5,000');
    expect(text).toContain('£10,000');
    expect(text).toContain('50.0%');
    expect(text).toContain('40.00% expected · day 40 of 92');

    await page.removeTarget(targets[0]);
    expect(api.deleteTarget).toHaveBeenCalledWith('target-1');
  });

  it('lists scheduled delivery with recipients and the last result', async () => {
    page.section.set('schedules');
    fixture.detectChanges();
    const text = textOf(fixture);

    expect(text).toContain('Monthly board pack');
    expect(text).toContain('ops@example.com, cfo@example.com');
    expect(text).toContain('Email failed');
    expect(text).toContain('SMTP 550 mailbox unavailable');
    expect(text).toContain('Pause');

    await page.toggleSchedule(schedules[0]);
    expect(api.updateSchedule).toHaveBeenCalledWith('schedule-1', { enabled: false });
  });

  it('asks for a saved report before scheduling anything', async () => {
    reporting.list.mockResolvedValueOnce([]);
    await page.loadAll();
    page.section.set('schedules');
    fixture.detectChanges();

    expect(textOf(fixture)).toContain('Save a report first, then schedule it here.');
  });

  it('surfaces a load failure with a retry action', async () => {
    api.alerts.mockRejectedValueOnce(new Error('network down'));
    await page.loadAll();
    fixture.detectChanges();

    expect(textOf(fixture)).toContain('Monitoring could not be loaded.');
    expect(textOf(fixture)).toContain('Retry');
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

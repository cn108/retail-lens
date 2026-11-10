import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { apiErrorMessage } from '../../core/api/api-error';
import { DatasetSummary, DatasetsService } from '../../core/api/datasets.service';
import {
  AlertComparator,
  AlertList,
  AlertMetric,
  AlertRule,
  MetricChoice,
  MonitoringService,
  ReportSchedule,
  ScheduleFrequency,
  TargetProgress,
} from '../../core/api/monitoring.service';
import { ReportingService, SavedReportSummary } from '../../core/api/reporting.service';
import { AuthService } from '../../core/auth/auth.service';
import { formatDate } from '../../core/formatting';
import { LoadingState } from '../../shared/loading-state';

type Section = 'alerts' | 'targets' | 'schedules';

interface AlertDraft {
  name: string;
  metric: AlertMetric;
  comparator: AlertComparator;
  threshold: string;
  window_days: number;
  dataset: string;
}

interface TargetDraft {
  name: string;
  metric: AlertMetric;
  amount: string;
  period_start: string;
  period_end: string;
}

interface ScheduleDraft {
  report: string;
  frequency: ScheduleFrequency;
  format: 'csv' | 'pdf';
  recipients: string;
}

@Component({
  selector: 'app-monitoring',
  imports: [RouterLink, LoadingState],
  template: `
    <header class="mb-6">
      <p class="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Operations</p>
      <h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
        Monitoring
      </h1>
      <p class="mt-2 max-w-2xl text-sm text-slate-600">
        Threshold alerts, period targets and scheduled report delivery. Values are recomputed from
        the same warehouse as the dashboards, so a breach always matches what you can see.
      </p>
    </header>

    <div class="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 text-sm">
      @for (item of sections; track item.value) {
        <button
          type="button"
          class="rounded-lg px-3 py-1.5 font-medium"
          [class]="
            section() === item.value
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          "
          (click)="section.set(item.value)"
        >
          {{ item.label }}
          <span class="ml-1 text-xs text-slate-400">{{ counts()[item.value] }}</span>
        </button>
      }
    </div>

    @if (error(); as message) {
      <div
        role="alert"
        class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900"
      >
        <span>{{ message }}</span>
        <button type="button" class="font-semibold underline" (click)="loadAll()">Retry</button>
      </div>
    }

    @if (loading()) {
      <app-loading-state label="Loading monitoring" />
    } @else {
      @if (section() === 'alerts') {
        <section class="mt-6 space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="text-lg font-semibold text-slate-900">Threshold alerts</h2>
              <p class="mt-1 text-sm text-slate-600">
                Checked hourly by the worker. An alert records one event per breach, not one per
                check.
              </p>
            </div>
            <button
              type="button"
              class="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              [disabled]="evaluating()"
              (click)="evaluateNow()"
            >
              {{ evaluating() ? 'Checking…' : 'Check now' }}
            </button>
          </div>

          @if (evaluationNote(); as note) {
            <p class="rounded-lg bg-sky-50 px-4 py-2 text-sm text-sky-900" role="status">
              {{ note }}
            </p>
          }

          <form
            class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-2 lg:grid-cols-5"
            (submit)="createAlert($event)"
          >
            <label class="block lg:col-span-2">
              <span class="text-xs font-medium uppercase tracking-wide text-slate-500">Name</span>
              <input
                name="alertName"
                required
                [value]="alertDraft().name"
                (input)="patchAlertDraft({ name: value($event) })"
                class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100"
                placeholder="Net sales floor"
              />
            </label>
            <label class="block">
              <span class="text-xs font-medium uppercase tracking-wide text-slate-500">Metric</span>
              <select
                [value]="alertDraft().metric"
                (change)="metricChanged($event)"
                class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                @for (metric of metrics(); track metric.value) {
                  <option [value]="metric.value">{{ metric.label }}</option>
                }
              </select>
            </label>
            <label class="block">
              <span class="text-xs font-medium uppercase tracking-wide text-slate-500"
                >Condition</span
              >
              <select
                [value]="alertDraft().comparator"
                (change)="comparatorChanged($event)"
                class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="below">Falls below</option>
                <option value="above">Rises above</option>
              </select>
            </label>
            <div class="flex items-end gap-2">
              <label class="block flex-1">
                <span class="text-xs font-medium uppercase tracking-wide text-slate-500"
                  >Threshold</span
                >
                <input
                  type="number"
                  step="0.01"
                  required
                  [value]="alertDraft().threshold"
                  (input)="patchAlertDraft({ threshold: value($event) })"
                  class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label class="block w-24">
                <span class="text-xs font-medium uppercase tracking-wide text-slate-500">Days</span>
                <input
                  type="number"
                  min="1"
                  max="365"
                  [value]="alertDraft().window_days"
                  (input)="patchAlertDraft({ window_days: number($event) })"
                  class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
            </div>
            <label class="block lg:col-span-2">
              <span class="text-xs font-medium uppercase tracking-wide text-slate-500"
                >Dataset</span
              >
              <select
                [value]="alertDraft().dataset"
                (change)="patchAlertDraft({ dataset: value($event) })"
                class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">All processed datasets</option>
                @for (dataset of availableDatasets(); track dataset.id) {
                  <option [value]="dataset.id">{{ dataset.name }}</option>
                }
              </select>
            </label>
            <div class="flex items-end">
              <button
                type="submit"
                class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                [disabled]="saving()"
              >
                Add alert
              </button>
            </div>
          </form>

          @if (!rules().length) {
            <p
              class="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500"
            >
              No alerts yet. Add one above, then use “Check now” to evaluate it immediately.
            </p>
          } @else {
            @for (rule of rules(); track rule.id) {
              <article class="rounded-2xl border border-slate-200 bg-white p-5">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div class="flex flex-wrap items-center gap-2">
                      <h3 class="text-sm font-semibold text-slate-900">{{ rule.name }}</h3>
                      <span
                        class="rounded-full px-2 py-0.5 text-[11px] font-medium"
                        [class]="stateClass(rule)"
                      >
                        {{ stateLabel(rule) }}
                      </span>
                    </div>
                    <p class="mt-1 text-sm text-slate-600">
                      {{ rule.metric_label }} {{ rule.comparator === 'below' ? 'below' : 'above' }}
                      <strong>{{ rule.threshold }}</strong> over {{ rule.window_days }} days
                      @if (rule.last_value !== null) {
                        · last observed <strong>{{ rule.last_value }}</strong>
                      }
                    </p>
                    <p class="mt-1 text-xs text-slate-500">
                      {{
                        rule.last_checked_at
                          ? 'Checked ' + dateTime(rule.last_checked_at)
                          : 'Not checked yet'
                      }}
                    </p>
                  </div>
                  <div class="flex items-center gap-2 text-xs">
                    <label class="flex items-center gap-1.5 text-slate-600">
                      <input
                        type="checkbox"
                        class="size-3.5 rounded border-slate-300"
                        [checked]="rule.enabled"
                        (change)="toggleAlert(rule, $event)"
                      />
                      Enabled
                    </label>
                    <button
                      type="button"
                      class="rounded-lg border border-slate-300 px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                      (click)="removeAlert(rule)"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                @if (rule.events.length) {
                  <ul class="mt-3 divide-y divide-slate-100 border-t border-slate-100">
                    @for (event of rule.events; track event.id) {
                      <li class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                        <span class="text-slate-700">
                          {{ dateTime(event.triggered_at) }} · observed {{ event.value }}
                        </span>
                        @if (event.acknowledged_at) {
                          <span class="text-xs text-teal-700">
                            Acknowledged {{ dateTime(event.acknowledged_at) }}
                          </span>
                        } @else {
                          <button
                            type="button"
                            class="text-xs font-semibold text-sky-700 hover:underline"
                            (click)="acknowledge(event.id)"
                          >
                            Acknowledge
                          </button>
                        }
                      </li>
                    }
                  </ul>
                }
              </article>
            }
          }
        </section>
      }

      @if (section() === 'targets') {
        <section class="mt-6 space-y-4">
          <div>
            <h2 class="text-lg font-semibold text-slate-900">Targets</h2>
            <p class="mt-1 text-sm text-slate-600">
              Progress counts up to today. Expected progress is the share of the period elapsed, so
              you can see pace rather than just an end-of-period number.
            </p>
          </div>

          <form
            class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-2 lg:grid-cols-6"
            (submit)="createTarget($event)"
          >
            <label class="block lg:col-span-2">
              <span class="text-xs font-medium uppercase tracking-wide text-slate-500">Name</span>
              <input
                required
                [value]="targetDraft().name"
                (input)="patchTargetDraft({ name: value($event) })"
                class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Q4 net sales"
              />
            </label>
            <label class="block">
              <span class="text-xs font-medium uppercase tracking-wide text-slate-500">Metric</span>
              <select
                [value]="targetDraft().metric"
                (change)="metricChanged($event)"
                class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                @for (metric of metrics(); track metric.value) {
                  <option [value]="metric.value">{{ metric.label }}</option>
                }
              </select>
            </label>
            <label class="block">
              <span class="text-xs font-medium uppercase tracking-wide text-slate-500">Amount</span>
              <input
                type="number"
                step="0.01"
                required
                [value]="targetDraft().amount"
                (input)="patchTargetDraft({ amount: value($event) })"
                class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label class="block">
              <span class="text-xs font-medium uppercase tracking-wide text-slate-500">From</span>
              <input
                type="date"
                required
                [value]="targetDraft().period_start"
                (input)="patchTargetDraft({ period_start: value($event) })"
                class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label class="block">
              <span class="text-xs font-medium uppercase tracking-wide text-slate-500">To</span>
              <input
                type="date"
                required
                [value]="targetDraft().period_end"
                (input)="patchTargetDraft({ period_end: value($event) })"
                class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <div class="flex items-end">
              <button
                type="submit"
                class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                [disabled]="saving()"
              >
                Add target
              </button>
            </div>
          </form>

          @if (!targets().length) {
            <p
              class="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500"
            >
              No targets yet. Add a period and amount to track pace.
            </p>
          } @else {
            <div class="grid gap-4 lg:grid-cols-2">
              @for (target of targets(); track target.id) {
                <article class="rounded-2xl border border-slate-200 bg-white p-5">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <h3 class="text-sm font-semibold text-slate-900">{{ target.name }}</h3>
                      <p class="mt-1 text-sm text-slate-600">
                        {{ target.metric_label }} · {{ date(target.period_start) }} –
                        {{ date(target.period_end) }}
                      </p>
                    </div>
                    <span
                      class="rounded-full px-2 py-0.5 text-[11px] font-medium"
                      [class]="paceClass(target)"
                    >
                      {{
                        target.pace === 'ahead'
                          ? 'Ahead of pace'
                          : target.pace === 'behind'
                            ? 'Behind pace'
                            : 'No pace'
                      }}
                    </span>
                  </div>

                  <p class="mt-3 text-2xl font-semibold text-slate-900">
                    {{ money(target.actual) }}
                    <span class="text-sm font-normal text-slate-500"
                      >of {{ money(target.target) }}</span
                    >
                  </p>
                  <div class="relative mt-3 h-3 rounded-full bg-slate-100">
                    <div
                      class="h-3 rounded-full"
                      [class]="target.pace === 'behind' ? 'bg-amber-400' : 'bg-teal-500'"
                      [style.width.%]="attainment(target)"
                    ></div>
                    <span
                      class="absolute top-0 h-3 w-0.5 bg-slate-500"
                      [style.left.%]="expected(target)"
                      title="Expected progress"
                    ></span>
                  </div>
                  <div class="mt-1 flex justify-between text-xs text-slate-500">
                    <span
                      >{{
                        target.attainment_percent ? rate(target.attainment_percent) : '—'
                      }}
                      attained</span
                    >
                    <span
                      >{{ target.expected_percent }}% expected · day {{ target.days_elapsed }} of
                      {{ target.days_total }}</span
                    >
                  </div>

                  <button
                    type="button"
                    class="mt-3 text-xs font-semibold text-slate-500 hover:text-amber-700"
                    (click)="removeTarget(target)"
                  >
                    Delete target
                  </button>
                </article>
              }
            </div>
          }
        </section>
      }

      @if (section() === 'schedules') {
        <section class="mt-6 space-y-4">
          <div>
            <h2 class="text-lg font-semibold text-slate-900">Scheduled delivery</h2>
            <p class="mt-1 text-sm text-slate-600">
              Emails a saved report on a daily, weekly or monthly cadence. Delivery runs every 15
              minutes from the worker; failures are recorded on the schedule.
            </p>
          </div>

          @if (!reports().length) {
            <p
              class="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500"
            >
              Save a report first, then schedule it here.
              <a routerLink="/reports" class="font-semibold text-sky-700 hover:underline"
                >Go to reports</a
              >
            </p>
          } @else {
            <form
              class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-2 lg:grid-cols-6"
              (submit)="createSchedule($event)"
            >
              <label class="block lg:col-span-2">
                <span class="text-xs font-medium uppercase tracking-wide text-slate-500"
                  >Report</span
                >
                <select
                  [value]="scheduleDraft().report"
                  (change)="patchScheduleDraft({ report: value($event) })"
                  class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  @for (report of reports(); track report.id) {
                    <option [value]="report.id">{{ report.name }}</option>
                  }
                </select>
              </label>
              <label class="block">
                <span class="text-xs font-medium uppercase tracking-wide text-slate-500"
                  >Frequency</span
                >
                <select
                  [value]="scheduleDraft().frequency"
                  (change)="frequencyChanged($event)"
                  class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </label>
              <label class="block">
                <span class="text-xs font-medium uppercase tracking-wide text-slate-500"
                  >Format</span
                >
                <select
                  [value]="scheduleDraft().format"
                  (change)="formatChanged($event)"
                  class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="csv">CSV</option>
                  <option value="pdf">PDF</option>
                </select>
              </label>
              <label class="block lg:col-span-2">
                <span class="text-xs font-medium uppercase tracking-wide text-slate-500"
                  >Recipients</span
                >
                <input
                  required
                  [value]="scheduleDraft().recipients"
                  (input)="patchScheduleDraft({ recipients: value($event) })"
                  class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="ops@example.com, cfo@example.com"
                />
              </label>
              <div class="flex items-end">
                <button
                  type="submit"
                  class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  [disabled]="saving()"
                >
                  Schedule
                </button>
              </div>
            </form>
          }

          @if (schedules().length) {
            <div class="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <table class="w-full text-left text-sm">
                <thead class="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th class="px-5 py-2.5 font-medium">Report</th>
                    <th class="px-4 py-2.5 font-medium">Cadence</th>
                    <th class="px-4 py-2.5 font-medium">Recipients</th>
                    <th class="px-4 py-2.5 font-medium">Next run</th>
                    <th class="px-4 py-2.5 font-medium">Last result</th>
                    <th class="px-5 py-2.5"></th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  @for (schedule of schedules(); track schedule.id) {
                    <tr class="hover:bg-slate-50/60">
                      <td class="px-5 py-3">
                        <a
                          [routerLink]="['/reports', schedule.report]"
                          class="font-medium text-slate-900 hover:text-sky-700 hover:underline"
                        >
                          {{ schedule.report_name }}
                        </a>
                        <span class="block text-[11px] uppercase text-slate-500">
                          {{ schedule.format }}
                        </span>
                      </td>
                      <td class="px-4 capitalize text-slate-700">{{ schedule.frequency }}</td>
                      <td class="px-4 text-slate-700">{{ schedule.recipients.join(', ') }}</td>
                      <td class="px-4 text-slate-700">
                        {{
                          schedule.enabled && schedule.next_run_at
                            ? dateTime(schedule.next_run_at)
                            : 'Paused'
                        }}
                      </td>
                      <td class="px-4">
                        <span [class]="statusClass(schedule)">{{ statusLabel(schedule) }}</span>
                        @if (schedule.last_error) {
                          <span class="block text-[11px] text-amber-700">{{
                            schedule.last_error
                          }}</span>
                        }
                      </td>
                      <td class="px-5 text-right">
                        <div class="flex justify-end gap-2 text-xs">
                          <button
                            type="button"
                            class="font-medium text-slate-600 hover:text-slate-900"
                            (click)="toggleSchedule(schedule)"
                          >
                            {{ schedule.enabled ? 'Pause' : 'Resume' }}
                          </button>
                          <button
                            type="button"
                            class="font-medium text-slate-500 hover:text-amber-700"
                            (click)="removeSchedule(schedule)"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>
      }
    }
  `,
})
export class Monitoring {
  private readonly api = inject(MonitoringService);
  private readonly datasetsApi = inject(DatasetsService);
  private readonly reporting = inject(ReportingService);
  private readonly auth = inject(AuthService);

  readonly section = signal<Section>('alerts');
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly evaluating = signal(false);
  readonly error = signal<string | null>(null);
  readonly evaluationNote = signal<string | null>(null);

  readonly alertList = signal<AlertList | null>(null);
  readonly targets = signal<TargetProgress[]>([]);
  readonly schedules = signal<ReportSchedule[]>([]);
  readonly reports = signal<SavedReportSummary[]>([]);
  readonly availableDatasets = signal<DatasetSummary[]>([]);

  readonly rules = computed(() => this.alertList()?.rules ?? []);
  readonly metrics = computed<MetricChoice[]>(
    () =>
      this.alertList()?.metrics ?? [
        { value: 'net_sales', label: 'Net sales' },
        { value: 'orders', label: 'Orders' },
        { value: 'average_order_value', label: 'Average order value' },
        { value: 'customers', label: 'Unique customers' },
        { value: 'return_rate', label: 'Return rate (%)' },
        { value: 'discount_rate', label: 'Discount rate (%)' },
      ],
  );

  readonly counts = computed<Record<Section, number>>(() => ({
    alerts: this.rules().length,
    targets: this.targets().length,
    schedules: this.schedules().length,
  }));

  readonly alertDraft = signal({
    name: '',
    metric: 'net_sales' as AlertMetric,
    comparator: 'below' as AlertComparator,
    threshold: '1000',
    window_days: 30,
    dataset: '',
  });

  readonly targetDraft = signal({
    name: '',
    metric: 'net_sales' as AlertMetric,
    amount: '10000',
    period_start: monthStart(),
    period_end: monthEnd(),
  });

  readonly scheduleDraft = signal({
    report: '',
    frequency: 'weekly' as ScheduleFrequency,
    format: 'csv' as 'csv' | 'pdf',
    recipients: '',
  });

  readonly sections: { value: Section; label: string }[] = [
    { value: 'alerts', label: 'Alerts' },
    { value: 'targets', label: 'Targets' },
    { value: 'schedules', label: 'Scheduled delivery' },
  ];

  private lastOrganisationId: string | null = null;

  constructor() {
    effect(() => {
      const organisationId = this.auth.activeOrganisation()?.id ?? null;
      if (!organisationId || organisationId === this.lastOrganisationId) {
        return;
      }
      this.lastOrganisationId = organisationId;
      void this.loadAll();
    });
  }

  async loadAll(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [alerts, targets, schedules, reports, datasets] = await Promise.all([
        this.api.alerts(),
        this.api.targets(),
        this.api.schedules(),
        this.reporting.list(),
        this.datasetsApi.list(),
      ]);
      this.alertList.set(alerts);
      this.targets.set(targets);
      this.schedules.set(schedules);
      this.reports.set(reports);
      this.availableDatasets.set(
        datasets.filter((dataset) => dataset.status === 'ready' || dataset.status === 'failed'),
      );
      if (!this.scheduleDraft().report && reports.length) {
        this.scheduleDraft.update((draft) => ({ ...draft, report: reports[0].id }));
      }
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Monitoring could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }

  value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  number(event: Event): number {
    return Number((event.target as HTMLInputElement).value) || 1;
  }

  metricChanged(event: Event): void {
    const metric = this.value(event) as AlertMetric;
    this.patchAlertDraft({ metric });
    this.patchTargetDraft({ metric });
  }

  comparatorChanged(event: Event): void {
    this.patchAlertDraft({ comparator: this.value(event) as AlertComparator });
  }

  frequencyChanged(event: Event): void {
    this.patchScheduleDraft({ frequency: this.value(event) as ScheduleFrequency });
  }

  formatChanged(event: Event): void {
    this.patchScheduleDraft({ format: this.value(event) === 'pdf' ? 'pdf' : 'csv' });
  }

  patchAlertDraft(change: Partial<AlertDraft>): void {
    this.alertDraft.update((draft) => ({ ...draft, ...change }));
  }

  patchTargetDraft(change: Partial<TargetDraft>): void {
    this.targetDraft.update((draft) => ({ ...draft, ...change }));
  }

  patchScheduleDraft(change: Partial<ScheduleDraft>): void {
    this.scheduleDraft.update((draft) => ({ ...draft, ...change }));
  }

  async createAlert(event: Event): Promise<void> {
    event.preventDefault();
    const draft = this.alertDraft();
    if (!draft.name.trim()) {
      this.error.set('Give the alert a name.');
      return;
    }
    await this.run(async () => {
      await this.api.createAlert({
        name: draft.name.trim(),
        metric: draft.metric,
        comparator: draft.comparator,
        threshold: draft.threshold,
        window_days: draft.window_days,
        dataset: draft.dataset || null,
      });
      this.alertDraft.update((current) => ({ ...current, name: '' }));
      await this.refreshAlerts();
    });
  }

  async toggleAlert(rule: AlertRule, event: Event): Promise<void> {
    const enabled = (event.target as HTMLInputElement).checked;
    await this.run(async () => {
      await this.api.updateAlert(rule.id, { enabled });
      await this.refreshAlerts();
    });
  }

  async removeAlert(rule: AlertRule): Promise<void> {
    await this.run(async () => {
      await this.api.deleteAlert(rule.id);
      await this.refreshAlerts();
    });
  }

  async acknowledge(eventId: string): Promise<void> {
    await this.run(async () => {
      await this.api.acknowledgeEvent(eventId);
      await this.refreshAlerts();
    });
  }

  async evaluateNow(): Promise<void> {
    this.evaluating.set(true);
    this.error.set(null);
    try {
      const result = await this.api.evaluateAlerts();
      this.alertList.set(result);
      this.evaluationNote.set(
        result.created_events === 0
          ? 'Checked every enabled alert: no new breaches.'
          : `Checked every enabled alert: ${result.created_events} new breach${result.created_events === 1 ? '' : 'es'}.`,
      );
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Alerts could not be evaluated.'));
    } finally {
      this.evaluating.set(false);
    }
  }

  async createTarget(event: Event): Promise<void> {
    event.preventDefault();
    const draft = this.targetDraft();
    await this.run(async () => {
      await this.api.createTarget({
        name: draft.name.trim() || 'Untitled target',
        metric: draft.metric,
        amount: draft.amount,
        period_start: draft.period_start,
        period_end: draft.period_end,
      });
      this.targetDraft.update((current) => ({ ...current, name: '' }));
      this.targets.set(await this.api.targets());
    });
  }

  async removeTarget(target: TargetProgress): Promise<void> {
    await this.run(async () => {
      await this.api.deleteTarget(target.id);
      this.targets.set(await this.api.targets());
    });
  }

  async createSchedule(event: Event): Promise<void> {
    event.preventDefault();
    const draft = this.scheduleDraft();
    if (!draft.report) {
      this.error.set('Save a report before scheduling it.');
      return;
    }
    await this.run(async () => {
      await this.api.createSchedule({
        report: draft.report,
        frequency: draft.frequency,
        format: draft.format,
        recipients: draft.recipients,
      });
      this.scheduleDraft.update((current) => ({ ...current, recipients: '' }));
      this.schedules.set(await this.api.schedules());
    });
  }

  async toggleSchedule(schedule: ReportSchedule): Promise<void> {
    await this.run(async () => {
      await this.api.updateSchedule(schedule.id, { enabled: !schedule.enabled });
      this.schedules.set(await this.api.schedules());
    });
  }

  async removeSchedule(schedule: ReportSchedule): Promise<void> {
    await this.run(async () => {
      await this.api.deleteSchedule(schedule.id);
      this.schedules.set(await this.api.schedules());
    });
  }

  stateLabel(rule: AlertRule): string {
    return rule.last_state === 'breached'
      ? 'Breached'
      : rule.last_state === 'ok'
        ? 'Within threshold'
        : 'Not checked yet';
  }

  stateClass(rule: AlertRule): string {
    return rule.last_state === 'breached'
      ? 'bg-amber-100 text-amber-800'
      : rule.last_state === 'ok'
        ? 'bg-teal-50 text-teal-700'
        : 'bg-slate-100 text-slate-600';
  }

  paceClass(target: TargetProgress): string {
    return target.pace === 'ahead'
      ? 'bg-teal-50 text-teal-700'
      : target.pace === 'behind'
        ? 'bg-amber-100 text-amber-800'
        : 'bg-slate-100 text-slate-600';
  }

  statusLabel(schedule: ReportSchedule): string {
    if (schedule.last_status === 'succeeded') {
      return 'Delivered';
    }
    if (schedule.last_status === 'email_failed') {
      return 'Email failed';
    }
    if (schedule.last_status === 'failed') {
      return 'Export failed';
    }
    return 'Not run yet';
  }

  statusClass(schedule: ReportSchedule): string {
    return schedule.last_status === 'succeeded'
      ? 'text-teal-700'
      : schedule.last_status
        ? 'text-amber-700'
        : 'text-slate-500';
  }

  attainment(target: TargetProgress): number {
    return Math.max(0, Math.min(100, Number(target.attainment_percent ?? 0)));
  }

  expected(target: TargetProgress): number {
    return Math.max(0, Math.min(100, Number(target.expected_percent ?? 0)));
  }

  money(value: string | null): string {
    const amount = Number(value ?? 0);
    const currency = this.auth.activeOrganisation()?.currency ?? 'GBP';
    try {
      return new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }).format(amount);
    } catch {
      return `${amount.toFixed(0)} ${currency}`;
    }
  }

  rate(value: string): string {
    return `${Number(value).toFixed(1)}%`;
  }

  date(value: string | null): string {
    return formatDate(value);
  }

  dateTime(value: string | null): string {
    if (!value) {
      return '—';
    }
    const parsed = new Date(value);
    return `${formatDate(value.slice(0, 10))} ${parsed.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  }

  private async refreshAlerts(): Promise<void> {
    this.alertList.set(await this.api.alerts());
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    try {
      await action();
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'That change could not be saved.'));
    } finally {
      this.saving.set(false);
    }
  }
}

function monthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function monthEnd(): string {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(
    last.getDate(),
  ).padStart(2, '0')}`;
}

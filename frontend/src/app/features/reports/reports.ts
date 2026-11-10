import { Component, OnDestroy, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { apiErrorMessage } from '../../core/api/api-error';
import { DatasetSummary, DatasetsService } from '../../core/api/datasets.service';
import {
  CreateReportInput,
  ExportStatus,
  ReportExport,
  ReportFormat,
  ReportKind,
  ReportValue,
  ReportValueFormat,
  ReportingService,
  SavedReportDetail,
  SavedReportSummary,
} from '../../core/api/reporting.service';
import { AuthService } from '../../core/auth/auth.service';
import { formatDate, formatMoney, formatPercent } from '../../core/formatting';

const KINDS: { value: ReportKind; label: string }[] = [
  { value: 'sales', label: 'Sales performance' },
  { value: 'customers', label: 'Customer performance' },
  { value: 'products', label: 'Product performance' },
];

@Component({
  selector: 'app-reports',
  imports: [RouterLink],
  template: `
    <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Reporting</p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
          Reports
        </h1>
        <p class="mt-2 max-w-2xl text-sm text-slate-600">
          Save a metric view with its optional dataset and date filters, then generate a CSV or PDF
          that carries the same numbers and definitions. Reports recompute when opened, so they
          never drift from the dashboards.
        </p>
      </div>
      @if (detail(); as report) {
        <p class="text-right text-sm text-slate-600">
          {{ report.dataset?.name || 'All processed datasets' }}
          <span class="block text-xs text-slate-500">Saved {{ dateTime(report.created_at) }}</span>
        </p>
      }
    </header>

    <section id="report-form" class="rounded-2xl border border-slate-200 bg-white p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-sm font-semibold text-slate-900">
            {{ editingId() ? 'Edit report filters' : 'Save a report' }}
          </h2>
          <p class="mt-1 text-sm text-slate-600">
            {{
              editingId()
                ? 'Changing the filters updates this report everywhere; its exports keep their generated files.'
                : 'Choose a metric family and scope. The report stores the filters, not a frozen copy of the numbers.'
            }}
          </p>
        </div>
        @if (editingId()) {
          <button
            type="button"
            class="text-sm font-medium text-slate-600 hover:text-slate-900"
            (click)="cancelEdit()"
          >
            Cancel edit
          </button>
        }
      </div>

      @if (canAnalyse()) {
        <form class="mt-4 flex flex-wrap items-end gap-3" (submit)="create($event)">
          <label class="block min-w-48 flex-1">
            <span class="text-xs font-medium uppercase tracking-wide text-slate-500">Name</span>
            <input
              type="text"
              [value]="name()"
              (input)="name.set(readValue($event))"
              placeholder="Monthly board pack"
              maxlength="200"
              class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label class="block">
            <span class="text-xs font-medium uppercase tracking-wide text-slate-500">Report</span>
            <select
              [value]="kind()"
              (change)="kind.set(readKind($event))"
              class="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              @for (option of kinds; track option.value) {
                <option [value]="option.value" [selected]="option.value === kind()">
                  {{ option.label }}
                </option>
              }
            </select>
          </label>
          <label class="block min-w-44">
            <span class="text-xs font-medium uppercase tracking-wide text-slate-500">Dataset</span>
            <select
              [value]="datasetId()"
              (change)="datasetId.set(readValue($event))"
              class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">All processed datasets</option>
              @for (dataset of availableDatasets(); track dataset.id) {
                <option [value]="dataset.id" [selected]="dataset.id === datasetId()">
                  {{ dataset.name }}
                </option>
              }
            </select>
          </label>
          <label class="block">
            <span class="text-xs font-medium uppercase tracking-wide text-slate-500">From</span>
            <input
              type="date"
              [value]="dateFrom()"
              (change)="dateFrom.set(readValue($event))"
              class="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label class="block">
            <span class="text-xs font-medium uppercase tracking-wide text-slate-500">To</span>
            <input
              type="date"
              [value]="dateTo()"
              (change)="dateTo.set(readValue($event))"
              class="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            [disabled]="creating() || !availableDatasets().length"
            class="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
          >
            {{ creating() ? 'Saving…' : editingId() ? 'Save changes' : 'Save report' }}
          </button>
        </form>
        <p class="mt-2 text-xs text-slate-500">
          Leave the dates empty to use the full observed range. Leave the dataset on all processed
          datasets to include every ready dataset in the organisation.
        </p>
        @if (!availableDatasets().length) {
          <p class="mt-3 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Reports need a processed dataset.
            <a routerLink="/datasets" class="font-medium text-teal-700 hover:underline">
              Go to datasets
            </a>
          </p>
        }
      } @else {
        <p class="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Your role can open and download reports but not create or export them.
        </p>
      }
    </section>

    @if (error(); as message) {
      <p role="alert" class="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
        {{ message }}
      </p>
    }
    @if (notice(); as message) {
      <p role="status" class="mt-6 rounded-lg bg-teal-50 px-4 py-3 text-sm text-teal-900">
        {{ message }}
      </p>
    }

    @if (loading()) {
      <p class="mt-6 text-sm text-slate-500">Loading saved reports…</p>
    } @else if (!reports().length) {
      <section
        class="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"
      >
        <h2 class="text-lg font-semibold text-slate-900">No saved reports yet</h2>
        <p class="mx-auto mt-2 max-w-xl text-sm text-slate-600">
          Save a sales, customer or product report above. You can export it as CSV for analysis or
          PDF for sharing, with its metric definitions included.
        </p>
      </section>
    } @else {
      <section class="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 class="text-sm font-semibold text-slate-900">Saved reports</h2>
        <ul class="mt-3 divide-y divide-slate-100">
          @for (report of reports(); track report.id) {
            <li>
              <a
                [routerLink]="['/reports', report.id]"
                class="flex flex-wrap items-center justify-between gap-3 rounded-lg px-2 py-3 text-left hover:bg-slate-50"
                [class.bg-teal-50]="report.id === selectedId()"
                (click)="notice.set(null)"
              >
                <span>
                  <span class="block text-sm font-medium text-slate-900">{{ report.name }}</span>
                  <span class="mt-0.5 block text-xs text-slate-500">
                    {{ report.kind_label }} ·
                    {{ report.dataset?.name || 'All processed datasets' }} ·
                    {{ period(report) }}
                  </span>
                </span>
                <span class="text-xs font-medium text-teal-700">
                  {{ report.id === selectedId() ? 'Selected' : 'View' }}
                </span>
              </a>
            </li>
          }
        </ul>
      </section>
    }

    @if (loadingDetail() && !detail()) {
      <p class="mt-6 text-sm text-slate-500">Loading the report…</p>
    } @else if (detailError(); as message) {
      <p role="alert" class="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
        {{ message }}
      </p>
    } @else if (detail(); as report) {
      <section class="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
              {{ report.kind_label }}
            </p>
            <h2 class="mt-1 text-xl font-semibold text-slate-900">{{ report.name }}</h2>
            <p class="mt-1 text-sm text-slate-600">
              {{ report.dataset?.name || 'All processed datasets' }} · {{ resolvedPeriod(report) }}
            </p>
            <p class="mt-1 text-xs text-slate-500">
              Saved by {{ report.created_by || 'a former member' }} ·
              {{ dateTime(report.created_at) }} · generated {{ dateTime(report.generated_at) }}
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              (click)="share()"
            >
              Share
            </button>
            @if (canAnalyse()) {
              <button
                type="button"
                [disabled]="creating()"
                class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                (click)="startEdit(report)"
              >
                Edit filters
              </button>
              <button
                type="button"
                [disabled]="creating()"
                class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                (click)="duplicate(report)"
              >
                Duplicate
              </button>
              <button
                type="button"
                [disabled]="exportingFormat() !== null || activeExport() !== null"
                class="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
                (click)="generate('csv')"
              >
                {{ exportingFormat() === 'csv' ? 'Generating…' : 'Export CSV' }}
              </button>
              <button
                type="button"
                [disabled]="exportingFormat() !== null || activeExport() !== null"
                class="rounded-lg border border-teal-700 px-3 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50 disabled:opacity-60"
                (click)="generate('pdf')"
              >
                {{ exportingFormat() === 'pdf' ? 'Generating…' : 'Export PDF' }}
              </button>
              <button
                type="button"
                [disabled]="deleting()"
                class="rounded-lg border border-amber-300 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-60"
                (click)="remove()"
              >
                {{ deleting() ? 'Deleting…' : 'Delete' }}
              </button>
            }
          </div>
        </div>

        @if (!report.has_data) {
          <p class="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
            No processed facts match this report's dataset and dates. The export will document the
            empty selection rather than invent numbers.
          </p>
        }

        <dl class="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          @for (card of report.summary; track card.label) {
            <div class="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <dt class="text-xs font-medium uppercase tracking-wide text-slate-500">
                {{ card.label }}
              </dt>
              <dd class="mt-1 text-xl font-semibold text-slate-900">
                {{ value(card.value, card.format) }}
              </dd>
              <p class="mt-1 text-xs text-slate-500">{{ card.note }}</p>
            </div>
          }
        </dl>
      </section>

      @for (section of report.sections; track section.key) {
        <section class="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 class="text-sm font-semibold text-slate-900">{{ section.title }}</h2>
          <p class="mt-1 text-sm text-slate-600">{{ section.description }}</p>
          <div class="mt-4 overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead class="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  @for (column of section.columns; track column.key) {
                    <th class="py-2 pr-4 font-medium" [class.text-right]="column.format !== 'text'">
                      {{ column.label }}
                    </th>
                  }
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                @for (row of section.rows; track $index) {
                  <tr>
                    @for (column of section.columns; track column.key) {
                      <td
                        class="py-2 pr-4 text-slate-900"
                        [class.text-right]="column.format !== 'text'"
                        [class.text-slate-700]="column.format === 'text'"
                      >
                        {{ value(row[column.key], column.format) }}
                      </td>
                    }
                  </tr>
                } @empty {
                  <tr>
                    <td [attr.colspan]="section.columns.length" class="py-3 text-sm text-slate-500">
                      No rows for this selection.
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }

      <section class="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-sm font-semibold text-slate-900">Exports</h2>
            <p class="mt-1 text-sm text-slate-600">
              CSV opens in a spreadsheet; PDF includes the summary, tables and metric definitions.
              Each export is generated from the report as it is now.
            </p>
          </div>
          @if (activeExport(); as job) {
            <span class="rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-800">
              {{ job.format.toUpperCase() }} · {{ statusLabel(job.status) }}…
            </span>
          }
        </div>

        @if (!exports().length) {
          <p class="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
            No exports yet. Choose CSV or PDF to generate one.
          </p>
        } @else {
          <div class="mt-4 overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead class="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th class="py-2 pr-4 font-medium">Format</th>
                  <th class="py-2 pr-4 font-medium">Status</th>
                  <th class="py-2 pr-4 text-right font-medium">Rows</th>
                  <th class="py-2 pr-4 text-right font-medium">Size</th>
                  <th class="py-2 pr-4 font-medium">Created</th>
                  <th class="py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                @for (job of exports(); track job.id) {
                  <tr>
                    <td class="py-2 pr-4 font-medium text-slate-900">
                      {{ job.format.toUpperCase() }}
                    </td>
                    <td class="py-2 pr-4">
                      <span [class]="statusClass(job.status)">
                        {{ statusLabel(job.status) }}
                      </span>
                      @if (job.error_message) {
                        <p class="mt-1 text-xs text-red-700">{{ job.error_message }}</p>
                      }
                    </td>
                    <td class="py-2 pr-4 text-right text-slate-700">{{ job.row_count }}</td>
                    <td class="py-2 pr-4 text-right text-slate-700">
                      {{ size(job.size_bytes) }}
                    </td>
                    <td class="py-2 pr-4 text-slate-600">{{ dateTime(job.created_at) }}</td>
                    <td class="py-2 text-right">
                      @if (job.status === 'succeeded') {
                        <button
                          type="button"
                          [disabled]="downloadingJobId() === job.id"
                          class="text-sm font-medium text-teal-700 hover:underline disabled:opacity-60"
                          (click)="download(job)"
                        >
                          {{ downloadingJobId() === job.id ? 'Downloading…' : 'Download' }}
                        </button>
                      } @else if (job.status === 'queued' || job.status === 'running') {
                        <span class="text-xs text-slate-500">Generating…</span>
                      } @else {
                        <span class="text-xs text-slate-400">—</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>

      <section class="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 class="text-sm font-semibold text-slate-900">Metric definitions</h2>
        <p class="mt-1 text-sm text-slate-600">
          Every exported figure follows these definitions. The same implementations power the
          dashboard and analysis pages.
        </p>
        <div class="mt-4 overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th class="py-2 pr-4 font-medium">Metric</th>
                <th class="py-2 pr-4 font-medium">Definition</th>
                <th class="py-2 pr-4 font-medium">Grain</th>
                <th class="py-2 font-medium">Exclusions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (definition of report.definitions; track definition.metric) {
                <tr>
                  <td class="py-2 pr-4 font-medium text-slate-900">{{ definition.metric }}</td>
                  <td class="py-2 pr-4 text-slate-600">{{ definition.definition }}</td>
                  <td class="py-2 pr-4 text-slate-600">{{ definition.grain }}</td>
                  <td class="py-2 text-slate-600">{{ definition.exclusions }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        @for (note of report.notes; track note) {
          <p class="mt-3 text-xs text-slate-500">{{ note }}</p>
        }
      </section>
    }

    @if (deleteConfirm()) {
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
        role="presentation"
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-report-title"
          class="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
        >
          <h2 id="delete-report-title" class="text-lg font-semibold text-slate-900">
            Delete this report?
          </h2>
          <p class="mt-2 text-sm text-slate-600">
            “{{ detail()?.name }}” and its generated exports will be removed. This cannot be undone.
          </p>
          <div class="mt-6 flex justify-end gap-2">
            <button
              type="button"
              class="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              (click)="cancelDelete()"
            >
              Cancel
            </button>
            <button
              type="button"
              [disabled]="deleting()"
              class="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60"
              (click)="confirmDelete()"
            >
              {{ deleting() ? 'Deleting…' : 'Delete report' }}
            </button>
          </div>
        </section>
      </div>
    }
  `,
})
export class Reports implements OnDestroy {
  readonly id = input<string>('');

  private readonly reporting = inject(ReportingService);
  private readonly datasetsApi = inject(DatasetsService);
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);

  readonly kinds = KINDS;
  readonly reports = signal<SavedReportSummary[]>([]);
  readonly selectedId = signal('');
  readonly detail = signal<SavedReportDetail | null>(null);
  readonly exports = signal<ReportExport[]>([]);
  readonly availableDatasets = signal<DatasetSummary[]>([]);

  readonly name = signal('');
  readonly kind = signal<ReportKind>('sales');
  readonly datasetId = signal('');
  readonly dateFrom = signal('');
  readonly dateTo = signal('');
  readonly editingId = signal<string | null>(null);

  readonly loading = signal(true);
  readonly loadingDetail = signal(false);
  readonly creating = signal(false);
  readonly deleting = signal(false);
  readonly deleteConfirm = signal(false);
  readonly exportingFormat = signal<ReportFormat | null>(null);
  readonly downloadingJobId = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly detailError = signal<string | null>(null);
  readonly notice = signal<string | null>(null);

  readonly canAnalyse = computed(() => {
    const role = this.auth.activeOrganisation()?.role;
    return role === 'owner' || role === 'admin' || role === 'analyst';
  });
  readonly activeExport = computed<ReportExport | null>(
    () => this.exports().find((job) => job.status === 'queued' || job.status === 'running') ?? null,
  );
  readonly currency = computed(() => this.auth.activeOrganisation()?.currency ?? 'GBP');

  private listRequest = 0;
  private detailRequest = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastOrganisationId: string | null = null;

  constructor() {
    effect(() => {
      const organisationId = this.auth.activeOrganisation()?.id ?? null;
      if (organisationId === this.lastOrganisationId) {
        return;
      }
      this.lastOrganisationId = organisationId;
      if (organisationId === null) {
        return;
      }
      this.stopPolling();
      this.reports.set([]);
      this.selectedId.set('');
      this.detail.set(null);
      this.exports.set([]);
      this.availableDatasets.set([]);
      this.datasetId.set('');
      this.dateFrom.set('');
      this.dateTo.set('');
      this.editingId.set(null);
      this.error.set(null);
      this.detailError.set(null);
      this.notice.set(null);
      void this.loadDatasets();
      void this.loadReports();
    });

    effect(() => {
      const reportId = this.id();
      if (!reportId || reportId === this.selectedId()) {
        return;
      }
      if (!this.reports().some((report) => report.id === reportId)) {
        return;
      }
      void this.openReport(reportId);
    });
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  readValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  readKind(event: Event): ReportKind {
    return (event.target as HTMLSelectElement).value as ReportKind;
  }

  period(report: SavedReportSummary): string {
    if (!report.date_from && !report.date_to) {
      return 'All available data';
    }
    if (report.date_from && report.date_to) {
      return `${formatDate(report.date_from)} – ${formatDate(report.date_to)}`;
    }
    return report.date_from
      ? `From ${formatDate(report.date_from)}`
      : `To ${formatDate(report.date_to)}`;
  }

  resolvedPeriod(report: SavedReportDetail): string {
    if (!report.period.date_from || !report.period.date_to) {
      return 'No processed data in this selection';
    }
    return `${formatDate(report.period.date_from)} – ${formatDate(report.period.date_to)}`;
  }

  value(value: ReportValue, format: ReportValueFormat): string {
    if (value === null || value === '') {
      return '—';
    }
    if (format === 'money') {
      return formatMoney(String(value), this.currency());
    }
    if (format === 'percent') {
      return formatPercent(String(value));
    }
    if (format === 'number') {
      const number = Number(value);
      return Number.isFinite(number) ? number.toLocaleString('en-GB') : String(value);
    }
    return String(value);
  }

  dateTime(value: string | null): string {
    if (!value) {
      return '—';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  size(bytes: number): string {
    if (!bytes) {
      return '—';
    }
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${Math.round(bytes / 1024)} KiB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  }

  statusLabel(status: ExportStatus): string {
    switch (status) {
      case 'queued':
        return 'Queued';
      case 'running':
        return 'Running';
      case 'succeeded':
        return 'Ready';
      default:
        return 'Failed';
    }
  }

  statusClass(status: ExportStatus): string {
    const base = 'rounded-full px-2 py-1 text-xs font-medium ';
    switch (status) {
      case 'succeeded':
        return `${base}bg-teal-50 text-teal-800`;
      case 'queued':
      case 'running':
        return `${base}bg-sky-50 text-sky-800`;
      default:
        return `${base}bg-red-50 text-red-800`;
    }
  }

  async create(event: Event): Promise<void> {
    event.preventDefault();
    if (this.creating()) {
      return;
    }
    const name = this.name().trim();
    if (!name) {
      this.error.set('Give the report a name.');
      return;
    }
    this.creating.set(true);
    this.error.set(null);
    this.notice.set(null);
    this.detailError.set(null);
    const input: CreateReportInput = {
      name,
      kind: this.kind(),
      dataset: this.datasetId() || null,
      date_from: this.dateFrom() || null,
      date_to: this.dateTo() || null,
    };
    const editingId = this.editingId();
    try {
      const report = editingId
        ? await this.reporting.update(editingId, input)
        : await this.reporting.create(input);
      this.reports.update((reports) => [
        report,
        ...reports.filter((item) => item.id !== report.id),
      ]);
      this.selectedId.set(report.id);
      this.detail.set(report);
      this.exports.set(editingId ? this.exports() : []);
      this.notice.set(editingId ? 'Report updated.' : 'Report saved.');
      this.editingId.set(null);
      this.resetForm();
      if (!editingId) {
        await this.router.navigate(['/reports', report.id]);
      }
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'The report could not be saved.'));
    } finally {
      this.creating.set(false);
    }
  }

  startEdit(report: SavedReportDetail): void {
    this.editingId.set(report.id);
    this.name.set(report.name);
    this.kind.set(report.kind);
    this.datasetId.set(report.dataset?.id ?? '');
    this.dateFrom.set(report.date_from ?? '');
    this.dateTo.set(report.date_to ?? '');
    this.error.set(null);
    this.notice.set(null);
    document.getElementById('report-form')?.scrollIntoView({ behavior: 'smooth' });
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.resetForm();
    this.error.set(null);
  }

  async duplicate(report: SavedReportDetail): Promise<void> {
    this.creating.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      const copy = await this.reporting.create({
        name: `${report.name} (copy)`,
        kind: report.kind,
        dataset: report.dataset?.id ?? null,
        date_from: report.date_from,
        date_to: report.date_to,
      });
      this.reports.update((reports) => [copy, ...reports]);
      await this.router.navigate(['/reports', copy.id]);
      this.notice.set('Report duplicated.');
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'The report could not be duplicated.'));
    } finally {
      this.creating.set(false);
    }
  }

  async share(): Promise<void> {
    try {
      await navigator.clipboard.writeText(window.location.href);
      this.notice.set('Report link copied.');
    } catch {
      this.error.set('The report link could not be copied. Copy the URL from the address bar.');
    }
  }

  async openReport(reportId: string): Promise<void> {
    if (reportId === this.selectedId() && this.detail()) {
      return;
    }
    this.stopPolling();
    this.selectedId.set(reportId);
    this.detail.set(null);
    this.exports.set([]);
    this.detailError.set(null);
    await this.loadDetail(reportId);
  }

  async generate(format: ReportFormat): Promise<void> {
    const report = this.detail();
    if (!report || this.exportingFormat() !== null || this.activeExport() !== null) {
      return;
    }
    this.exportingFormat.set(format);
    this.error.set(null);
    this.notice.set(null);
    try {
      const job = await this.reporting.createExport(report.id, format);
      this.exports.update((jobs) => [job, ...jobs.filter((item) => item.id !== job.id)]);
      if (job.status === 'queued' || job.status === 'running') {
        this.startPolling();
      } else if (job.status === 'succeeded') {
        this.notice.set(`${job.format.toUpperCase()} export ready.`);
      } else {
        this.error.set(job.error_message || 'The export could not be generated.');
      }
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'The export could not be started.'));
    } finally {
      this.exportingFormat.set(null);
    }
  }

  async download(job: ReportExport): Promise<void> {
    this.downloadingJobId.set(job.id);
    this.error.set(null);
    try {
      const blob = await this.reporting.download(job.report_id, job.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = job.filename || `report.${job.format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'The export could not be downloaded.'));
    } finally {
      this.downloadingJobId.set(null);
    }
  }

  remove(): void {
    if (this.detail()) {
      this.deleteConfirm.set(true);
    }
  }

  cancelDelete(): void {
    this.deleteConfirm.set(false);
  }

  async confirmDelete(): Promise<void> {
    const report = this.detail();
    if (!report) {
      return;
    }
    this.deleteConfirm.set(false);
    this.deleting.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      await this.reporting.remove(report.id);
      this.stopPolling();
      const remaining = this.reports().filter((item) => item.id !== report.id);
      this.reports.set(remaining);
      this.detail.set(null);
      this.exports.set([]);
      this.selectedId.set('');
      this.editingId.set(null);
      await this.router.navigate(remaining.length ? ['/reports', remaining[0].id] : ['/reports'], {
        replaceUrl: true,
      });
      this.notice.set('Report deleted.');
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'The report could not be deleted.'));
    } finally {
      this.deleting.set(false);
    }
  }

  private resetForm(): void {
    this.name.set('');
    this.kind.set('sales');
    this.datasetId.set('');
    this.dateFrom.set('');
    this.dateTo.set('');
  }

  private async loadDatasets(): Promise<void> {
    try {
      const datasets = await this.datasetsApi.list();
      this.availableDatasets.set(datasets.filter((dataset) => dataset.status === 'ready'));
    } catch {
      // The form remains usable; a report cannot be saved without a dataset.
    }
  }

  private async loadReports(): Promise<void> {
    const request = ++this.listRequest;
    this.loading.set(true);
    this.error.set(null);
    try {
      const reports = await this.reporting.list();
      if (request !== this.listRequest) {
        return;
      }
      this.reports.set(reports);
      if (!reports.length) {
        this.selectedId.set('');
        this.detail.set(null);
        this.exports.set([]);
        if (this.id()) {
          await this.router.navigate(['/reports'], { replaceUrl: true });
        }
        return;
      }
      const requested = this.id();
      const target = reports.find((report) => report.id === requested) ?? reports[0];
      if (target.id !== requested) {
        await this.router.navigate(['/reports', target.id], { replaceUrl: true });
      }
      if (target.id !== this.selectedId() || !this.detail()) {
        await this.openReport(target.id);
      }
    } catch (error) {
      if (request === this.listRequest) {
        this.reports.set([]);
        this.detail.set(null);
        this.error.set(apiErrorMessage(error, 'Saved reports could not be loaded.'));
      }
    } finally {
      if (request === this.listRequest) {
        this.loading.set(false);
      }
    }
  }

  private async loadDetail(reportId: string): Promise<void> {
    const request = ++this.detailRequest;
    this.loadingDetail.set(true);
    this.detailError.set(null);
    try {
      const [report, jobs] = await Promise.all([
        this.reporting.get(reportId),
        this.reporting.listExports(reportId),
      ]);
      if (request !== this.detailRequest || reportId !== this.selectedId()) {
        return;
      }
      this.detail.set(report);
      this.exports.set(jobs);
      if (jobs.some((job) => job.status === 'queued' || job.status === 'running')) {
        this.startPolling();
      } else {
        this.stopPolling();
      }
    } catch (error) {
      if (request === this.detailRequest) {
        this.detail.set(null);
        this.exports.set([]);
        this.detailError.set(apiErrorMessage(error, 'This report could not be loaded.'));
        this.stopPolling();
      }
    } finally {
      if (request === this.detailRequest) {
        this.loadingDetail.set(false);
      }
    }
  }

  private startPolling(): void {
    if (this.pollTimer) {
      return;
    }
    this.pollTimer = setInterval(() => {
      void this.pollExports();
    }, 2000);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async pollExports(): Promise<void> {
    const reportId = this.selectedId();
    if (!reportId) {
      this.stopPolling();
      return;
    }
    try {
      const jobs = await this.reporting.listExports(reportId);
      if (reportId !== this.selectedId()) {
        return;
      }
      this.exports.set(jobs);
      if (!jobs.some((job) => job.status === 'queued' || job.status === 'running')) {
        this.stopPolling();
      }
    } catch {
      this.stopPolling();
      this.error.set('Export status could not be refreshed.');
    }
  }
}

import { Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';

import { DatasetSummary } from '../core/api/datasets.service';
import { apiErrorMessage } from '../core/api/api-error';
import {
  CreateReportInput,
  ReportFormat,
  ReportKind,
  ReportingService,
} from '../core/api/reporting.service';
import { AnalysisScopeService } from '../core/analysis/analysis-scope.service';
import { AuthService } from '../core/auth/auth.service';
import { WorkQueueService } from '../core/work/work-queue.service';
import { formatDate } from '../core/formatting';

type ActionFormat = 'none' | ReportFormat;

@Component({
  selector: 'app-report-view-actions',
  template: `
    @if (canAnalyse()) {
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          (click)="open('none')"
        >
          Save as report
        </button>
        <button
          type="button"
          class="rounded-lg border border-teal-700 px-3 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50"
          (click)="open('csv')"
        >
          Export CSV
        </button>
      </div>
    }

    @if (dialogOpen()) {
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 py-8"
        role="presentation"
        (click)="close()"
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="save-view-title"
          class="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
          (click)="$event.stopPropagation()"
          (keydown.escape)="close()"
        >
          <div class="flex items-start justify-between gap-4">
            <div>
              <h2 id="save-view-title" class="text-lg font-semibold text-slate-900">
                Save this view
              </h2>
              <p class="mt-1 text-sm text-slate-600">
                The report stores this scope and recomputes from the same metrics when opened.
              </p>
            </div>
            <button
              type="button"
              class="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              aria-label="Close"
              (click)="close()"
            >
              ×
            </button>
          </div>

          <div class="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {{ scopeLabel() }}
          </div>

          <label class="mt-4 block">
            <span class="text-sm font-medium text-slate-700">Report name</span>
            <input
              type="text"
              [value]="name()"
              (input)="name.set(readValue($event))"
              maxlength="200"
              class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
            />
          </label>

          <label class="mt-4 block">
            <span class="text-sm font-medium text-slate-700">After saving</span>
            <select
              [value]="format()"
              (change)="formatChanged($event)"
              class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="none">Open the report</option>
              <option value="csv">Open it and export CSV</option>
              <option value="pdf">Open it and export PDF</option>
            </select>
          </label>

          @if (error(); as message) {
            <p role="alert" class="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {{ message }}
            </p>
          }

          <div class="mt-6 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              [disabled]="busy()"
              class="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              (click)="close()"
            >
              Cancel
            </button>
            <button
              type="button"
              [disabled]="busy()"
              class="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
              (click)="submit()"
            >
              {{ busy() ? 'Saving…' : format() === 'none' ? 'Save report' : 'Save and export' }}
            </button>
          </div>
        </section>
      </div>
    }
  `,
})
export class ReportViewActions {
  readonly kind = input.required<ReportKind>();
  readonly label = input.required<string>();
  readonly datasets = input.required<DatasetSummary[]>();

  private readonly reporting = inject(ReportingService);
  private readonly scope = inject(AnalysisScopeService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly work = inject(WorkQueueService);

  readonly dialogOpen = signal(false);
  readonly name = signal('');
  readonly format = signal<ActionFormat>('none');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly canAnalyse = computed(() => {
    const role = this.auth.activeOrganisation()?.role;
    return role === 'owner' || role === 'admin' || role === 'analyst';
  });

  readonly scopeLabel = computed(() => {
    const dataset =
      this.datasets().find((item) => item.id === this.scope.dataset())?.name ??
      (this.scope.dataset() ? 'Selected dataset' : 'All processed datasets');
    const from = this.scope.dateFrom();
    const to = this.scope.dateTo();
    const period =
      from && to
        ? `${formatDate(from)} – ${formatDate(to)}`
        : from
          ? `from ${formatDate(from)}`
          : to
            ? `through ${formatDate(to)}`
            : 'all observed dates';
    return `${dataset} · ${period}`;
  });

  open(format: ActionFormat): void {
    this.name.set(
      `${this.label()} — ${new Date().toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })}`,
    );
    this.format.set(format);
    this.error.set(null);
    this.dialogOpen.set(true);
  }

  close(): void {
    if (!this.busy()) {
      this.dialogOpen.set(false);
    }
  }

  readValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  formatChanged(event: Event): void {
    const value = this.readValue(event);
    if (value === 'none' || value === 'csv' || value === 'pdf') {
      this.format.set(value);
    }
  }

  async submit(): Promise<void> {
    const name = this.name().trim();
    if (!name) {
      this.error.set('Give the report a name.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    const input: CreateReportInput = {
      name,
      kind: this.kind(),
      dataset: this.scope.dataset() || null,
      date_from: this.scope.dateFrom() || null,
      date_to: this.scope.dateTo() || null,
    };
    try {
      const report = await this.reporting.create(input);
      const format = this.format();
      if (format !== 'none') {
        await this.reporting.createExport(report.id, format);
        this.work.refresh();
      }
      this.dialogOpen.set(false);
      await this.router.navigate(['/reports', report.id]);
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'The report could not be saved.'));
    } finally {
      this.busy.set(false);
    }
  }
}

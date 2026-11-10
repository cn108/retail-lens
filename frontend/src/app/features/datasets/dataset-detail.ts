import { DatePipe } from '@angular/common';
import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { apiErrorMessage } from '../../core/api/api-error';
import {
  CanonicalField,
  CanonicalFieldCatalogue,
  DatasetDetail,
  DatasetStatus,
  DatasetsService,
  QualityIssue,
} from '../../core/api/datasets.service';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-dataset-detail',
  imports: [RouterLink, DatePipe],
  template: `
    <a routerLink="/datasets" class="text-sm font-medium text-slate-600 hover:text-slate-900">
      ← All datasets
    </a>

    @if (loading()) {
      <p class="mt-6 text-sm text-slate-500">Loading the dataset…</p>
    } @else if (error(); as message) {
      <p role="alert" class="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
        {{ message }}
      </p>
    } @else if (dataset(); as data) {
      <header class="mt-4 mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Dataset</p>
          <h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            {{ data.name }}
          </h1>
          <p class="mt-1 text-sm text-slate-600">
            {{ data.filename }} · {{ data.row_count }} rows · {{ data.column_count }} columns
          </p>
          <p class="mt-1 text-xs text-slate-500">
            {{ data.encoding }} · delimiter "{{ data.delimiter }}" · uploaded
            {{ data.created_at | date: 'medium' }}
            @if (data.created_by) {
              by {{ data.created_by }}
            }
          </p>
        </div>
        <span [class]="statusClass(data.status)">{{ statusLabel(data.status) }}</span>
      </header>

      @if (notice(); as message) {
        <p role="status" class="mb-6 rounded-lg bg-teal-50 px-4 py-3 text-sm text-teal-900">
          {{ message }}
        </p>
      }
      @if (mappingError(); as message) {
        <p role="alert" class="mb-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {{ message }}
        </p>
      }
      @if (data.warnings.length) {
        <ul class="mb-6 space-y-1 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          @for (warning of data.warnings; track warning) {
            <li>{{ warning }}</li>
          }
        </ul>
      }

      <section class="rounded-2xl border border-slate-200 bg-white p-6">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-sm font-semibold text-slate-900">Columns and mapping</h2>
            <p class="mt-1 max-w-2xl text-sm text-slate-600">
              Detected types come from the values in the file. Map each source column to the
              standard transaction field it represents; required fields are marked.
            </p>
          </div>
          @if (canAnalyse()) {
            <button
              type="button"
              [disabled]="saving()"
              class="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
              (click)="saveMapping()"
            >
              {{ saving() ? 'Saving…' : 'Save mapping' }}
            </button>
          }
        </div>

        @if (missingRequired().length) {
          <p class="mt-4 rounded-lg bg-slate-50 px-4 py-2 text-sm text-slate-700">
            Still required:
            @for (field of missingRequired(); track field.key) {
              <span class="font-medium">{{ field.label }}</span>
              @if (!$last) {
                <span>, </span>
              }
            }
          </p>
        }

        <div class="mt-4 overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th class="py-2 pr-4 font-medium">Source column</th>
                <th class="py-2 pr-4 font-medium">Detected type</th>
                <th class="py-2 pr-4 font-medium">Empty</th>
                <th class="py-2 pr-4 font-medium">Examples</th>
                <th class="py-2 font-medium">Maps to</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (column of data.columns; track column.id) {
                <tr>
                  <td class="py-3 pr-4 font-medium text-slate-900">{{ column.source_name }}</td>
                  <td class="py-3 pr-4 text-slate-600">{{ column.inferred_type }}</td>
                  <td class="py-3 pr-4 text-slate-600">{{ column.null_count }}</td>
                  <td class="max-w-56 truncate py-3 pr-4 text-slate-500">
                    {{ column.sample_values.join(', ') }}
                  </td>
                  <td class="py-3">
                    <select
                      [value]="mapping()[column.id] || ''"
                      [disabled]="!canAnalyse()"
                      (change)="setMapping(column.id, $event)"
                      class="min-w-48 rounded-lg border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50"
                    >
                      <option value="">Not mapped</option>
                      @for (field of catalogueFields(); track field.key) {
                        <option
                          [value]="field.key"
                          [selected]="mapping()[column.id] === field.key"
                          [disabled]="isUsedElsewhere(field.key, column.id)"
                        >
                          {{ field.label }}{{ field.required ? ' *' : '' }}
                        </option>
                      }
                    </select>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        @if (!canAnalyse()) {
          <p class="mt-4 text-sm text-slate-500">
            Your role can inspect this dataset but not change its mapping.
          </p>
        }
      </section>

      <section class="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-sm font-semibold text-slate-900">Processing</h2>
            @if (data.status === 'ready') {
              <p class="mt-1 text-sm text-slate-600">
                Raw rows and warehouse tables are loaded. Reprocessing replaces the previous output.
              </p>
            } @else if (data.status === 'processing') {
              <p class="mt-1 text-sm text-slate-600">
                Processing rows into the warehouse… this page updates itself.
              </p>
            } @else if (data.status === 'failed') {
              <p class="mt-1 text-sm text-amber-800">
                {{ data.processing.latest_run?.error_message || 'Processing failed.' }}
              </p>
            } @else if (data.mapping_complete) {
              <p class="mt-1 text-sm text-slate-600">
                Mapping complete. Process to preserve the raw rows and load the warehouse.
              </p>
            } @else {
              <p class="mt-1 text-sm text-slate-600">
                Complete the mapping before processing this dataset.
              </p>
            }
          </div>
          @if (data.processing.can_process && canAnalyse()) {
            <button
              type="button"
              [disabled]="starting()"
              class="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
              (click)="process()"
            >
              {{
                starting()
                  ? 'Starting…'
                  : data.status === 'ready' || data.status === 'failed'
                    ? 'Reprocess'
                    : 'Process dataset'
              }}
            </button>
          }
        </div>

        @if (data.processing.latest_run; as run) {
          <dl class="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div class="rounded-xl bg-slate-50 p-3">
              <dt class="text-xs uppercase tracking-wide text-slate-500">Rows read</dt>
              <dd class="mt-1 font-medium text-slate-900">{{ run.rows_read }}</dd>
            </div>
            <div class="rounded-xl bg-slate-50 p-3">
              <dt class="text-xs uppercase tracking-wide text-slate-500">Loaded</dt>
              <dd class="mt-1 font-medium text-slate-900">{{ run.rows_loaded }}</dd>
            </div>
            <div class="rounded-xl bg-slate-50 p-3">
              <dt class="text-xs uppercase tracking-wide text-slate-500">Rejected</dt>
              <dd class="mt-1 font-medium text-slate-900">{{ run.rows_rejected }}</dd>
            </div>
            <div class="rounded-xl bg-slate-50 p-3">
              <dt class="text-xs uppercase tracking-wide text-slate-500">Sales lines</dt>
              <dd class="mt-1 font-medium text-slate-900">
                {{ run.summary['sales_rows'] ?? 0 }}
              </dd>
            </div>
            <div class="rounded-xl bg-slate-50 p-3">
              <dt class="text-xs uppercase tracking-wide text-slate-500">Return lines</dt>
              <dd class="mt-1 font-medium text-slate-900">
                {{ run.summary['return_rows'] ?? 0 }}
              </dd>
            </div>
            <div class="rounded-xl bg-slate-50 p-3">
              <dt class="text-xs uppercase tracking-wide text-slate-500">Raw rows</dt>
              <dd class="mt-1 font-medium text-slate-900">
                {{ run.summary['raw_rows'] ?? 0 }}
              </dd>
            </div>
          </dl>
        }

        @if (issues().length) {
          <div class="mt-5">
            <h3 class="text-sm font-semibold text-slate-900">
              Quality issues ({{ data.processing.warehouse.issues }})
            </h3>
            <div class="mt-2 overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead class="text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th class="py-2 pr-4 font-medium">Row</th>
                    <th class="py-2 pr-4 font-medium">Issue</th>
                    <th class="py-2 font-medium">Detail</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  @for (issue of issues(); track issue.id) {
                    <tr>
                      <td class="py-2 pr-4 text-slate-600">{{ issue.row_number }}</td>
                      <td class="py-2 pr-4 font-medium text-slate-900">{{ issue.code }}</td>
                      <td class="py-2 text-slate-600">{{ issue.message }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        }
      </section>

      @if (canDelete()) {
        <section class="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 class="text-sm font-semibold text-slate-900">Remove dataset</h2>
          <p class="mt-1 text-sm text-slate-600">
            Deletes the uploaded file, its inspected columns and the mapping. This cannot be undone.
          </p>
          <button
            type="button"
            [disabled]="deleting()"
            class="mt-3 rounded-lg border border-amber-300 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-60"
            (click)="remove()"
          >
            {{ deleting() ? 'Deleting…' : 'Delete dataset' }}
          </button>
        </section>
      }
    }
  `,
})
export class DatasetDetailPage implements OnInit, OnDestroy {
  readonly id = input.required<string>();

  readonly auth = inject(AuthService);
  private readonly datasets = inject(DatasetsService);
  private readonly router = inject(Router);

  readonly dataset = signal<DatasetDetail | null>(null);
  readonly catalogue = signal<CanonicalFieldCatalogue | null>(null);
  readonly mapping = signal<Record<string, string>>({});
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly deleting = signal(false);
  readonly error = signal<string | null>(null);
  readonly mappingError = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly issues = signal<QualityIssue[]>([]);
  readonly starting = signal(false);

  readonly catalogueFields = computed(() => this.catalogue()?.fields ?? []);

  readonly missingRequired = computed<CanonicalField[]>(() => {
    const mapped = new Set(Object.values(this.mapping()).filter(Boolean));
    return this.catalogueFields().filter((field) => field.required && !mapped.has(field.key));
  });

  readonly canAnalyse = computed(() => {
    const role = this.auth.activeOrganisation()?.role;
    return role === 'owner' || role === 'admin' || role === 'analyst';
  });

  readonly canDelete = computed(() => {
    const role = this.auth.activeOrganisation()?.role;
    return role === 'owner' || role === 'admin';
  });

  private unload = new AbortController();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastOrganisationId: string | null = null;

  constructor() {
    effect(() => {
      const organisationId = this.auth.activeOrganisation()?.id ?? null;
      if (!organisationId) {
        return;
      }
      if (this.lastOrganisationId === null) {
        this.lastOrganisationId = organisationId;
        return;
      }
      if (organisationId !== this.lastOrganisationId) {
        this.lastOrganisationId = organisationId;
        void this.router.navigateByUrl('/datasets');
      }
    });
  }

  ngOnInit(): void {
    void this.load();
  }

  ngOnDestroy(): void {
    this.unload.abort();
    this.stopPolling();
  }

  statusLabel(status: DatasetStatus): string {
    switch (status) {
      case 'mapped':
        return 'Ready to process';
      case 'processing':
        return 'Processing';
      case 'ready':
        return 'Processed';
      case 'failed':
        return 'Processing failed';
      default:
        return 'Awaiting mapping';
    }
  }

  statusClass(status: DatasetStatus): string {
    const base = 'rounded-full px-3 py-1 text-xs font-medium ';
    switch (status) {
      case 'ready':
      case 'mapped':
        return `${base}bg-teal-50 text-teal-800`;
      case 'processing':
        return `${base}bg-sky-50 text-sky-800`;
      case 'failed':
        return `${base}bg-red-50 text-red-800`;
      default:
        return `${base}bg-amber-50 text-amber-800`;
    }
  }

  async process(): Promise<void> {
    this.starting.set(true);
    this.mappingError.set(null);
    this.notice.set(null);
    try {
      await this.datasets.process(this.id());
      await this.refreshDataset();
      this.startPolling();
      this.notice.set('Processing started.');
    } catch (error) {
      this.mappingError.set(apiErrorMessage(error, 'Processing could not be started.'));
    } finally {
      this.starting.set(false);
    }
  }

  setMapping(columnId: string, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.mapping.update((current) => ({ ...current, [columnId]: value }));
    this.mappingError.set(null);
    this.notice.set(null);
  }

  isUsedElsewhere(fieldKey: string, columnId: string): boolean {
    return Object.entries(this.mapping()).some(([id, key]) => id !== columnId && key === fieldKey);
  }

  async saveMapping(): Promise<void> {
    this.saving.set(true);
    this.mappingError.set(null);
    this.notice.set(null);
    try {
      const dataset = await this.datasets.updateMapping(this.id(), this.mapping());
      this.apply(dataset, { preferSuggestion: false });
      this.notice.set(
        dataset.mapping_complete
          ? 'Mapping saved. This dataset is ready for processing.'
          : 'Mapping saved, but required fields are still missing.',
      );
    } catch (error) {
      this.mappingError.set(apiErrorMessage(error, 'The mapping could not be saved.'));
    } finally {
      this.saving.set(false);
    }
  }

  async remove(): Promise<void> {
    if (!confirm('Delete this dataset and its uploaded file?')) {
      return;
    }
    this.deleting.set(true);
    try {
      await this.datasets.remove(this.id());
      await this.router.navigateByUrl('/datasets');
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'The dataset could not be deleted.'));
      this.deleting.set(false);
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [dataset, catalogue] = await Promise.all([
        this.datasets.get(this.id()),
        this.datasets.canonicalFields(),
      ]);
      this.catalogue.set(catalogue);
      this.apply(dataset, { preferSuggestion: true });
      if (dataset.status === 'processing') {
        this.startPolling();
      } else {
        await this.loadIssues();
      }
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'This dataset could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }

  private async refreshDataset(): Promise<void> {
    const dataset = await this.datasets.get(this.id());
    this.dataset.set(dataset);
    if (dataset.status !== 'processing') {
      await this.loadIssues();
    }
  }

  private async loadIssues(): Promise<void> {
    const count = this.dataset()?.processing.warehouse.issues ?? 0;
    if (!count) {
      this.issues.set([]);
      return;
    }
    try {
      this.issues.set(await this.datasets.issues(this.id()));
    } catch {
      // The summary still shows the count; the list is not critical.
    }
  }

  private startPolling(): void {
    if (this.pollTimer) {
      return;
    }
    this.pollTimer = setInterval(() => {
      void this.poll();
    }, 2000);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async poll(): Promise<void> {
    try {
      const dataset = await this.datasets.get(this.id());
      this.dataset.set(dataset);
      if (dataset.status !== 'processing') {
        this.stopPolling();
        await this.loadIssues();
        this.notice.set(dataset.status === 'ready' ? 'Processing finished.' : 'Processing failed.');
      }
    } catch {
      this.stopPolling();
    }
  }

  private apply(dataset: DatasetDetail, options: { preferSuggestion: boolean }): void {
    this.dataset.set(dataset);
    const mapping: Record<string, string> = {};
    for (const column of dataset.columns) {
      mapping[column.id] =
        column.canonical_field || (options.preferSuggestion ? column.suggested_field : '');
    }
    this.mapping.set(mapping);
  }
}

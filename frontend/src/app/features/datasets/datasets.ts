import { Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { apiErrorMessage } from '../../core/api/api-error';
import { DatasetStatus, DatasetSummary, DatasetsService } from '../../core/api/datasets.service';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-datasets',
  imports: [RouterLink],
  template: `
    <header class="mb-8">
      <p class="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Data ingestion</p>
      <h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
        Datasets
      </h1>
      <p class="mt-2 max-w-2xl text-sm text-slate-600">
        Upload a transaction export, inspect its columns, then map them to the standard transaction
        model. Nothing is processed until the mapping is complete.
      </p>
    </header>

    @if (error(); as message) {
      <p role="alert" class="mb-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
        {{ message }}
      </p>
    }

    <section class="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 class="text-sm font-semibold text-slate-900">Upload a CSV</h2>
      <p class="mt-1 text-sm text-slate-600">
        The file is preserved exactly as supplied. Up to 50 MiB, one header row and at least one
        data row.
        <a
          href="/sample-transactions.csv"
          download
          class="ml-1 font-medium text-teal-700 hover:underline"
        >
          Download a sample CSV
        </a>
      </p>

      @if (canUpload()) {
        <form
          (submit)="upload($event)"
          class="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
        >
          <label class="block">
            <span class="text-sm font-medium text-slate-700">File</span>
            <input
              type="file"
              accept=".csv,text/csv"
              (change)="chooseFile($event)"
              class="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700"
            />
          </label>
          <label class="block">
            <span class="text-sm font-medium text-slate-700">Name (optional)</span>
            <input
              type="text"
              [value]="name()"
              (input)="name.set($any($event.target).value)"
              placeholder="February sales"
              class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
            />
          </label>
          <button
            type="submit"
            [disabled]="uploading() || !file()"
            class="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
          >
            {{ uploading() ? 'Uploading…' : 'Upload' }}
          </button>
        </form>
        @if (file(); as chosen) {
          <p class="mt-2 text-xs text-slate-500">
            {{ chosen.name }} · {{ (chosen.size / 1024).toFixed(0) }} KiB
          </p>
        }
      } @else {
        <p class="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Your role can view datasets but not upload them. Ask an owner, admin or analyst.
        </p>
      }
    </section>

    <section class="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
      <h2 class="text-sm font-semibold text-slate-900">Your datasets</h2>

      @if (loading()) {
        <p class="mt-4 text-sm text-slate-500">Loading datasets…</p>
      } @else if (datasets().length === 0) {
        <p
          class="mt-4 rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-600"
        >
          No datasets yet. Upload a transaction export to begin.
        </p>
      } @else {
        <div class="mt-4 overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th class="py-2 pr-4 font-medium">Dataset</th>
                <th class="py-2 pr-4 font-medium">Status</th>
                <th class="py-2 pr-4 font-medium">Rows</th>
                <th class="py-2 pr-4 font-medium">Columns</th>
                <th class="py-2 pr-4 font-medium">Quality</th>
                <th class="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (dataset of datasets(); track dataset.id) {
                <tr>
                  <td class="py-3 pr-4">
                    <a
                      [routerLink]="['/datasets', dataset.id]"
                      class="font-medium text-slate-900 hover:text-teal-700"
                    >
                      {{ dataset.name }}
                    </a>
                    <p class="text-xs text-slate-500">{{ dataset.filename }}</p>
                  </td>
                  <td class="py-3 pr-4">
                    <span [class]="statusClass(dataset.status)">
                      {{ statusLabel(dataset.status) }}
                    </span>
                  </td>
                  <td class="py-3 pr-4 text-slate-700">{{ dataset.row_count }}</td>
                  <td class="py-3 pr-4 text-slate-700">{{ dataset.column_count }}</td>
                  <td class="py-3 pr-4 text-xs text-slate-600">
                    @if (dataset.status === 'ready') {
                      @if (dataset.rows_rejected || dataset.quality_issue_count) {
                        <span class="text-amber-800">
                          {{ dataset.rows_rejected }} rejected · {{ dataset.quality_issue_count }}
                          issues
                        </span>
                      } @else {
                        <span class="text-teal-700">No issues</span>
                      }
                    } @else {
                      —
                    }
                  </td>
                  <td class="py-3 text-right">
                    <a
                      [routerLink]="['/datasets', dataset.id]"
                      class="text-sm font-medium text-teal-700 hover:underline"
                    >
                      Open
                    </a>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
})
export class Datasets implements OnDestroy {
  readonly auth = inject(AuthService);
  private readonly datasetsService = inject(DatasetsService);
  private readonly router = inject(Router);

  readonly datasets = signal<DatasetSummary[]>([]);
  readonly loading = signal(true);
  readonly uploading = signal(false);
  readonly error = signal<string | null>(null);
  readonly file = signal<File | null>(null);
  readonly name = signal('');

  readonly canUpload = computed(() => {
    const role = this.auth.activeOrganisation()?.role;
    return role === 'owner' || role === 'admin' || role === 'analyst';
  });

  private lastOrganisationId: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => {
      const organisationId = this.auth.activeOrganisation()?.id ?? null;
      if (!organisationId || organisationId === this.lastOrganisationId) {
        return;
      }
      this.lastOrganisationId = organisationId;
      void this.load();
    });
  }

  ngOnDestroy(): void {
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
    const base = 'rounded-full px-2.5 py-1 text-xs font-medium ';
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

  chooseFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.file.set(input.files?.[0] ?? null);
    if (!this.name()) {
      this.name.set(input.files?.[0]?.name.replace(/\.csv$/i, '') ?? '');
    }
  }

  async upload(event: Event): Promise<void> {
    event.preventDefault();
    const file = this.file();
    if (!file || this.uploading()) {
      return;
    }
    this.uploading.set(true);
    this.error.set(null);
    try {
      const dataset = await this.datasetsService.upload(file, this.name());
      await this.router.navigate(['/datasets', dataset.id]);
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'The file could not be uploaded.'));
    } finally {
      this.uploading.set(false);
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const datasets = await this.datasetsService.list();
      this.datasets.set(datasets);
      if (datasets.some((dataset) => dataset.status === 'processing')) {
        this.startPolling();
      } else {
        this.stopPolling();
      }
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Could not load datasets.'));
    } finally {
      this.loading.set(false);
    }
  }

  private startPolling(): void {
    if (this.pollTimer) {
      return;
    }
    this.pollTimer = setInterval(() => void this.refresh(), 2500);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async refresh(): Promise<void> {
    try {
      const datasets = await this.datasetsService.list();
      this.datasets.set(datasets);
      if (!datasets.some((dataset) => dataset.status === 'processing')) {
        this.stopPolling();
      }
    } catch {
      this.stopPolling();
    }
  }
}

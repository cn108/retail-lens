import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { apiErrorMessage } from '../../core/api/api-error';
import { QualitySummary, DatasetsService } from '../../core/api/datasets.service';
import { AuthService } from '../../core/auth/auth.service';
import { formatDate } from '../../core/formatting';
import { LoadingState } from '../../shared/loading-state';
import { downloadCsv } from '../../shared/table-tools';

const REASON_LABELS: Record<string, string> = {
  invalid_price: 'Invalid price',
  invalid_quantity: 'Invalid quantity',
  invalid_date: 'Invalid date',
  missing_product: 'Missing product code',
  missing_invoice: 'Missing invoice number',
  missing_customer: 'Missing customer',
  missing_date: 'Missing date',
  duplicate_row: 'Duplicate row',
  unmapped_column: 'Unmapped column',
};

@Component({
  selector: 'app-quality',
  imports: [RouterLink, LoadingState],
  template: `
    <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
          Data reliability
        </p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
          Data quality
        </h1>
        <p class="mt-2 max-w-2xl text-sm text-slate-600">
          Every rejected row and the reason it failed, across all datasets in this organisation. Fix
          the source or the column mapping, then reprocess.
        </p>
      </div>
      @if (summary(); as data) {
        <button
          type="button"
          class="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
          (click)="exportCsv()"
        >
          Export CSV
        </button>
      }
    </header>

    @if (error(); as message) {
      <div
        role="alert"
        class="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900"
      >
        <span>{{ message }}</span>
        <button type="button" class="font-semibold underline" (click)="load()">Retry</button>
      </div>
    }

    @if (loading()) {
      <app-loading-state label="Loading data quality" />
    } @else if (summary(); as data) {
      <section class="grid gap-3 sm:grid-cols-3">
        <article class="rounded-2xl border border-slate-200 bg-white p-5">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Datasets</p>
          <p class="mt-2 text-2xl font-semibold text-slate-900">{{ data.dataset_count }}</p>
          <p class="mt-1 text-xs text-slate-500">Including datasets that were never processed</p>
        </article>
        <article class="rounded-2xl border border-slate-200 bg-white p-5">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Rows rejected</p>
          <p
            class="mt-2 text-2xl font-semibold"
            [class]="data.rows_rejected ? 'text-amber-700' : 'text-slate-900'"
          >
            {{ data.rows_rejected }}
          </p>
          <p class="mt-1 text-xs text-slate-500">From the latest run of each dataset</p>
        </article>
        <article class="rounded-2xl border border-slate-200 bg-white p-5">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Open issues</p>
          <p
            class="mt-2 text-2xl font-semibold"
            [class]="data.open_issues ? 'text-amber-700' : 'text-slate-900'"
          >
            {{ data.open_issues }}
          </p>
          <p class="mt-1 text-xs text-slate-500">Row-level findings recorded at processing time</p>
        </article>
      </section>

      @if (!data.dataset_count) {
        <section
          class="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"
        >
          <h2 class="text-lg font-semibold text-slate-900">No datasets yet</h2>
          <p class="mx-auto mt-2 max-w-xl text-sm text-slate-600">
            Upload a CSV first; rejected rows and their reasons appear here after processing.
          </p>
          <a
            routerLink="/datasets"
            class="mt-4 inline-block rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Upload a dataset
          </a>
        </section>
      } @else {
        @if (data.reasons.length) {
          <section class="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
            <h2 class="text-sm font-semibold text-slate-900">Why rows were rejected</h2>
            <p class="mt-1 text-sm text-slate-600">
              Across every dataset. A reason with many rows usually points at one mapping mistake.
            </p>
            <div class="mt-4 space-y-3">
              @for (reason of data.reasons; track reason.code) {
                <div class="grid grid-cols-[10rem_1fr_3rem] items-center gap-3 text-sm">
                  <span class="text-slate-600">{{ label(reason.code) }}</span>
                  <div class="h-2.5 rounded-full bg-slate-100">
                    <div
                      class="h-2.5 rounded-full bg-amber-400"
                      [style.width.%]="reasonWidth(reason.count)"
                    ></div>
                  </div>
                  <span class="text-right font-medium text-slate-900">{{ reason.count }}</span>
                </div>
              }
            </div>
          </section>
        }

        <section class="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div class="border-b border-slate-100 px-5 py-4">
            <h2 class="text-sm font-semibold text-slate-900">By dataset</h2>
            <p class="mt-1 text-sm text-slate-600">
              Worst first. Open a dataset to see the row detail.
            </p>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead class="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th class="px-5 py-2.5 font-medium">Dataset</th>
                  <th class="px-4 py-2.5 text-right font-medium">Rows read</th>
                  <th class="px-4 py-2.5 text-right font-medium">Rejected</th>
                  <th class="px-5 py-2.5 text-right font-medium">Issues</th>
                  <th class="px-5 py-2.5 font-medium">Top reason</th>
                  <th class="px-5 py-2.5 font-medium">Last run</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                @for (dataset of data.datasets; track dataset.dataset_id) {
                  <tr class="hover:bg-slate-50/60">
                    <td class="px-5 py-3">
                      <a
                        [routerLink]="['/datasets', dataset.dataset_id]"
                        class="font-medium text-slate-900 hover:text-sky-700 hover:underline"
                      >
                        {{ dataset.name }}
                      </a>
                      <span class="block text-[11px] capitalize text-slate-500">
                        {{ dataset.status }}
                      </span>
                    </td>
                    <td class="px-4 text-right text-slate-700">{{ dataset.rows_read }}</td>
                    <td
                      class="px-4 text-right font-medium"
                      [class]="dataset.rows_rejected ? 'text-amber-700' : 'text-slate-700'"
                    >
                      {{ dataset.rows_rejected }}
                    </td>
                    <td class="px-5 text-right text-slate-700">{{ dataset.issues }}</td>
                    <td class="px-5 text-slate-700">
                      {{ dataset.reasons.length ? label(dataset.reasons[0].code) : '—' }}
                    </td>
                    <td class="px-5 text-slate-500">
                      {{ dataset.last_run_at ? date(dataset.last_run_at) : 'Never processed' }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }
    }
  `,
})
export class Quality {
  private readonly datasetsApi = inject(DatasetsService);
  private readonly auth = inject(AuthService);

  readonly summary = signal<QualitySummary | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly maxReason = computed(() =>
    Math.max(1, ...(this.summary()?.reasons ?? []).map((reason) => reason.count)),
  );

  private lastOrganisation: string | null = null;

  constructor() {
    effect(() => {
      const organisationId = this.auth.activeOrganisation()?.id ?? null;
      if (!organisationId || organisationId === this.lastOrganisation) {
        return;
      }
      this.lastOrganisation = organisationId;
      void this.load();
    });
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.summary.set(await this.datasetsApi.qualitySummary());
    } catch (error) {
      this.summary.set(null);
      this.error.set(apiErrorMessage(error, 'Data quality could not be loaded.'));
    } finally {
      this.loading.set(false);
    }
  }

  label(code: string): string {
    return REASON_LABELS[code] ?? code.replaceAll('_', ' ');
  }

  reasonWidth(count: number): number {
    return Math.max(3, (count / this.maxReason()) * 100);
  }

  date(value: string): string {
    // The API returns a full timestamp for the run; formatDate takes a date part.
    return formatDate(value.slice(0, 10));
  }

  exportCsv(): void {
    const data = this.summary();
    if (!data) {
      return;
    }
    downloadCsv(
      'data-quality',
      [
        { header: 'Dataset', value: (row) => row.name },
        { header: 'Status', value: (row) => row.status },
        { header: 'Rows read', value: (row) => row.rows_read },
        { header: 'Rows rejected', value: (row) => row.rows_rejected },
        { header: 'Issues', value: (row) => row.issues },
        {
          header: 'Top reason',
          value: (row) => (row.reasons.length ? this.label(row.reasons[0].code) : ''),
        },
        { header: 'Last run', value: (row) => row.last_run_at ?? '' },
      ],
      data.datasets,
    );
  }
}

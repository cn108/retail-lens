import { Component, computed, inject, input } from '@angular/core';

import { DatasetSummary } from '../core/api/datasets.service';
import {
  AnalysisScopeService,
  CompareMode,
  DATE_PRESETS,
  DatePreset,
} from '../core/analysis/analysis-scope.service';
import { formatDate } from '../core/formatting';

@Component({
  selector: 'app-analysis-filter-bar',
  template: `
    <section class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div class="flex flex-wrap items-end gap-3">
        <label class="block min-w-52 flex-1">
          <span class="text-xs font-medium uppercase tracking-wide text-slate-500">Dataset</span>
          <select
            [value]="scope.dataset()"
            [disabled]="loading()"
            (change)="datasetChanged($event)"
            class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100 disabled:bg-slate-50"
          >
            <option value="">All processed datasets</option>
            @for (dataset of datasets(); track dataset.id) {
              <option [value]="dataset.id" [selected]="dataset.id === scope.dataset()">
                {{ dataset.name }}
              </option>
            }
          </select>
        </label>

        <label class="block min-w-40">
          <span class="text-xs font-medium uppercase tracking-wide text-slate-500">Period</span>
          <select
            [value]="scope.preset()"
            [disabled]="loading()"
            (change)="presetChanged($event)"
            class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100 disabled:bg-slate-50"
          >
            @if (scope.preset() === 'custom') {
              <option value="custom" disabled>Custom range</option>
            }
            @for (option of presets; track option.value) {
              <option [value]="option.value" [selected]="option.value === scope.preset()">
                {{ option.label }}
              </option>
            }
          </select>
        </label>

        <label class="block">
          <span class="text-xs font-medium uppercase tracking-wide text-slate-500">From</span>
          <input
            type="date"
            [value]="scope.dateFrom()"
            [disabled]="loading()"
            (change)="dateChanged('from', $event)"
            class="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100 disabled:bg-slate-50"
          />
        </label>
        <label class="block">
          <span class="text-xs font-medium uppercase tracking-wide text-slate-500">To</span>
          <input
            type="date"
            [value]="scope.dateTo()"
            [disabled]="loading()"
            (change)="dateChanged('to', $event)"
            class="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100 disabled:bg-slate-50"
          />
        </label>
        <label class="block min-w-44">
          <span class="text-xs font-medium uppercase tracking-wide text-slate-500">Compare to</span>
          <select
            [value]="scope.compare()"
            [disabled]="loading()"
            (change)="compareChanged($event)"
            class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100 disabled:bg-slate-50"
          >
            @for (option of comparisons; track option.value) {
              <option [value]="option.value" [selected]="option.value === scope.compare()">
                {{ option.label }}
              </option>
            }
          </select>
        </label>

        @if (scope.compare() === 'custom') {
          <label class="block">
            <span class="text-xs font-medium uppercase tracking-wide text-slate-500"
              >Baseline from</span
            >
            <input
              type="date"
              [value]="scope.compareFrom()"
              [disabled]="loading()"
              (change)="compareWindowChanged('from', $event)"
              class="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100 disabled:bg-slate-50"
            />
          </label>
          <label class="block">
            <span class="text-xs font-medium uppercase tracking-wide text-slate-500"
              >Baseline to</span
            >
            <input
              type="date"
              [value]="scope.compareTo()"
              [disabled]="loading()"
              (change)="compareWindowChanged('to', $event)"
              class="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100 disabled:bg-slate-50"
            />
          </label>
        }

        <button
          type="button"
          [disabled]="loading() || !hasFilters()"
          class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          (click)="scope.reset()"
        >
          Reset
        </button>
      </div>

      <div class="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <p class="leading-relaxed">
          Filters apply immediately and stay with you across the analysis pages.
          <span class="font-medium text-slate-700">{{ summary() }}</span
          >, {{ comparisonSummary() }}.
        </p>
        @if (hasFilters()) {
          <span class="rounded-full bg-sky-50 px-2.5 py-1 font-medium text-sky-700">
            Filtered view
          </span>
        } @else {
          <span class="rounded-full bg-sky-50 px-2.5 py-1 font-medium text-sky-700">
            All available data
          </span>
        }
      </div>
    </section>
  `,
})
export class AnalysisFilterBar {
  readonly datasets = input.required<DatasetSummary[]>();
  readonly loading = input(false);

  readonly scope = inject(AnalysisScopeService);
  readonly presets = DATE_PRESETS;
  readonly comparisons: { value: CompareMode; label: string }[] = [
    { value: 'previous', label: 'Previous period' },
    { value: 'year', label: 'Same dates last year' },
    { value: 'custom', label: 'Custom baseline' },
  ];

  readonly hasFilters = computed(
    () =>
      this.scope.dataset() !== '' ||
      this.scope.dateFrom() !== '' ||
      this.scope.dateTo() !== '' ||
      this.scope.compare() !== 'previous' ||
      this.scope.compareFrom() !== '' ||
      this.scope.compareTo() !== '',
  );

  readonly summary = computed(() => {
    const dataset = this.scope.dataset();
    const name =
      this.datasets().find((item) => item.id === dataset)?.name ??
      (dataset ? 'Selected dataset' : 'All processed datasets');
    const from = this.scope.dateFrom();
    const to = this.scope.dateTo();
    if (from && to) {
      return `${name} · ${formatDate(from)} – ${formatDate(to)}`;
    }
    if (from) {
      return `${name} · from ${formatDate(from)}`;
    }
    if (to) {
      return `${name} · through ${formatDate(to)}`;
    }
    return `${name} · all observed dates`;
  });

  readonly comparisonSummary = computed(() => {
    switch (this.scope.compare()) {
      case 'year':
        return 'compared with the same dates last year';
      case 'custom': {
        const from = this.scope.compareFrom();
        const to = this.scope.compareTo();
        if (from && to) {
          return `compared with ${formatDate(from)} – ${formatDate(to)}`;
        }
        return 'compared with a custom baseline';
      }
      default:
        return 'compared with the previous period';
    }
  });

  datasetChanged(event: Event): void {
    this.scope.apply({
      dataset: readValue(event),
      dateFrom: this.scope.dateFrom(),
      dateTo: this.scope.dateTo(),
      preset: this.scope.preset(),
    });
  }

  presetChanged(event: Event): void {
    const preset = readValue(event) as DatePreset;
    if (preset === 'custom') {
      return;
    }
    this.scope.usePreset(preset);
  }

  dateChanged(side: 'from' | 'to', event: Event): void {
    this.scope.apply({
      dataset: this.scope.dataset(),
      dateFrom: side === 'from' ? readValue(event) : this.scope.dateFrom(),
      dateTo: side === 'to' ? readValue(event) : this.scope.dateTo(),
      preset: 'custom',
    });
  }

  compareChanged(event: Event): void {
    this.scope.useComparison(readValue(event) as CompareMode);
  }

  compareWindowChanged(side: 'from' | 'to', event: Event): void {
    this.scope.setComparisonWindow(side, readValue(event));
  }
}

function readValue(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}

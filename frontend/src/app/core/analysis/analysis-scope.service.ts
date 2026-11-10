import { Injectable, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

export type DatePreset = 'all' | 'last7' | 'last30' | 'last90' | 'mtd' | 'qtd' | 'ytd' | 'custom';

export type CompareMode = 'previous' | 'year' | 'custom';

export interface AnalysisQuery {
  dataset?: string;
  date_from?: string;
  date_to?: string;
  compare?: CompareMode;
  compare_from?: string;
  compare_to?: string;
}

interface StoredScope {
  dataset: string;
  dateFrom: string;
  dateTo: string;
  preset: DatePreset;
  compare: CompareMode;
  compareFrom: string;
  compareTo: string;
}

const STORAGE_PREFIX = 'retaillens.scope.';
const EMPTY_SCOPE: StoredScope = {
  dataset: '',
  dateFrom: '',
  dateTo: '',
  preset: 'all',
  compare: 'previous',
  compareFrom: '',
  compareTo: '',
};

/**
 * One analysis scope shared by the dashboard and the sales, customer and
 * product pages. Keeping it here means changing page no longer throws away the
 * user's dataset and date filters, and the scope is mirrored into the URL so a
 * filtered view can be bookmarked or shared.
 */
@Injectable({ providedIn: 'root' })
export class AnalysisScopeService {
  private readonly router = inject(Router);
  private readonly organisation = signal<string | null>(null);

  readonly dataset = signal('');
  readonly dateFrom = signal('');
  readonly dateTo = signal('');
  readonly preset = signal<DatePreset>('all');
  readonly compare = signal<CompareMode>('previous');
  readonly compareFrom = signal('');
  readonly compareTo = signal('');
  /** Increments whenever an applied scope changes. Pages reload on this. */
  readonly revision = signal(0);

  constructor() {
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(() => this.readFromUrl());
  }

  /** Load the scope for an organisation once, then keep it across pages. */
  ensureFor(organisationId: string | null): void {
    if (!organisationId) {
      this.organisation.set(null);
      return;
    }
    if (this.organisation() === organisationId) {
      return;
    }

    const hadOrganisation = this.organisation() !== null;
    this.organisation.set(organisationId);
    // A switch keeps the old query string in the URL. Do not let the previous
    // organisation's dataset id leak into the new scope.
    const next = hadOrganisation ? null : this.fromUrl();
    this.setScope(next ?? this.fromStorage(organisationId));
    this.syncUrl();
    this.revision.update((value) => value + 1);
  }

  query(): AnalysisQuery {
    return {
      dataset: this.dataset() || undefined,
      date_from: this.dateFrom() || undefined,
      date_to: this.dateTo() || undefined,
      compare: this.compare(),
      compare_from: this.compare() === 'custom' ? this.compareFrom() || undefined : undefined,
      compare_to: this.compare() === 'custom' ? this.compareTo() || undefined : undefined,
    };
  }

  apply(change: {
    dataset?: string;
    dateFrom?: string;
    dateTo?: string;
    preset?: DatePreset;
    compare?: CompareMode;
    compareFrom?: string;
    compareTo?: string;
  }): void {
    this.dataset.set(change.dataset ?? '');
    this.dateFrom.set(change.dateFrom ?? '');
    this.dateTo.set(change.dateTo ?? '');
    this.preset.set(change.preset ?? 'custom');
    this.compare.set(change.compare ?? this.compare());
    this.compareFrom.set(change.compareFrom ?? this.compareFrom());
    this.compareTo.set(change.compareTo ?? this.compareTo());
    this.persist();
    this.syncUrl();
    this.revision.update((value) => value + 1);
  }

  useComparison(compare: CompareMode): void {
    this.apply({
      dataset: this.dataset(),
      dateFrom: this.dateFrom(),
      dateTo: this.dateTo(),
      preset: this.preset(),
      compare,
    });
  }

  setComparisonWindow(side: 'from' | 'to', value: string): void {
    this.apply({
      dataset: this.dataset(),
      dateFrom: this.dateFrom(),
      dateTo: this.dateTo(),
      preset: this.preset(),
      compare: 'custom',
      compareFrom: side === 'from' ? value : this.compareFrom(),
      compareTo: side === 'to' ? value : this.compareTo(),
    });
  }

  usePreset(preset: DatePreset): void {
    const range = presetRange(preset);
    this.apply({
      dataset: this.dataset(),
      dateFrom: range?.from ?? '',
      dateTo: range?.to ?? '',
      preset,
    });
  }

  reset(): void {
    this.apply({ ...EMPTY_SCOPE });
  }

  private fromUrl(): StoredScope | null {
    const params = this.router.parseUrl(this.router.url).queryParams;
    if (
      !Object.prototype.hasOwnProperty.call(params, 'dataset') &&
      !Object.prototype.hasOwnProperty.call(params, 'date_from') &&
      !Object.prototype.hasOwnProperty.call(params, 'date_to')
    ) {
      return null;
    }
    const dateFrom = typeof params['date_from'] === 'string' ? params['date_from'] : '';
    const dateTo = typeof params['date_to'] === 'string' ? params['date_to'] : '';
    return {
      dataset: typeof params['dataset'] === 'string' ? params['dataset'] : '',
      dateFrom,
      dateTo,
      preset: dateFrom || dateTo ? inferPreset(dateFrom, dateTo) : 'all',
      compare: isCompareMode(params['compare']) ? params['compare'] : 'previous',
      compareFrom: typeof params['compare_from'] === 'string' ? params['compare_from'] : '',
      compareTo: typeof params['compare_to'] === 'string' ? params['compare_to'] : '',
    };
  }

  private fromStorage(organisationId: string): StoredScope {
    try {
      const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${organisationId}`);
      if (!raw) {
        return { ...EMPTY_SCOPE };
      }
      const parsed = JSON.parse(raw) as Partial<StoredScope>;
      return {
        dataset: typeof parsed.dataset === 'string' ? parsed.dataset : '',
        dateFrom: typeof parsed.dateFrom === 'string' ? parsed.dateFrom : '',
        dateTo: typeof parsed.dateTo === 'string' ? parsed.dateTo : '',
        preset: isPreset(parsed.preset) ? parsed.preset : 'all',
        compare: isCompareMode(parsed.compare) ? parsed.compare : 'previous',
        compareFrom: typeof parsed.compareFrom === 'string' ? parsed.compareFrom : '',
        compareTo: typeof parsed.compareTo === 'string' ? parsed.compareTo : '',
      };
    } catch {
      return { ...EMPTY_SCOPE };
    }
  }

  private readFromUrl(): void {
    if (this.organisation() === null) {
      return;
    }
    const next = this.fromUrl();
    if (next === null || this.sameAs(next)) {
      return;
    }
    this.setScope(next);
    this.persist();
    this.revision.update((value) => value + 1);
  }

  private sameAs(scope: StoredScope): boolean {
    return (
      scope.dataset === this.dataset() &&
      scope.dateFrom === this.dateFrom() &&
      scope.dateTo === this.dateTo() &&
      scope.compare === this.compare() &&
      scope.compareFrom === this.compareFrom() &&
      scope.compareTo === this.compareTo()
    );
  }

  private setScope(scope: StoredScope): void {
    this.dataset.set(scope.dataset);
    this.dateFrom.set(scope.dateFrom);
    this.dateTo.set(scope.dateTo);
    this.preset.set(scope.preset);
    this.compare.set(scope.compare);
    this.compareFrom.set(scope.compareFrom);
    this.compareTo.set(scope.compareTo);
  }

  private persist(): void {
    const organisationId = this.organisation();
    if (!organisationId) {
      return;
    }
    try {
      sessionStorage.setItem(
        `${STORAGE_PREFIX}${organisationId}`,
        JSON.stringify({
          dataset: this.dataset(),
          dateFrom: this.dateFrom(),
          dateTo: this.dateTo(),
          preset: this.preset(),
          compare: this.compare(),
          compareFrom: this.compareFrom(),
          compareTo: this.compareTo(),
        }),
      );
    } catch {
      // Session storage can be unavailable in privacy-restricted browsers.
    }
  }

  private syncUrl(): void {
    const params = {
      dataset: this.dataset() || null,
      date_from: this.dateFrom() || null,
      date_to: this.dateTo() || null,
      compare: this.compare() === 'previous' ? null : this.compare(),
      compare_from: this.compare() === 'custom' ? this.compareFrom() || null : null,
      compare_to: this.compare() === 'custom' ? this.compareTo() || null : null,
    };
    const current = this.router.parseUrl(this.router.url).queryParams;
    if (
      (current['dataset'] ?? null) === params.dataset &&
      (current['date_from'] ?? null) === params.date_from &&
      (current['date_to'] ?? null) === params.date_to &&
      (current['compare'] ?? null) === params.compare &&
      (current['compare_from'] ?? null) === params.compare_from &&
      (current['compare_to'] ?? null) === params.compare_to
    ) {
      return;
    }
    void this.router.navigate([], {
      queryParams: params,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}

export const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'last90', label: 'Last 90 days' },
  { value: 'mtd', label: 'Month to date' },
  { value: 'qtd', label: 'Quarter to date' },
  { value: 'ytd', label: 'Year to date' },
];

export function presetRange(preset: DatePreset): { from: string; to: string } | null {
  if (preset === 'all' || preset === 'custom') {
    return null;
  }
  const today = new Date();
  const to = toIsoDate(today);
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  switch (preset) {
    case 'last7':
      from.setDate(from.getDate() - 6);
      break;
    case 'last30':
      from.setDate(from.getDate() - 29);
      break;
    case 'last90':
      from.setDate(from.getDate() - 89);
      break;
    case 'mtd':
      from.setDate(1);
      break;
    case 'qtd':
      from.setMonth(Math.floor(from.getMonth() / 3) * 3, 1);
      break;
    case 'ytd':
      from.setMonth(0, 1);
      break;
  }
  return { from: toIsoDate(from), to };
}

function toIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function inferPreset(dateFrom: string, dateTo: string): DatePreset {
  for (const preset of DATE_PRESETS) {
    const range = presetRange(preset.value);
    if (range?.from === dateFrom && range.to === dateTo) {
      return preset.value;
    }
  }
  return 'custom';
}

function isCompareMode(value: unknown): value is CompareMode {
  return value === 'previous' || value === 'year' || value === 'custom';
}

function isPreset(value: unknown): value is DatePreset {
  return (
    value === 'all' ||
    value === 'last7' ||
    value === 'last30' ||
    value === 'last90' ||
    value === 'mtd' ||
    value === 'qtd' ||
    value === 'ytd' ||
    value === 'custom'
  );
}

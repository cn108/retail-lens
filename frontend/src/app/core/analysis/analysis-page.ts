import { computed, effect, inject, signal } from '@angular/core';

import { AnalyticsService } from '../api/analytics.service';
import { apiErrorMessage } from '../api/api-error';
import { DatasetSummary, DatasetsService } from '../api/datasets.service';
import { AuthService } from '../auth/auth.service';
import { formatDate, formatMoney, formatPercent } from '../formatting';
import { AnalysisQuery, AnalysisScopeService } from './analysis-scope.service';

/**
 * Shared plumbing for the analysis pages: the dataset list, the scope-aware
 * reload loop and the request guard every page used to copy by hand.
 */
export abstract class AnalysisPage {
  protected readonly auth = inject(AuthService);
  protected readonly scope = inject(AnalysisScopeService);
  protected readonly analytics = inject(AnalyticsService);
  private readonly datasetsApi = inject(DatasetsService);

  readonly allDatasets = signal<DatasetSummary[]>([]);
  readonly availableDatasets = computed(() =>
    this.allDatasets().filter(
      (dataset) => dataset.status === 'ready' || dataset.status === 'failed',
    ),
  );
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  private requestId = 0;
  private lastKey = '';
  private lastOrganisationId: string | null = null;

  constructor() {
    effect(() => {
      const organisationId = this.auth.activeOrganisation()?.id ?? null;
      if (!organisationId) {
        return;
      }
      this.scope.ensureFor(organisationId);
      if (this.lastOrganisationId !== organisationId) {
        this.lastOrganisationId = organisationId;
        void this.loadDatasets();
      }
      const key = `${organisationId}:${this.scope.revision()}:${this.reloadKey()}`;
      if (key === this.lastKey) {
        return;
      }
      this.lastKey = key;
      void this.reload();
    });
  }

  /** Subclasses return extra state that should trigger a reload when it changes. */
  protected reloadKey(): string {
    return '';
  }

  async reload(): Promise<void> {
    const request = ++this.requestId;
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.fetch(this.scope.query(), request);
    } catch (error) {
      if (request === this.requestId) {
        this.onError(error);
      }
    } finally {
      if (request === this.requestId) {
        this.loading.set(false);
      }
    }
  }

  protected isCurrent(request: number): boolean {
    return request === this.requestId;
  }

  protected onError(error: unknown): void {
    this.error.set(apiErrorMessage(error, 'This analysis could not be loaded.'));
  }

  protected abstract fetch(query: AnalysisQuery, request: number): Promise<void>;

  money(value: string | null): string {
    return formatMoney(value, this.auth.activeOrganisation()?.currency ?? 'GBP');
  }

  percent(value: string | null): string {
    if (value === null) {
      return '—';
    }
    const amount = Number(value);
    if (!Number.isFinite(amount)) {
      return value;
    }
    return `${amount > 0 ? '+' : ''}${amount.toFixed(2)}%`;
  }

  rate(value: string | null): string {
    return value === null ? '—' : `${Number(value).toFixed(2)}%`;
  }

  date(value: string | null): string {
    return formatDate(value);
  }

  private async loadDatasets(): Promise<void> {
    try {
      this.allDatasets.set(await this.datasetsApi.list());
    } catch {
      // Metrics still load; the filter just stays on all datasets.
    }
  }
}

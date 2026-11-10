import { Injectable, computed, effect, inject, signal } from '@angular/core';

import { DatasetSummary, DatasetsService } from '../api/datasets.service';
import { ForecastRun, ForecastingService } from '../api/forecasting.service';
import { ReportExport, ReportingService } from '../api/reporting.service';
import { AuthService } from '../auth/auth.service';

export type WorkKind = 'export' | 'forecast' | 'dataset';
export type WorkStatus = 'queued' | 'running' | 'processing' | 'succeeded' | 'failed';

export interface WorkItem {
  id: string;
  kind: WorkKind;
  title: string;
  detail: string;
  status: WorkStatus;
  href: string;
  createdAt: string;
  reportId?: string;
  jobId?: string;
  format?: string;
}

/**
 * Small organisation-wide activity feed. Dataset processing, forecast runs and
 * report exports are all asynchronous; keeping them in one place means a user
 * can leave the page that started a job without losing track of it.
 */
@Injectable({ providedIn: 'root' })
export class WorkQueueService {
  private readonly reporting = inject(ReportingService);
  private readonly forecasting = inject(ForecastingService);
  private readonly datasets = inject(DatasetsService);
  private readonly auth = inject(AuthService);

  readonly items = signal<WorkItem[]>([]);
  readonly loading = signal(false);
  readonly downloadError = signal<string | null>(null);

  readonly activeCount = computed(
    () =>
      this.items().filter(
        (item) =>
          item.status === 'queued' || item.status === 'running' || item.status === 'processing',
      ).length,
  );

  private timer: ReturnType<typeof setInterval> | null = null;
  private refreshing = false;
  private lastOrganisationId: string | null = null;

  constructor() {
    effect(() => {
      const organisationId = this.auth.activeOrganisation()?.id ?? null;
      if (organisationId === this.lastOrganisationId) {
        return;
      }
      this.lastOrganisationId = organisationId;
      if (!organisationId) {
        this.stop();
        this.items.set([]);
        return;
      }
      this.items.set([]);
      this.start();
    });
  }

  refresh(): void {
    if (this.refreshing || !this.auth.activeOrganisation()) {
      return;
    }
    this.refreshing = true;
    this.loading.set(true);
    void this.load().finally(() => {
      this.refreshing = false;
      this.loading.set(false);
    });
  }

  async download(item: WorkItem): Promise<void> {
    if (!item.reportId || !item.jobId) {
      return;
    }
    this.downloadError.set(null);
    try {
      const blob = await this.reporting.download(item.reportId, item.jobId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `report.${item.format ?? 'csv'}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      this.downloadError.set('The export could not be downloaded.');
    }
  }

  statusLabel(status: WorkStatus): string {
    switch (status) {
      case 'queued':
        return 'Queued';
      case 'running':
        return 'Running';
      case 'processing':
        return 'Processing';
      case 'succeeded':
        return 'Ready';
      default:
        return 'Failed';
    }
  }

  private start(): void {
    if (this.timer) {
      return;
    }
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 4000);
  }

  private stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async load(): Promise<void> {
    const [exports, forecasts, datasets] = await Promise.all([
      this.safe(this.reporting.listAllExports(false, 10), [] as ReportExport[]),
      this.safe(this.forecasting.list(undefined, 20), [] as ForecastRun[]),
      this.safe(this.datasets.list(), [] as DatasetSummary[]),
    ]);

    const items: WorkItem[] = [
      ...exports.map((job) => ({
        id: `export-${job.id}`,
        kind: 'export' as const,
        title: job.report_name || 'Report export',
        detail: `${job.format.toUpperCase()} export`,
        status: job.status as WorkStatus,
        href: `/reports/${job.report_id}`,
        createdAt: job.created_at,
        reportId: job.report_id,
        jobId: job.id,
        format: job.format,
      })),
      ...forecasts
        .filter(
          (run) => run.status === 'queued' || run.status === 'running' || run.status === 'failed',
        )
        .map((run) => ({
          id: `forecast-${run.id}`,
          kind: 'forecast' as const,
          title: run.dataset?.name || 'All processed data',
          detail: `${run.horizon}-month forecast`,
          status: run.status as WorkStatus,
          href: '/forecasting',
          createdAt: run.created_at,
        })),
      ...datasets
        .filter((dataset) => dataset.status === 'processing' || dataset.status === 'failed')
        .map((dataset) => ({
          id: `dataset-${dataset.id}`,
          kind: 'dataset' as const,
          title: dataset.name,
          detail:
            dataset.status === 'processing' ? 'Processing dataset' : 'Dataset processing failed',
          status: (dataset.status === 'processing' ? 'processing' : 'failed') as WorkStatus,
          href: `/datasets/${dataset.id}`,
          createdAt: dataset.updated_at,
        })),
    ];

    this.items.set(items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12));
  }

  private async safe<T>(promise: Promise<T>, fallback: T): Promise<T> {
    try {
      return await promise;
    } catch {
      return fallback;
    }
  }
}

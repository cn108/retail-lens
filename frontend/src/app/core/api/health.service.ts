import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from './api.config';

export interface HealthReport {
  status: 'ok' | 'degraded';
  checks: Record<string, 'ok' | 'error'>;
}

@Injectable({ providedIn: 'root' })
export class HealthService {
  private readonly http = inject(HttpClient);

  readonly report = signal<HealthReport | null>(null);
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);

  async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.report.set(await firstValueFrom(this.http.get<HealthReport>(`${API_BASE_URL}/health`)));
    } catch {
      this.report.set(null);
      this.error.set('The API did not respond. Is the backend running on port 8000?');
    } finally {
      this.loading.set(false);
    }
  }
}

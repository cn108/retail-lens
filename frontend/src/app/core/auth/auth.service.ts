import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from '../api/api.config';

export type Role = 'owner' | 'admin' | 'analyst' | 'viewer';

export interface OrganisationSummary {
  id: string;
  name: string;
  slug: string;
  currency: string;
  role: Role;
}

export interface CurrentUser {
  id: string;
  email: string;
  display_name: string;
  date_joined: string;
  preferences: { default_organisation: string | null };
  organisations: OrganisationSummary[];
}

export interface Registration {
  email: string;
  password: string;
  display_name: string;
  organisation_name: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  readonly user = signal<CurrentUser | null>(null);
  /** True until the initial session probe has finished. */
  readonly loading = signal(true);
  readonly isAuthenticated = computed(() => this.user() !== null);

  /** The organisation the UI is currently showing. */
  readonly activeOrganisation = computed<OrganisationSummary | null>(() => {
    const user = this.user();
    if (!user) {
      return null;
    }
    const preferred = user.preferences.default_organisation;
    return (
      user.organisations.find((item) => item.id === preferred) ?? user.organisations[0] ?? null
    );
  });

  private restorePromise: Promise<void> | null = null;

  /** Probe the session once, however many callers ask. */
  ensureRestored(): Promise<void> {
    this.restorePromise ??= this.restore();
    return this.restorePromise;
  }

  async login(email: string, password: string): Promise<void> {
    await this.refreshCsrf();
    const user = await firstValueFrom(
      this.http.post<CurrentUser>(`${API_BASE_URL}/auth/login`, { email, password }),
    );
    this.user.set(user);
  }

  async register(registration: Registration): Promise<void> {
    await this.refreshCsrf();
    const user = await firstValueFrom(
      this.http.post<CurrentUser>(`${API_BASE_URL}/auth/register`, registration),
    );
    this.user.set(user);
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post(`${API_BASE_URL}/auth/logout`, {}));
    } finally {
      this.user.set(null);
    }
  }

  async updateProfile(displayName: string): Promise<void> {
    const user = await firstValueFrom(
      this.http.patch<CurrentUser>(`${API_BASE_URL}/auth/me`, {
        display_name: displayName,
      }),
    );
    this.user.set(user);
  }

  async switchOrganisation(organisationId: string): Promise<void> {
    const user = await firstValueFrom(
      this.http.patch<CurrentUser>(`${API_BASE_URL}/auth/me/preferences`, {
        default_organisation: organisationId,
      }),
    );
    this.user.set(user);
  }

  async refresh(): Promise<void> {
    const user = await firstValueFrom(this.http.get<CurrentUser>(`${API_BASE_URL}/auth/me`));
    this.user.set(user);
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${API_BASE_URL}/auth/me/password`, {
        current_password: currentPassword,
        new_password: newPassword,
      }),
    );
  }

  private async restore(): Promise<void> {
    this.loading.set(true);
    try {
      await this.refreshCsrf();
      await this.refresh();
    } catch {
      this.user.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  /** Establish the CSRF cookie before any unsafe request. */
  private async refreshCsrf(): Promise<void> {
    await firstValueFrom(this.http.get(`${API_BASE_URL}/auth/csrf`));
  }
}

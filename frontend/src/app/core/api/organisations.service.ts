import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { Role } from '../auth/auth.service';
import { API_BASE_URL } from './api.config';

export interface Organisation {
  id: string;
  name: string;
  slug: string;
  currency: string;
  timezone: string;
  retention_days: number | null;
  role: Role;
  member_count: number;
  created_at: string;
}

export interface Member {
  id: string;
  user_id: string;
  email: string;
  display_name: string;
  role: Role;
  created_at: string;
}

export interface OrganisationSettings {
  name: string;
  currency: string;
  timezone: string;
  retention_days: number | null;
}

@Injectable({ providedIn: 'root' })
export class OrganisationsService {
  private readonly http = inject(HttpClient);

  async current(): Promise<Organisation> {
    return firstValueFrom(this.http.get<Organisation>(`${API_BASE_URL}/organisations/current`));
  }

  async create(name: string, currency: string): Promise<Organisation> {
    return firstValueFrom(
      this.http.post<Organisation>(`${API_BASE_URL}/organisations`, { name, currency }),
    );
  }

  async updateSettings(settings: Partial<OrganisationSettings>): Promise<Organisation> {
    return firstValueFrom(
      this.http.patch<Organisation>(`${API_BASE_URL}/organisations/current`, settings),
    );
  }

  async members(): Promise<Member[]> {
    return firstValueFrom(this.http.get<Member[]>(`${API_BASE_URL}/organisations/current/members`));
  }

  async addMember(email: string, role: Role): Promise<Member> {
    return firstValueFrom(
      this.http.post<Member>(`${API_BASE_URL}/organisations/current/members`, {
        email,
        role,
      }),
    );
  }

  async changeRole(memberId: string, role: Role): Promise<Member> {
    return firstValueFrom(
      this.http.patch<Member>(`${API_BASE_URL}/organisations/current/members/${memberId}`, {
        role,
      }),
    );
  }

  async removeMember(memberId: string): Promise<void> {
    await firstValueFrom(
      this.http.delete(`${API_BASE_URL}/organisations/current/members/${memberId}`),
    );
  }
}

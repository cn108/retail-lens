import { KeyValuePipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { apiErrorMessage } from '../../core/api/api-error';
import { HealthService } from '../../core/api/health.service';
import { Member, Organisation, OrganisationsService } from '../../core/api/organisations.service';
import { AuthService, Role } from '../../core/auth/auth.service';

@Component({
  selector: 'app-settings',
  imports: [ReactiveFormsModule, KeyValuePipe],
  template: `
    <header class="mb-8">
      <p class="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
        Workspace settings
      </p>
      <h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
        Settings
      </h1>
      <p class="mt-2 max-w-2xl text-sm text-slate-600">
        Your account, the organisations you belong to, and who can act on their behalf. Roles decide
        what the API allows; the interface hides actions you cannot take.
      </p>
    </header>

    @if (error(); as message) {
      <p role="alert" class="mb-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
        {{ message }}
      </p>
    }
    @if (notice(); as message) {
      <p role="status" class="mb-6 rounded-lg bg-teal-50 px-4 py-3 text-sm text-teal-900">
        {{ message }}
      </p>
    }

    <section class="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 class="text-sm font-semibold text-slate-900">Account</h2>
      <form
        [formGroup]="profileForm"
        (ngSubmit)="saveProfile()"
        class="mt-4 grid gap-4 sm:grid-cols-2"
      >
        <label class="block">
          <span class="text-sm font-medium text-slate-700">Email</span>
          <input
            type="email"
            [value]="auth.user()?.email"
            disabled
            class="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
          />
        </label>
        <label class="block">
          <span class="text-sm font-medium text-slate-700">Display name</span>
          <input
            type="text"
            formControlName="display_name"
            class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
          />
        </label>
        <div class="sm:col-span-2">
          <button
            type="submit"
            [disabled]="busy()"
            class="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
          >
            Save profile
          </button>
        </div>
      </form>
    </section>

    <section class="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
      <h2 class="text-sm font-semibold text-slate-900">Your organisations</h2>
      <ul class="mt-4 divide-y divide-slate-100">
        @for (membership of auth.user()?.organisations ?? []; track membership.id) {
          <li class="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p class="font-medium text-slate-900">
                {{ membership.name }}
                @if (membership.id === organisation()?.id) {
                  <span class="ml-2 text-xs font-medium text-teal-700">current</span>
                }
              </p>
              <p class="text-xs text-slate-500">
                {{ membership.slug }} · {{ membership.currency }} · {{ membership.role }}
              </p>
            </div>
            @if (membership.id !== organisation()?.id) {
              <button
                type="button"
                [disabled]="busy()"
                class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                (click)="switchTo(membership.id)"
              >
                Open
              </button>
            }
          </li>
        }
      </ul>

      <form
        [formGroup]="createForm"
        (ngSubmit)="createOrganisation()"
        class="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4"
      >
        <label class="block min-w-56 flex-1">
          <span class="text-sm font-medium text-slate-700">New organisation</span>
          <input
            type="text"
            formControlName="name"
            placeholder="Store group name"
            class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
          />
        </label>
        <label class="block">
          <span class="text-sm font-medium text-slate-700">Currency</span>
          <input
            type="text"
            formControlName="currency"
            maxlength="3"
            class="mt-1 w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase focus:border-teal-600 focus:outline-none"
          />
        </label>
        <button
          type="submit"
          [disabled]="busy()"
          class="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          Create
        </button>
      </form>
      <p class="mt-2 text-xs text-slate-500">
        You become the owner of any organisation you create.
      </p>
    </section>

    @if (loading()) {
      <p class="mt-6 text-sm text-slate-500">Loading organisation settings…</p>
    } @else if (organisation(); as current) {
      <section class="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-sm font-semibold text-slate-900">Organisation settings</h2>
            <p class="mt-1 text-sm text-slate-600">
              Currency, time zone and retention apply to every member of
              {{ current.name }}.
            </p>
          </div>
          <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
            {{ current.role }}
          </span>
        </div>

        <form
          [formGroup]="settingsForm"
          (ngSubmit)="saveSettings()"
          class="mt-4 grid gap-4 sm:grid-cols-2"
        >
          <label class="block sm:col-span-2">
            <span class="text-sm font-medium text-slate-700">Name</span>
            <input
              type="text"
              formControlName="name"
              class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 focus:border-teal-600 focus:outline-none"
            />
          </label>
          <label class="block">
            <span class="text-sm font-medium text-slate-700">Currency</span>
            <input
              type="text"
              formControlName="currency"
              maxlength="3"
              class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase disabled:bg-slate-50 focus:border-teal-600 focus:outline-none"
            />
            <span class="mt-1 block text-xs text-slate-500">Three-letter ISO code.</span>
          </label>
          <label class="block">
            <span class="text-sm font-medium text-slate-700">Time zone</span>
            <input
              type="text"
              formControlName="timezone"
              class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 focus:border-teal-600 focus:outline-none"
            />
            <span class="mt-1 block text-xs text-slate-500">IANA name, e.g. Europe/London.</span>
          </label>
          <label class="block">
            <span class="text-sm font-medium text-slate-700">Retention</span>
            <input
              type="number"
              min="1"
              formControlName="retention_days"
              class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 focus:border-teal-600 focus:outline-none"
            />
            <span class="mt-1 block text-xs text-slate-500">
              Days uploaded source rows are kept. Empty keeps them indefinitely.
            </span>
          </label>

          @if (canManage()) {
            <div class="sm:col-span-2">
              <button
                type="submit"
                [disabled]="busy()"
                class="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
              >
                Save organisation settings
              </button>
            </div>
          } @else {
            <p class="text-sm text-slate-500 sm:col-span-2">
              Only owners and admins can change these settings.
            </p>
          }
        </form>
      </section>

      <section class="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 class="text-sm font-semibold text-slate-900">Members</h2>
        <p class="mt-1 text-sm text-slate-600">
          {{ members().length }} {{ members().length === 1 ? 'person' : 'people' }} in
          {{ current.name }}.
        </p>

        <div class="mt-4 overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th class="py-2 pr-4 font-medium">Person</th>
                <th class="py-2 pr-4 font-medium">Role</th>
                <th class="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (member of members(); track member.id) {
                <tr>
                  <td class="py-3 pr-4">
                    <p class="font-medium text-slate-900">
                      {{ member.display_name || member.email }}
                    </p>
                    <p class="text-xs text-slate-500">{{ member.email }}</p>
                  </td>
                  <td class="py-3 pr-4">
                    @if (canManage()) {
                      <select
                        [value]="member.role"
                        (change)="changeRole(member, $event)"
                        class="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                      >
                        @for (role of roles; track role) {
                          <option [value]="role" [selected]="role === member.role">
                            {{ role }}
                          </option>
                        }
                      </select>
                    } @else {
                      <span class="text-slate-700">{{ member.role }}</span>
                    }
                  </td>
                  <td class="py-3 text-right">
                    @if (canManage()) {
                      <button
                        type="button"
                        [disabled]="busy()"
                        class="text-sm font-medium text-amber-700 hover:underline disabled:opacity-60"
                        (click)="removeMember(member)"
                      >
                        Remove
                      </button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        @if (canManage()) {
          <form
            [formGroup]="memberForm"
            (ngSubmit)="addMember()"
            class="mt-6 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4"
          >
            <label class="block min-w-56 flex-1">
              <span class="text-sm font-medium text-slate-700">Add an existing account</span>
              <input
                type="email"
                formControlName="email"
                placeholder="person@example.com"
                class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
              />
            </label>
            <label class="block">
              <span class="text-sm font-medium text-slate-700">Role</span>
              <select
                formControlName="role"
                class="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                @for (role of roles; track role) {
                  <option [value]="role">{{ role }}</option>
                }
              </select>
            </label>
            <button
              type="submit"
              [disabled]="busy()"
              class="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Add member
            </button>
          </form>
          <p class="mt-2 text-xs text-slate-500">
            People need an account before they can be added. Email invitations are not available
            yet.
          </p>
        }
      </section>
    }

    @if (canManage()) {
      <section class="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-sm font-semibold text-slate-900">System status</h2>
            <p class="mt-1 text-sm text-slate-600">
              Live checks for the database and background worker. Useful when processing or an
              export appears stuck.
            </p>
          </div>
          <button
            type="button"
            class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            (click)="health.refresh()"
          >
            Recheck
          </button>
        </div>

        @if (health.loading()) {
          <p class="mt-4 text-sm text-slate-500">Checking services…</p>
        } @else if (health.error()) {
          <p class="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {{ health.error() }}
          </p>
        } @else if (health.report(); as report) {
          <div class="mt-4 flex flex-wrap items-center gap-2">
            <span
              class="rounded-full px-3 py-1 text-xs font-medium"
              [class]="
                report.status === 'ok' ? 'bg-teal-50 text-teal-800' : 'bg-amber-50 text-amber-800'
              "
            >
              Overall: {{ report.status }}
            </span>
            @for (entry of report.checks | keyvalue; track entry.key) {
              <span
                class="rounded-full px-3 py-1 text-xs font-medium"
                [class]="
                  entry.value === 'ok'
                    ? 'bg-slate-100 text-slate-700'
                    : 'bg-amber-50 text-amber-800'
                "
              >
                {{ entry.key }}: {{ entry.value }}
              </span>
            }
          </div>
        }
      </section>
    }
  `,
})
export class Settings {
  readonly auth = inject(AuthService);
  readonly health = inject(HealthService);
  private readonly organisations = inject(OrganisationsService);

  readonly organisation = signal<Organisation | null>(null);
  readonly members = signal<Member[]>([]);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);

  readonly roles: Role[] = ['owner', 'admin', 'analyst', 'viewer'];

  readonly canManage = computed(() => {
    const role = this.organisation()?.role;
    return role === 'owner' || role === 'admin';
  });

  readonly profileForm = inject(FormBuilder).nonNullable.group({
    display_name: ['', [Validators.maxLength(150)]],
  });

  readonly settingsForm = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required]],
    currency: ['', [Validators.required]],
    timezone: ['', [Validators.required]],
    retention_days: [''],
  });

  readonly memberForm = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    role: ['viewer' as Role],
  });

  readonly createForm = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required]],
    currency: ['GBP', [Validators.required, Validators.pattern(/^[A-Za-z]{3}$/)]],
  });

  constructor() {
    void this.health.refresh();

    effect(() => {
      this.profileForm.patchValue({
        display_name: this.auth.user()?.display_name ?? '',
      });
    });

    effect(() => {
      const active = this.auth.activeOrganisation();
      if (active && active.id !== this.organisation()?.id) {
        void this.load();
      }
    });
  }

  async saveProfile(): Promise<void> {
    this.start();
    try {
      await this.auth.updateProfile(this.profileForm.getRawValue().display_name);
      this.notice.set('Profile saved.');
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Could not save your profile.'));
    } finally {
      this.busy.set(false);
    }
  }

  async saveSettings(): Promise<void> {
    if (this.settingsForm.invalid) {
      this.settingsForm.markAllAsTouched();
      return;
    }
    this.start();
    const raw = this.settingsForm.getRawValue();
    try {
      const organisation = await this.organisations.updateSettings({
        name: raw.name,
        currency: raw.currency,
        timezone: raw.timezone,
        retention_days: raw.retention_days === '' ? null : Number(raw.retention_days),
      });
      this.organisation.set(organisation);
      this.notice.set('Organisation settings saved.');
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Could not save the organisation settings.'));
    } finally {
      this.busy.set(false);
    }
  }

  async addMember(): Promise<void> {
    if (this.memberForm.invalid) {
      this.memberForm.markAllAsTouched();
      return;
    }
    this.start();
    const raw = this.memberForm.getRawValue();
    try {
      await this.organisations.addMember(raw.email, raw.role);
      this.memberForm.reset({ email: '', role: 'viewer' });
      await this.reloadMembers();
      this.notice.set('Member added.');
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Could not add that person.'));
    } finally {
      this.busy.set(false);
    }
  }

  async changeRole(member: Member, event: Event): Promise<void> {
    const role = (event.target as HTMLSelectElement).value as Role;
    if (role === member.role) {
      return;
    }
    this.start();
    try {
      await this.organisations.changeRole(member.id, role);
      await this.reloadMembers();
      this.notice.set('Role updated.');
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Could not change that role.'));
      await this.reloadMembers();
    } finally {
      this.busy.set(false);
    }
  }

  async removeMember(member: Member): Promise<void> {
    if (!confirm(`Remove ${member.display_name || member.email} from this organisation?`)) {
      return;
    }
    this.start();
    try {
      await this.organisations.removeMember(member.id);
      await this.reloadMembers();
      this.notice.set('Member removed.');
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Could not remove that member.'));
    } finally {
      this.busy.set(false);
    }
  }

  async createOrganisation(): Promise<void> {
    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      return;
    }
    this.start();
    const raw = this.createForm.getRawValue();
    try {
      const organisation = await this.organisations.create(raw.name, raw.currency);
      this.createForm.reset({ name: '', currency: 'GBP' });
      await this.auth.switchOrganisation(organisation.id);
      this.notice.set(`${organisation.name} created; you are its owner.`);
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Could not create the organisation.'));
    } finally {
      this.busy.set(false);
    }
  }

  async switchTo(organisationId: string): Promise<void> {
    this.start();
    try {
      await this.auth.switchOrganisation(organisationId);
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Could not switch organisation.'));
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [organisation, members] = await Promise.all([
        this.organisations.current(),
        this.organisations.members(),
      ]);
      this.apply(organisation, members);
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Could not load the organisation.'));
    } finally {
      this.loading.set(false);
    }
  }

  private async reloadMembers(): Promise<void> {
    this.members.set(await this.organisations.members());
  }

  private apply(organisation: Organisation, members: Member[]): void {
    this.organisation.set(organisation);
    this.members.set(members);
    this.settingsForm.patchValue({
      name: organisation.name,
      currency: organisation.currency,
      timezone: organisation.timezone,
      retention_days:
        organisation.retention_days === null ? '' : String(organisation.retention_days),
    });
    // Reactive-form controls ignore [attr.disabled], so lock the fields here.
    if (this.canManage()) {
      this.settingsForm.enable();
    } else {
      this.settingsForm.disable();
    }
  }

  private start(): void {
    this.error.set(null);
    this.notice.set(null);
    this.busy.set(true);
  }
}

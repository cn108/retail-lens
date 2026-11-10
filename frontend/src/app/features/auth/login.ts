import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { apiErrorMessage } from '../../core/api/api-error';
import { AuthService } from '../../core/auth/auth.service';

type Mode = 'login' | 'register';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule],
  template: `
    <div class="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div class="w-full max-w-md">
        <div class="mb-8 text-center">
          <p class="text-xl font-semibold tracking-tight text-slate-900">RetailLens</p>
          <p class="mt-1 text-sm text-slate-500">Retail intelligence</p>
        </div>

        <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div class="mb-6 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1" role="tablist">
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="mode() === 'login'"
              [class]="
                mode() === 'login'
                  ? 'rounded-md bg-white px-3 py-1.5 text-sm font-medium text-slate-900 shadow-sm'
                  : 'rounded-md px-3 py-1.5 text-sm font-medium text-slate-600'
              "
              (click)="setMode('login')"
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="mode() === 'register'"
              [class]="
                mode() === 'register'
                  ? 'rounded-md bg-white px-3 py-1.5 text-sm font-medium text-slate-900 shadow-sm'
                  : 'rounded-md px-3 py-1.5 text-sm font-medium text-slate-600'
              "
              (click)="setMode('register')"
            >
              Create account
            </button>
          </div>

          <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
            @if (mode() === 'register') {
              <label class="block">
                <span class="text-sm font-medium text-slate-700">Your name</span>
                <input
                  type="text"
                  formControlName="display_name"
                  autocomplete="name"
                  class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </label>
              <label class="mt-4 block">
                <span class="text-sm font-medium text-slate-700">Workspace name</span>
                <input
                  type="text"
                  formControlName="organisation_name"
                  class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
                <span class="mt-1 block text-xs text-slate-500">
                  Leave blank to use your own name as the workspace.
                </span>
              </label>
            }

            <label class="mt-4 block">
              <span class="text-sm font-medium text-slate-700">Email</span>
              <input
                type="email"
                formControlName="email"
                autocomplete="email"
                class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
              />
              @if (form.controls.email.touched && form.controls.email.invalid) {
                <span class="mt-1 block text-xs text-amber-700">Enter a valid email address.</span>
              }
            </label>

            <label class="mt-4 block">
              <span class="text-sm font-medium text-slate-700">Password</span>
              <input
                type="password"
                formControlName="password"
                [attr.autocomplete]="mode() === 'login' ? 'current-password' : 'new-password'"
                class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
              />
              @if (form.controls.password.touched && form.controls.password.invalid) {
                <span class="mt-1 block text-xs text-amber-700">
                  Use at least 8 characters.
                </span>
              }
            </label>

            @if (error(); as message) {
              <p
                role="alert"
                class="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"
              >
                {{ message }}
              </p>
            }

            <button
              type="submit"
              [disabled]="submitting()"
              class="mt-6 w-full rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
            >
              {{ submitting() ? 'Working…' : mode() === 'login' ? 'Sign in' : 'Create account' }}
            </button>
          </form>
        </div>

        <p class="mt-6 text-center text-xs text-slate-500">
          Accounts are scoped to an organisation; your role controls what you can change.
        </p>
      </div>
    </div>
  `,
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly mode = signal<Mode>('login');
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
    display_name: [''],
    organisation_name: [''],
  });

  setMode(mode: Mode): void {
    this.mode.set(mode);
    this.error.set(null);
  }

  async submit(): Promise<void> {
    if (this.submitting()) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.error.set(null);
    const value = this.form.getRawValue();
    try {
      if (this.mode() === 'login') {
        await this.auth.login(value.email, value.password);
      } else {
        await this.auth.register({
          email: value.email,
          password: value.password,
          display_name: value.display_name,
          organisation_name: value.organisation_name,
        });
      }
      await this.router.navigateByUrl('/dashboard');
    } catch (error) {
      this.error.set(
        apiErrorMessage(
          error,
          this.mode() === 'login'
            ? 'Could not sign in. Check your email and password.'
            : 'Could not create the account.',
        ),
      );
    } finally {
      this.submitting.set(false);
    }
  }
}

import { Component, input } from '@angular/core';

@Component({
  selector: 'app-loading-state',
  template: `
    <div class="mt-6" role="status" aria-live="polite">
      <p class="sr-only">{{ label() }}</p>
      <div class="animate-pulse">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          @for (item of [1, 2, 3, 4]; track item) {
            <div class="rounded-2xl border border-slate-200 bg-white p-5">
              <div class="h-3 w-24 rounded bg-slate-200"></div>
              <div class="mt-3 h-6 w-28 rounded bg-slate-200"></div>
              <div class="mt-2 h-3 w-36 rounded bg-slate-100"></div>
            </div>
          }
        </div>
        <div class="mt-4 rounded-2xl border border-slate-200 bg-white p-6">
          <div class="h-4 w-40 rounded bg-slate-200"></div>
          <div class="mt-4 space-y-3">
            @for (item of [1, 2, 3, 4, 5]; track item) {
              <div class="h-4 rounded bg-slate-100"></div>
            }
          </div>
        </div>
      </div>
    </div>
  `,
})
export class LoadingState {
  readonly label = input('Loading…');
}

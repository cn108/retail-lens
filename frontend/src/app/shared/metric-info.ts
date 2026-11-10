import { Component, input, signal } from '@angular/core';

@Component({
  selector: 'app-metric-info',
  template: `
    <span class="relative inline-flex items-center gap-1">
      <span>{{ label() }}</span>
      <button
        type="button"
        class="flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] font-semibold text-slate-500 hover:border-teal-600 hover:text-teal-700"
        [attr.aria-label]="'About ' + label()"
        [attr.aria-expanded]="open()"
        (click)="open.set(!open())"
      >
        i
      </button>
      @if (open()) {
        <span
          role="tooltip"
          class="absolute left-0 top-6 z-20 w-64 rounded-lg border border-slate-200 bg-white p-3 text-left text-xs font-normal normal-case leading-5 tracking-normal text-slate-600 shadow-lg"
        >
          {{ definition() }}
        </span>
      }
    </span>
  `,
})
export class MetricInfo {
  readonly label = input.required<string>();
  readonly definition = input.required<string>();
  readonly open = signal(false);
}

import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { WorkQueueService, WorkStatus } from '../core/work/work-queue.service';

@Component({
  selector: 'app-activity-tray',
  imports: [RouterLink],
  template: `
    <details class="group">
      <summary
        class="flex cursor-pointer list-none items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
      >
        <span>Activity</span>
        @if (work.activeCount()) {
          <span class="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-800">
            {{ work.activeCount() }}
          </span>
        }
      </summary>

      <div class="mt-1 rounded-xl border border-slate-200 bg-slate-50 p-2">
        @if (work.loading() && !work.items().length) {
          <p class="px-2 py-3 text-xs text-slate-500">Checking recent work…</p>
        } @else if (!work.items().length) {
          <p class="px-2 py-3 text-xs text-slate-500">No recent activity.</p>
        } @else {
          <ul class="divide-y divide-slate-200">
            @for (item of work.items(); track item.id) {
              <li class="px-2 py-2">
                <div class="flex items-start justify-between gap-2">
                  <a
                    [routerLink]="item.href"
                    class="min-w-0 text-xs font-medium text-slate-800 hover:text-teal-700"
                  >
                    <span class="block truncate">{{ item.title }}</span>
                    <span class="mt-0.5 block truncate font-normal text-slate-500">
                      {{ item.detail }}
                    </span>
                  </a>
                  <span [class]="statusClass(item.status)">{{
                    work.statusLabel(item.status)
                  }}</span>
                </div>
                @if (item.kind === 'export' && item.status === 'succeeded') {
                  <button
                    type="button"
                    class="mt-1 text-xs font-medium text-teal-700 hover:underline"
                    (click)="work.download(item)"
                  >
                    Download
                  </button>
                }
              </li>
            }
          </ul>
        }
        @if (work.downloadError(); as message) {
          <p class="px-2 py-2 text-xs text-amber-800">{{ message }}</p>
        }
      </div>
    </details>
  `,
})
export class ActivityTray {
  readonly work = inject(WorkQueueService);

  statusClass(status: WorkStatus): string {
    const base = 'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ';
    if (status === 'failed') {
      return `${base}bg-red-50 text-red-800`;
    }
    if (status === 'succeeded') {
      return `${base}bg-teal-50 text-teal-800`;
    }
    return `${base}bg-sky-50 text-sky-800`;
  }
}

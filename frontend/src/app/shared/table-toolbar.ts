import { Component, inject, input, output } from '@angular/core';

import { TablePreferencesService } from './table-tools';

/**
 * The small toolbar every analysis table shares: export exactly what is on
 * screen, copy it as TSV, switch density and hide optional columns.
 */
@Component({
  selector: 'app-table-toolbar',
  template: `
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <span class="text-slate-500">{{ rowCount() }} {{ rowCount() === 1 ? 'row' : 'rows' }}</span>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        @if (columns().length > 0) {
          <details class="relative">
            <summary
              class="cursor-pointer list-none rounded-lg border border-slate-300 px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
            >
              Columns
            </summary>
            <div
              class="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-2 shadow-lg"
            >
              @for (column of columns(); track column.key) {
                <label class="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    class="size-3.5 rounded border-slate-300"
                    [checked]="prefs.isVisible(tableId(), column.key)"
                    (change)="prefs.toggleColumn(tableId(), column.key)"
                  />
                  <span class="text-slate-700">{{ column.label }}</span>
                </label>
              }
            </div>
          </details>
        }
        <button
          type="button"
          class="rounded-lg border border-slate-300 px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
          [attr.aria-pressed]="prefs.compact()"
          (click)="prefs.toggleDensity()"
        >
          {{ prefs.compact() ? 'Comfortable rows' : 'Compact rows' }}
        </button>
        <button
          type="button"
          class="rounded-lg border border-slate-300 px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
          (click)="copy.emit()"
        >
          Copy
        </button>
        <button
          type="button"
          class="rounded-lg bg-slate-900 px-2.5 py-1.5 font-medium text-white hover:bg-slate-800"
          (click)="exportCsv.emit()"
        >
          Export CSV
        </button>
      </div>
    </div>
  `,
})
export class TableToolbar {
  readonly tableId = input.required<string>();
  readonly columns = input<{ key: string; label: string }[]>([]);
  readonly rowCount = input(0);

  readonly exportCsv = output<void>();
  readonly copy = output<void>();

  readonly prefs = inject(TablePreferencesService);
}

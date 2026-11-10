import { Injectable, computed, signal } from '@angular/core';

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

/** Escape one CSV cell, quoting only when the value needs it. */
function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv<T>(columns: ExportColumn<T>[], rows: T[]): string {
  const header = columns.map((column) => cell(column.header)).join(',');
  const body = rows.map((row) => columns.map((column) => cell(column.value(row))).join(','));
  return [header, ...body].join('\r\n');
}

/**
 * Export exactly the rows and columns on screen. This deliberately skips the
 * saved-report round trip: an analyst downloading what they are looking at
 * should not have to name a report first.
 */
export function downloadCsv<T>(filename: string, columns: ExportColumn<T>[], rows: T[]): void {
  const csv = toCsv(columns, rows);
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Copy the visible table as tab-separated text so it pastes into a spreadsheet. */
export async function copyTable<T>(columns: ExportColumn<T>[], rows: T[]): Promise<boolean> {
  const text = [
    columns.map((column) => column.header).join('\t'),
    ...rows.map((row) => columns.map((column) => column.value(row) ?? '').join('\t')),
  ].join('\n');
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export type Density = 'comfortable' | 'compact';

interface TablePreferences {
  density: Density;
  hidden: Record<string, string[]>;
}

const STORAGE_KEY = 'retaillens.table-preferences';
const EMPTY: TablePreferences = { density: 'comfortable', hidden: {} };

/**
 * Column visibility and row density for dense analysis tables, kept per table
 * so hiding a column on Products does not rearrange Customers.
 */
@Injectable({ providedIn: 'root' })
export class TablePreferencesService {
  private readonly state = signal<TablePreferences>(this.load());
  readonly density = computed(() => this.state().density);
  readonly compact = computed(() => this.state().density === 'compact');

  hidden(tableId: string): string[] {
    return this.state().hidden[tableId] ?? [];
  }

  isVisible(tableId: string, key: string): boolean {
    return !this.hidden(tableId).includes(key);
  }

  toggleDensity(): void {
    this.write({
      ...this.state(),
      density: this.state().density === 'compact' ? 'comfortable' : 'compact',
    });
  }

  toggleColumn(tableId: string, key: string): void {
    const hidden = this.hidden(tableId);
    const next = hidden.includes(key) ? hidden.filter((item) => item !== key) : [...hidden, key];
    this.write({ ...this.state(), hidden: { ...this.state().hidden, [tableId]: next } });
  }

  rowPadding(): string {
    return this.compact() ? 'py-1.5' : 'py-3';
  }

  private write(next: TablePreferences): void {
    this.state.set(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private mode can block storage; the in-memory value still applies.
    }
  }

  private load(): TablePreferences {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return EMPTY;
      }
      const parsed = JSON.parse(raw) as Partial<TablePreferences>;
      return {
        density: parsed.density === 'compact' ? 'compact' : 'comfortable',
        hidden:
          parsed.hidden && typeof parsed.hidden === 'object'
            ? Object.fromEntries(
                Object.entries(parsed.hidden).map(([table, keys]) => [
                  table,
                  Array.isArray(keys) ? keys.filter((key) => typeof key === 'string') : [],
                ]),
              )
            : {},
      };
    } catch {
      return EMPTY;
    }
  }
}

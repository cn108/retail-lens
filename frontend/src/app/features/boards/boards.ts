import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import {
  BasketAnalysis,
  GeographyPerformance,
  ProductPerformance,
  ReturnsAnalysis,
  SalesSummary,
  SalesTrend,
} from '../../core/api/analytics.service';
import { apiErrorMessage } from '../../core/api/api-error';
import { Board, MonitoringService, TargetProgress } from '../../core/api/monitoring.service';
import { AnalysisPage } from '../../core/analysis/analysis-page';
import { AnalysisQuery } from '../../core/analysis/analysis-scope.service';
import { AnalysisFilterBar } from '../../shared/analysis-filter-bar';
import { LoadingState } from '../../shared/loading-state';

const WIDGET_TYPES: { value: string; label: string; hint: string }[] = [
  { value: 'kpi', label: 'Headline numbers', hint: 'Net sales, orders, AOV and customers' },
  { value: 'trend', label: 'Sales trend', hint: 'The most recent periods' },
  { value: 'geography', label: 'Top countries', hint: 'Largest markets by net sales' },
  { value: 'returns', label: 'Returns & discounts', hint: 'Return and discount rates' },
  { value: 'basket', label: 'Cross-sell pairs', hint: 'Strongest product pairs by lift' },
  { value: 'top_products', label: 'Top products', hint: 'Best sellers by net sales' },
  { value: 'targets', label: 'Targets', hint: 'Progress against period targets' },
  { value: 'alerts', label: 'Alerts', hint: 'Rules currently breaching' },
];

@Component({
  selector: 'app-boards',
  imports: [RouterLink, AnalysisFilterBar, LoadingState],
  template: `
    <header class="mb-6">
      <p class="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Workspace</p>
      <h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Boards</h1>
      <p class="mt-2 max-w-2xl text-sm text-slate-600">
        Saved layouts of the widgets you check regularly. Boards store the layout only; every number
        is fetched fresh with the current filters.
      </p>
    </header>

    <app-analysis-filter-bar [datasets]="availableDatasets()" [loading]="loading()" />

    @if (error(); as message) {
      <div
        role="alert"
        class="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900"
      >
        <span>{{ message }}</span>
        <button type="button" class="font-semibold underline" (click)="loadBoards()">Retry</button>
      </div>
    }

    <div class="mt-6 grid gap-4 lg:grid-cols-[18rem_1fr]">
      <aside class="space-y-4">
        <section class="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 class="text-sm font-semibold text-slate-900">Your boards</h2>
          @if (!boards().length) {
            <p class="mt-2 text-sm text-slate-500">No boards yet.</p>
          } @else {
            <ul class="mt-2 space-y-1">
              @for (board of boards(); track board.id) {
                <li>
                  <button
                    type="button"
                    class="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm"
                    [class]="
                      selected()?.id === board.id
                        ? 'bg-sky-50 font-medium text-sky-800'
                        : 'text-slate-700 hover:bg-slate-50'
                    "
                    (click)="select(board)"
                  >
                    <span class="truncate">{{ board.name }}</span>
                    <span class="text-[11px] text-slate-400">{{ board.widgets.length }}</span>
                  </button>
                </li>
              }
            </ul>
          }
        </section>

        <form
          class="rounded-2xl border border-slate-200 bg-white p-4"
          (submit)="createBoard($event)"
        >
          <h2 class="text-sm font-semibold text-slate-900">New board</h2>
          <input
            required
            [value]="draft().name"
            (input)="patchDraft({ name: value($event) })"
            placeholder="Weekly trading review"
            class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <fieldset class="mt-3 space-y-1.5">
            @for (widget of widgetTypes; track widget.value) {
              <label class="flex items-start gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  class="mt-0.5 size-3.5 rounded border-slate-300"
                  [checked]="draft().widgets.includes(widget.value)"
                  (change)="toggleWidget(widget.value)"
                />
                <span>
                  {{ widget.label }}
                  <span class="block text-[11px] text-slate-500">{{ widget.hint }}</span>
                </span>
              </label>
            }
          </fieldset>
          <button
            type="submit"
            class="mt-3 w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            [disabled]="saving()"
          >
            Save board
          </button>
        </form>
      </aside>

      <div class="min-w-0">
        @if (!selected()) {
          <section
            class="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"
          >
            <h2 class="text-lg font-semibold text-slate-900">Pick a board</h2>
            <p class="mx-auto mt-2 max-w-xl text-sm text-slate-600">
              Boards combine the same widgets as the analysis pages, so a trading review can live on
              one screen.
            </p>
          </section>
        } @else if (selected(); as board) {
          <section class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="text-lg font-semibold text-slate-900">{{ board.name }}</h2>
              <p class="mt-1 text-sm text-slate-600">
                {{ board.description || 'Updated live with the filters above.' }}
              </p>
            </div>
            <div class="flex gap-2 text-xs">
              <button
                type="button"
                class="rounded-lg border border-slate-300 px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                (click)="refresh()"
              >
                Refresh
              </button>
              <button
                type="button"
                class="rounded-lg border border-slate-300 px-2.5 py-1.5 font-medium text-slate-500 hover:text-amber-700"
                (click)="deleteBoard(board)"
              >
                Delete
              </button>
            </div>
          </section>

          @if (loadingWidgets()) {
            <app-loading-state label="Loading board widgets" />
          } @else {
            <div class="mt-4 grid gap-4 md:grid-cols-2">
              @for (widget of board.widgets; track widget.type) {
                <article class="rounded-2xl border border-slate-200 bg-white p-5">
                  <h3 class="text-sm font-semibold text-slate-900">
                    {{ widgetTitle(widget.type) }}
                  </h3>

                  @switch (widget.type) {
                    @case ('kpi') {
                      @if (summary(); as data) {
                        <dl class="mt-3 grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <dt class="text-xs uppercase tracking-wide text-slate-500">
                              Net sales
                            </dt>
                            <dd class="mt-0.5 text-lg font-semibold text-slate-900">
                              {{ money(data.net_sales) }}
                            </dd>
                          </div>
                          <div>
                            <dt class="text-xs uppercase tracking-wide text-slate-500">Orders</dt>
                            <dd class="mt-0.5 text-lg font-semibold text-slate-900">
                              {{ data.eligible_orders }}
                            </dd>
                          </div>
                          <div>
                            <dt class="text-xs uppercase tracking-wide text-slate-500">AOV</dt>
                            <dd class="mt-0.5 font-medium text-slate-900">
                              {{ data.average_order_value ? money(data.average_order_value) : '—' }}
                            </dd>
                          </div>
                          <div>
                            <dt class="text-xs uppercase tracking-wide text-slate-500">
                              Customers
                            </dt>
                            <dd class="mt-0.5 font-medium text-slate-900">
                              {{ data.unique_customers }}
                            </dd>
                          </div>
                        </dl>
                        @if (data.sales_growth_percent !== null) {
                          <p
                            class="mt-2 text-xs font-medium"
                            [class]="
                              data.sales_growth_percent.startsWith('-')
                                ? 'text-amber-700'
                                : 'text-teal-700'
                            "
                          >
                            {{ percent(data.sales_growth_percent) }} versus the baseline period
                          </p>
                        }
                      } @else {
                        <p class="mt-2 text-sm text-slate-500">No headline data in this range.</p>
                      }
                    }
                    @case ('trend') {
                      @if (trend()?.points?.length) {
                        <ul class="mt-3 space-y-2 text-sm">
                          @for (point of recentTrend(); track point.period_start) {
                            <li class="flex items-center justify-between gap-2">
                              <span class="text-slate-600">{{ point.label }}</span>
                              <span class="font-medium text-slate-900">
                                {{ money(point.net_sales) }}
                              </span>
                            </li>
                          }
                        </ul>
                      } @else {
                        <p class="mt-2 text-sm text-slate-500">No periods in this range.</p>
                      }
                    }
                    @case ('geography') {
                      @if (geography()?.rows?.length) {
                        <ul class="mt-3 space-y-2 text-sm">
                          @for (row of topGeography(); track row.country) {
                            <li class="flex items-center justify-between gap-2">
                              <span class="text-slate-600">{{ row.country }}</span>
                              <span class="font-medium text-slate-900">
                                {{ money(row.net_sales) }}
                              </span>
                            </li>
                          }
                        </ul>
                      } @else {
                        <p class="mt-2 text-sm text-slate-500">No geography mapped.</p>
                      }
                    }
                    @case ('returns') {
                      @if (returns(); as data) {
                        @if (data.has_data) {
                          <dl class="mt-3 grid grid-cols-2 gap-3 text-sm">
                            <div>
                              <dt class="text-xs uppercase tracking-wide text-slate-500">
                                Return rate
                              </dt>
                              <dd class="mt-0.5 text-lg font-semibold text-amber-700">
                                {{ rate(data.return_rate) }}
                              </dd>
                            </div>
                            <div>
                              <dt class="text-xs uppercase tracking-wide text-slate-500">
                                Discount rate
                              </dt>
                              <dd class="mt-0.5 text-lg font-semibold text-slate-900">
                                {{ rate(data.discount_rate) }}
                              </dd>
                            </div>
                          </dl>
                        } @else {
                          <p class="mt-2 text-sm text-slate-500">No sales in this range.</p>
                        }
                      }
                    }
                    @case ('basket') {
                      @if (basket()?.pairs?.length) {
                        <ul class="mt-3 space-y-2 text-sm">
                          @for (
                            pair of topPairs();
                            track pair.product_a.product_id + pair.product_b.product_id
                          ) {
                            <li class="flex items-center justify-between gap-2">
                              <span class="truncate text-slate-600">
                                {{ pair.product_a.source_product_code }} +
                                {{ pair.product_b.source_product_code }}
                              </span>
                              <span class="font-medium text-slate-900">
                                {{ pair.lift ? pair.lift + '×' : '—' }}
                              </span>
                            </li>
                          }
                        </ul>
                      } @else {
                        <p class="mt-2 text-sm text-slate-500">No multi-line invoices in range.</p>
                      }
                    }
                    @case ('top_products') {
                      @if (products()?.rows?.length) {
                        <ul class="mt-3 space-y-2 text-sm">
                          @for (row of topProducts(); track row.product_id) {
                            <li class="flex items-center justify-between gap-2">
                              <a
                                [routerLink]="['/products', row.product_id]"
                                class="truncate text-slate-700 hover:text-sky-700 hover:underline"
                              >
                                {{ row.description || row.source_product_code }}
                              </a>
                              <span class="font-medium text-slate-900">
                                {{ money(row.net_sales) }}
                              </span>
                            </li>
                          }
                        </ul>
                      } @else {
                        <p class="mt-2 text-sm text-slate-500">No products in this range.</p>
                      }
                    }
                    @case ('targets') {
                      @if (targets().length) {
                        <ul class="mt-3 space-y-3 text-sm">
                          @for (target of targets().slice(0, 4); track target.id) {
                            <li>
                              <div class="flex items-center justify-between gap-2">
                                <span class="truncate text-slate-700">{{ target.name }}</span>
                                <span class="text-xs text-slate-500">
                                  {{
                                    target.attainment_percent
                                      ? rate(target.attainment_percent)
                                      : '—'
                                  }}
                                </span>
                              </div>
                              <div class="mt-1 h-2 rounded-full bg-slate-100">
                                <div
                                  class="h-2 rounded-full"
                                  [class]="
                                    target.pace === 'behind' ? 'bg-amber-400' : 'bg-teal-500'
                                  "
                                  [style.width.%]="attainment(target)"
                                ></div>
                              </div>
                            </li>
                          }
                        </ul>
                      } @else {
                        <p class="mt-2 text-sm text-slate-500">No targets defined.</p>
                      }
                    }
                    @case ('alerts') {
                      @if (breaches().length) {
                        <ul class="mt-3 space-y-2 text-sm">
                          @for (rule of breaches(); track rule.id) {
                            <li class="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
                              <span class="font-medium">{{ rule.name }}</span>
                              <span class="block text-xs">
                                {{ rule.metric_label }} observed {{ rule.last_value }} against
                                {{ rule.threshold }}
                              </span>
                            </li>
                          }
                        </ul>
                      } @else {
                        <p class="mt-2 text-sm text-slate-500">Nothing is breaching.</p>
                      }
                    }
                    @default {
                      <p class="mt-2 text-sm text-slate-500">Unknown widget.</p>
                    }
                  }
                </article>
              }
            </div>
          }
        }
      </div>
    </div>
  `,
})
export class Boards extends AnalysisPage {
  private readonly monitoring = inject(MonitoringService);

  readonly boards = signal<Board[]>([]);
  readonly selected = signal<Board | null>(null);
  readonly saving = signal(false);
  readonly loadingWidgets = signal(false);

  readonly summary = signal<SalesSummary | null>(null);
  readonly trend = signal<SalesTrend | null>(null);
  readonly geography = signal<GeographyPerformance | null>(null);
  readonly returns = signal<ReturnsAnalysis | null>(null);
  readonly basket = signal<BasketAnalysis | null>(null);
  readonly products = signal<ProductPerformance | null>(null);
  readonly targets = signal<TargetProgress[]>([]);
  readonly breaches = signal<
    {
      id: string;
      name: string;
      metric_label: string;
      threshold: string;
      last_value: string | null;
    }[]
  >([]);

  readonly widgetTypes = WIDGET_TYPES;
  readonly draft = signal({ name: '', widgets: ['kpi', 'trend'] as string[] });

  readonly recentTrend = computed(() => (this.trend()?.points ?? []).slice(-6));
  readonly topGeography = computed(() => (this.geography()?.rows ?? []).slice(0, 5));
  readonly topProducts = computed(() => (this.products()?.rows ?? []).slice(0, 5));
  readonly topPairs = computed(() => (this.basket()?.pairs ?? []).slice(0, 3));

  private boardOrganisationId: string | null = null;

  constructor() {
    super();
    effect(() => {
      const organisationId = this.auth.activeOrganisation()?.id ?? null;
      if (!organisationId || organisationId === this.boardOrganisationId) {
        return;
      }
      this.boardOrganisationId = organisationId;
      void this.loadBoards();
    });
  }

  /** The base class reload fires on scope changes; only widget data needs it. */
  protected override async fetch(_query: AnalysisQuery, _request: number): Promise<void> {
    if (this.selected()) {
      await this.loadWidgets();
    }
  }

  value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  patchDraft(change: Partial<{ name: string; widgets: string[] }>): void {
    this.draft.update((draft) => ({ ...draft, ...change }));
  }

  toggleWidget(type: string): void {
    const widgets = this.draft().widgets;
    this.patchDraft({
      widgets: widgets.includes(type)
        ? widgets.filter((item) => item !== type)
        : [...widgets, type],
    });
  }

  widgetTitle(type: string): string {
    return WIDGET_TYPES.find((widget) => widget.value === type)?.label ?? type;
  }

  async loadBoards(): Promise<void> {
    try {
      const boards = await this.monitoring.boards();
      this.boards.set(boards);
      const current = this.selected();
      if (current) {
        this.selected.set(boards.find((board) => board.id === current.id) ?? null);
      }
      if (!this.selected() && boards.length) {
        await this.select(boards[0]);
      }
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'Boards could not be loaded.'));
    }
  }

  async select(board: Board): Promise<void> {
    this.selected.set(board);
    await this.loadWidgets();
  }

  async createBoard(event: Event): Promise<void> {
    event.preventDefault();
    const draft = this.draft();
    if (!draft.name.trim()) {
      this.error.set('Give the board a name.');
      return;
    }
    if (!draft.widgets.length) {
      this.error.set('Choose at least one widget.');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      const board = await this.monitoring.createBoard({
        name: draft.name.trim(),
        widgets: draft.widgets.map((type) => ({ type })),
      });
      this.draft.set({ name: '', widgets: ['kpi', 'trend'] });
      await this.loadBoards();
      await this.select(board);
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'The board could not be created.'));
    } finally {
      this.saving.set(false);
    }
  }

  async deleteBoard(board: Board): Promise<void> {
    try {
      await this.monitoring.deleteBoard(board.id);
      this.selected.set(null);
      await this.loadBoards();
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'The board could not be deleted.'));
    }
  }

  async refresh(): Promise<void> {
    if (this.selected()) {
      await this.loadWidgets();
    }
  }

  async loadWidgets(): Promise<void> {
    const board = this.selected();
    if (!board) {
      return;
    }
    const types = new Set(board.widgets.map((widget) => widget.type));
    const query = this.scope.query();
    this.loadingWidgets.set(true);
    this.error.set(null);
    try {
      const [summary, trend, geography, returns, basket, products, targets, alerts] =
        await Promise.all([
          types.has('kpi') ? this.analytics.summary(query) : Promise.resolve(null),
          types.has('trend') ? this.analytics.trend(query) : Promise.resolve(null),
          types.has('geography') ? this.analytics.geography(query) : Promise.resolve(null),
          types.has('returns') ? this.analytics.returns(query) : Promise.resolve(null),
          types.has('basket') ? this.analytics.basket(query) : Promise.resolve(null),
          types.has('top_products') ? this.analytics.products(query) : Promise.resolve(null),
          types.has('targets') ? this.monitoring.targets() : Promise.resolve([]),
          types.has('alerts') ? this.monitoring.alerts() : Promise.resolve(null),
        ]);
      this.summary.set(summary);
      this.trend.set(trend);
      this.geography.set(geography);
      this.returns.set(returns);
      this.basket.set(basket);
      this.products.set(products);
      this.targets.set(targets ?? []);
      this.breaches.set(
        (alerts?.rules ?? [])
          .filter((rule) => rule.last_state === 'breached')
          .map((rule) => ({
            id: rule.id,
            name: rule.name,
            metric_label: rule.metric_label,
            threshold: rule.threshold,
            last_value: rule.last_value,
          })),
      );
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'The board could not be refreshed.'));
    } finally {
      this.loadingWidgets.set(false);
    }
  }

  attainment(target: TargetProgress): number {
    return Math.max(0, Math.min(100, Number(target.attainment_percent ?? 0)));
  }
}

import { html, nothing, type TemplateResult } from "lit";
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { CHART_WIDTH, PLOT_LEFT, PLOT_WIDTH } from "../render/chart.js";
import type { HistorySeries } from "../data/history.js";

export interface SyncedSeries {
  id: string;
  label: string;
  color: string;
}

export interface TooltipValue {
  label: string;
  color: string;
  value: string;
}

export interface TooltipState {
  x: number;
  y: number;
  time: number;
  values: TooltipValue[];
}

interface TooltipPoint {
  time: number;
  value: number | string | boolean;
}

interface InternalSeries {
  id: string;
  label: string;
  color: string;
  points: TooltipPoint[];
}

export class TooltipController implements ReactiveController {
  private readonly _host: ReactiveControllerHost & EventTarget;

  tooltip: TooltipState | undefined = undefined;

  private _series: InternalSeries[] = [];
  private _fetchedRef?: HistorySeries[];
  private _cacheKey = "";
  private _frame?: number;
  private _pendingPoint?: { x: number; y: number };
  private _chartHeight = 0;
  private _timeBounds = { start: 0, end: 1 };

  constructor(host: ReactiveControllerHost & EventTarget) {
    this._host = host;
    host.addController(this);
  }

  hostConnected(): void {}

  hostDisconnected(): void {
    if (this._frame !== undefined) {
      cancelAnimationFrame(this._frame);
      this._frame = undefined;
    }
  }

  /** Call each render cycle to keep chart dimensions + series data up to date. */
  sync(
    series: SyncedSeries[],
    fetched: HistorySeries[],
    hiddenIds: string[],
    chartHeight: number,
    timeBounds: { start: number; end: number }
  ): void {
    this._chartHeight = chartHeight;
    this._timeBounds = timeBounds;
    this._rebuildCache(series, fetched, hiddenIds);
  }

  private _rebuildCache(
    series: SyncedSeries[],
    fetched: HistorySeries[],
    hiddenIds: string[]
  ): void {
    const key = `${fetched.map((s) => `${s.source.id}:${s.points.length}`).join("|")}::${hiddenIds.join("|")}`;

    if (this._fetchedRef === fetched && this._cacheKey === key) return;

    this._fetchedRef = fetched;
    this._cacheKey = key;

    this._series = series
      .filter((s) => !hiddenIds.includes(s.id))
      .flatMap((s) => {
        const f = fetched.find((fs) => fs.source.id === s.id);
        if (!f || f.points.length === 0) return [];
        return [{ id: s.id, label: s.label, color: s.color, points: f.points }];
      });
  }

  handlePointerMove(event: PointerEvent): void {
    const pt = this._svgPoint(event);
    if (!pt) return;

    this._pendingPoint = pt;

    if (this._frame !== undefined) return;

    this._frame = requestAnimationFrame(() => {
      this._frame = undefined;
      this._apply();
    });
  }

  handlePointerLeave(): void {
    this._pendingPoint = undefined;
    if (this.tooltip !== undefined) {
      this.tooltip = undefined;
      this._host.requestUpdate();
      this._emit();
    }
  }

  private _apply(): void {
    const pt = this._pendingPoint;
    if (!pt) return;

    const targetTime = this._timeAt(pt.x);
    const values: TooltipValue[] = this._series.flatMap((s) => {
      const p = this._nearest(s.points, targetTime);
      return p ? [{ label: s.label, color: s.color, value: String(p.value) }] : [];
    });

    if (values.length === 0) {
      if (this.tooltip !== undefined) {
        this.tooltip = undefined;
        this._host.requestUpdate();
        this._emit();
      }
      return;
    }

    this.tooltip = {
      x: Math.min(Math.max(pt.x, 120), CHART_WIDTH - 120),
      y: Math.min(Math.max(pt.y, 28), this._chartHeight - 28),
      time: targetTime,
      values
    };

    this._host.requestUpdate();
    this._emit();
  }

  private _emit(): void {
    this._host.dispatchEvent(
      new CustomEvent("tooltip-changed", {
        detail: this.tooltip ? { time: this.tooltip.time, values: this.tooltip.values } : null,
        bubbles: true,
        composed: true
      })
    );
  }

  private _nearest(points: TooltipPoint[], time: number): TooltipPoint | undefined {
    if (points.length === 0) return undefined;

    let low = 0;
    let high = points.length - 1;

    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (points[mid].time < time) low = mid + 1;
      else high = mid;
    }

    const cur = points[low];
    const prev = low > 0 ? points[low - 1] : undefined;

    return prev && Math.abs(prev.time - time) < Math.abs(cur.time - time) ? prev : cur;
  }

  private _timeAt(svgX: number): number {
    const ratio = Math.min(Math.max((svgX - PLOT_LEFT) / PLOT_WIDTH, 0), 1);
    return this._timeBounds.start + ratio * (this._timeBounds.end - this._timeBounds.start);
  }

  private _svgPoint(event: PointerEvent): { x: number; y: number } | undefined {
    const el = event.currentTarget;
    if (!(el instanceof Element)) return undefined;

    const rect = el.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * CHART_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * this._chartHeight
    };
  }

  renderTooltip(chartHeight: number): TemplateResult | typeof nothing {
    if (!this.tooltip) return nothing;

    const leftPct = (this.tooltip.x / CHART_WIDTH) * 100;
    const topPct = (this.tooltip.y / chartHeight) * 100;
    const placement = topPct > 58
      ? "translate(-50%, calc(-100% - 10px))"
      : "translate(-50%, 10px)";

    return html`
      <div
        class="tooltip"
        style=${`left:clamp(150px,${leftPct}%,calc(100% - 150px));top:${this.tooltip.y.toFixed(1)}px;transform:${placement};`}
      >
        <div class="tooltip-time">${new Date(this.tooltip.time).toLocaleString()}</div>
        ${this.tooltip.values.map(
          (v) => html`
            <div class="tooltip-row">
              <span class="tooltip-dot" style=${`background:${v.color}`}></span>
              <span class="tooltip-label">${v.label}</span>
              <span>${v.value}</span>
            </div>
          `
        )}
      </div>
    `;
  }
}

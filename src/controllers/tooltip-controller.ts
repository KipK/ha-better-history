import { html, nothing, type TemplateResult } from "lit";
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { CHART_WIDTH, PLOT_LEFT, PLOT_WIDTH, xFor } from "../render/chart.js";
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
  tooltipX: number;
  y: number;
  activeTop: number;
  activeHeight: number;
  activeKey: string;
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

interface PointerChartPoint {
  x: number;
  y: number;
  activeTop: number;
  activeHeight: number;
  activeIds: Set<string>;
  activeKey: string;
}

export class TooltipController implements ReactiveController {
  private readonly _host: ReactiveControllerHost & EventTarget;

  tooltip: TooltipState | undefined = undefined;

  private _series: InternalSeries[] = [];
  private _fetchedRef?: HistorySeries[];
  private _cacheKey = "";
  private _frame?: number;
  private _pendingPoint?: PointerChartPoint;
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
    _chartHeight: number,
    timeBounds: { start: number; end: number }
  ): void {
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
    if (!pt) {
      this._clear();
      return;
    }

    this._pendingPoint = pt;

    if (this._frame !== undefined) return;

    this._frame = requestAnimationFrame(() => {
      this._frame = undefined;
      this._apply();
    });
  }

  handlePointerLeave(): void {
    this._pendingPoint = undefined;
    this._clear();
  }

  private _clear(): void {
    if (this.tooltip === undefined) return;

    this.tooltip = undefined;
    this._host.requestUpdate();
    this._emit();
  }

  private _apply(): void {
    const pt = this._pendingPoint;
    if (!pt) return;

    const targetTime = this._timeAt(pt.x);
    const activeSeries = this._series.filter((s) => pt.activeIds.has(s.id));
    const selectedPoint = this._nearestPoint(activeSeries, targetTime);
    if (!selectedPoint) {
      if (this.tooltip !== undefined) {
        this.tooltip = undefined;
        this._host.requestUpdate();
        this._emit();
      }
      return;
    }
    const selectedTime = selectedPoint.time;
    const values: TooltipValue[] = activeSeries.flatMap((s) => {
      const p = this._pointAtOrBefore(s.points, selectedTime);
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

    if (
      this.tooltip?.time === selectedTime &&
      this.tooltip.activeTop === pt.activeTop &&
      this.tooltip.activeHeight === pt.activeHeight &&
      this.tooltip.activeKey === pt.activeKey &&
      Math.abs(this.tooltip.tooltipX - Math.min(Math.max(pt.x, 120), CHART_WIDTH - 120)) < 1 &&
      Math.abs(this.tooltip.y - Math.min(Math.max(pt.y, pt.activeTop + 28), pt.activeTop + pt.activeHeight - 28)) < 1
    ) {
      return;
    }

    const activeBottom = pt.activeTop + pt.activeHeight;
    const tooltipX = Math.min(Math.max(pt.x, 120), CHART_WIDTH - 120);
    const tooltipY = Math.min(Math.max(pt.y, pt.activeTop + 28), activeBottom - 28);

    this.tooltip = {
      x: xFor(selectedTime, this._timeBounds),
      tooltipX,
      y: tooltipY,
      activeTop: pt.activeTop,
      activeHeight: pt.activeHeight,
      activeKey: pt.activeKey,
      time: selectedTime,
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

  private _nearestPoint(series: InternalSeries[], time: number): TooltipPoint | undefined {
    let nearest: TooltipPoint | undefined;
    let distance = Number.POSITIVE_INFINITY;

    for (const item of series) {
      const point = this._nearest(item.points, time);
      if (!point) continue;

      const pointDistance = Math.abs(point.time - time);
      if (pointDistance < distance) {
        nearest = point;
        distance = pointDistance;
      }
    }

    return nearest;
  }

  private _pointAtOrBefore(points: TooltipPoint[], time: number): TooltipPoint | undefined {
    if (points.length === 0) return undefined;

    let low = 0;
    let high = points.length - 1;

    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (points[mid].time <= time) low = mid;
      else high = mid - 1;
    }

    return points[low].time <= time ? points[low] : undefined;
  }

  private _timeAt(svgX: number): number {
    const ratio = Math.min(Math.max((svgX - PLOT_LEFT) / PLOT_WIDTH, 0), 1);
    return this._timeBounds.start + ratio * (this._timeBounds.end - this._timeBounds.start);
  }

  private _svgPoint(event: PointerEvent): PointerChartPoint | undefined {
    const container = event.currentTarget;
    if (!(container instanceof Element)) return undefined;

    const canvas = event.composedPath().find((node): node is HTMLElement =>
      node instanceof HTMLElement && node.classList.contains("graph-canvas")
    );

    if (!canvas) return undefined;
    const activeIds = new Set((canvas.dataset.seriesIds ?? "").split("|").filter((id) => id !== ""));
    if (activeIds.size === 0) return undefined;

    const containerRect = container.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();

    if (
      event.clientX < canvasRect.left ||
      event.clientX > canvasRect.right ||
      event.clientY < canvasRect.top ||
      event.clientY > canvasRect.bottom
    ) {
      return undefined;
    }

    const activeTop = canvasRect.top - containerRect.top;
    return {
      x: ((event.clientX - canvasRect.left) / canvasRect.width) * CHART_WIDTH,
      y: event.clientY - containerRect.top,
      activeTop,
      activeHeight: canvasRect.height,
      activeIds,
      activeKey: [...activeIds].join("|")
    };
  }

  renderTooltip(): TemplateResult | typeof nothing {
    if (!this.tooltip) return nothing;

    const axisLeftPct = (this.tooltip.x / CHART_WIDTH) * 100;
    const tooltipLeftPct = (this.tooltip.tooltipX / CHART_WIDTH) * 100;
    const estimatedHeight = 120;
    const activeBottom = this.tooltip.activeTop + this.tooltip.activeHeight;
    const spaceBelow = activeBottom - this.tooltip.y;
    const placement = spaceBelow < estimatedHeight
      ? "translate(-50%, calc(-100% - 10px))"
      : "translate(-50%, 10px)";

    return html`
      <div class="tooltip-axis-pointer" style=${`left:${axisLeftPct}%;top:${this.tooltip.activeTop.toFixed(1)}px;height:${this.tooltip.activeHeight.toFixed(1)}px;`}></div>
      <div
        class="tooltip"
        style=${`left:clamp(150px,${tooltipLeftPct}%,calc(100% - 150px));top:${this.tooltip.y.toFixed(1)}px;transform:${placement};`}
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

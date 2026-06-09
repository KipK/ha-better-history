import { html, nothing, type TemplateResult } from "lit";
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { PLOT_LEFT, PLOT_RIGHT, PLOT_WIDTH, xFor } from "../render/chart.js";
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
  placement: "above" | "below";
  rowCount: number;
  activeLeft: number;
  activeTop: number;
  activeWidth: number;
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
  viewportTop: number;
  viewportBottom: number;
  activeLeft: number;
  activeTop: number;
  activeWidth: number;
  activeHeight: number;
  activeIds: Set<string>;
  activeKey: string;
  touchLike: boolean;
}

export class TooltipController implements ReactiveController {
  private readonly _host: ReactiveControllerHost & EventTarget & { renderRoot?: ParentNode };

  tooltip: TooltipState | undefined = undefined;

  private _series: InternalSeries[] = [];
  private _fetchedRef?: HistorySeries[];
  private _cacheKey = "";
  private _frame?: number;
  private _pendingPoint?: PointerChartPoint;
  private _timeBounds = { start: 0, end: 1 };
  private _measuredTooltip?: { rowCount: number; height: number };

  constructor(host: ReactiveControllerHost & EventTarget & { renderRoot?: ParentNode }) {
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

  hostUpdated(): void {
    if (!this.tooltip) return;

    const tooltipEl = this._host.renderRoot?.querySelector?.(".tooltip");
    if (!(tooltipEl instanceof HTMLElement)) return;

    const height = tooltipEl.getBoundingClientRect().height;
    const rowCount = this.tooltip.rowCount;
    const previous = this._measuredTooltip;
    if (height <= 0 || (previous?.rowCount === rowCount && Math.abs(previous.height - height) < 1)) {
      return;
    }

    this._measuredTooltip = { rowCount, height };
    this._apply();
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
    this._queuePoint(pt);
  }

  private _queuePoint(pt: PointerChartPoint | undefined): void {
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
    const rowCount = values.length;
    const tooltipHeight = this._tooltipHeight(rowCount);
    const placement = this._placement(pt, tooltipHeight);
    const tooltipY = this._tooltipY(pt, placement, tooltipHeight);

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
      this.tooltip.activeLeft === pt.activeLeft &&
      this.tooltip.activeTop === pt.activeTop &&
      this.tooltip.activeWidth === pt.activeWidth &&
      this.tooltip.activeHeight === pt.activeHeight &&
      this.tooltip.activeKey === pt.activeKey &&
      Math.abs(this.tooltip.tooltipX - Math.min(Math.max(pt.x, PLOT_LEFT + 80), PLOT_RIGHT - 80)) < 1 &&
      Math.abs(this.tooltip.y - tooltipY) < 1 &&
      this.tooltip.placement === placement &&
      this.tooltip.rowCount === rowCount
    ) {
      return;
    }

    const tooltipX = Math.min(Math.max(pt.x, PLOT_LEFT + 80), PLOT_RIGHT - 80);

    this.tooltip = {
      x: xFor(selectedTime, this._timeBounds),
      tooltipX,
      y: tooltipY,
      placement,
      rowCount,
      activeLeft: pt.activeLeft,
      activeTop: pt.activeTop,
      activeWidth: pt.activeWidth,
      activeHeight: pt.activeHeight,
      activeKey: pt.activeKey,
      time: selectedTime,
      values
    };

    this._host.requestUpdate();
    this._emit();
  }

  private _placement(pt: PointerChartPoint, tooltipHeight: number): "above" | "below" {
    const activeBottom = pt.activeTop + pt.activeHeight;
    const preferred = pt.touchLike
      ? pt.y < pt.activeTop + pt.activeHeight / 2 ? "above" : "below"
      : activeBottom - pt.y < 120 ? "above" : "below";
    const minTop = this._minTooltipTop(pt);
    const maxBottom = this._maxTooltipBottom(pt);
    const aboveTop = this._tooltipAnchorY(pt, "above") - tooltipHeight - 10;
    const belowBottom = this._tooltipAnchorY(pt, "below") + tooltipHeight + 10;
    const aboveFits = aboveTop >= minTop;
    const belowFits = belowBottom <= maxBottom;

    if (preferred === "above" && aboveFits) return "above";
    if (preferred === "below" && belowFits) return "below";
    if (aboveFits) return "above";
    if (belowFits) return "below";

    const aboveSpace = this._tooltipAnchorY(pt, "above") - minTop;
    const belowSpace = maxBottom - this._tooltipAnchorY(pt, "below");
    return aboveSpace >= belowSpace ? "above" : "below";
  }

  private _tooltipY(pt: PointerChartPoint, placement: "above" | "below", tooltipHeight: number): number {
    const desired = placement === "above"
      ? this._tooltipAnchorY(pt, placement) - tooltipHeight - 10
      : this._tooltipAnchorY(pt, placement) + 10;
    const minTop = this._minTooltipTop(pt);
    const maxTop = Math.max(minTop, this._maxTooltipBottom(pt) - tooltipHeight);

    return Math.min(Math.max(desired, minTop), maxTop);
  }

  private _tooltipAnchorY(pt: PointerChartPoint, placement: "above" | "below"): number {
    if (pt.touchLike) {
      return placement === "above"
        ? pt.activeTop + pt.activeHeight - 10
        : pt.activeTop + 10;
    }

    return Math.min(Math.max(pt.y, pt.activeTop + 28), pt.activeTop + pt.activeHeight - 28);
  }

  private _tooltipHeight(rowCount: number): number {
    if (this._measuredTooltip?.rowCount === rowCount) return this._measuredTooltip.height;

    return 34 + rowCount * 18;
  }

  private _minTooltipTop(pt: PointerChartPoint): number {
    return Math.max(8, pt.viewportTop + 8);
  }

  private _maxTooltipBottom(pt: PointerChartPoint): number {
    return Math.max(this._minTooltipTop(pt) + 40, pt.viewportBottom - 8);
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

  private _svgPoint(event: PointerEvent, container = event.currentTarget): PointerChartPoint | undefined {
    if (!(container instanceof Element)) return undefined;

    const canvas = event.composedPath().find((node): node is HTMLElement =>
      node instanceof HTMLElement && node.classList.contains("graph-canvas")
    );

    if (!canvas) return undefined;
    const activeIds = new Set((canvas.dataset.seriesIds ?? "").split("|").filter((id) => id !== ""));
    if (activeIds.size === 0) return undefined;

    const containerRect = container.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || containerRect.height;

    if (
      event.clientX < canvasRect.left ||
      event.clientX > canvasRect.right ||
      event.clientY < canvasRect.top ||
      event.clientY > canvasRect.bottom
    ) {
      return undefined;
    }

    const activeLeft = canvasRect.left - containerRect.left;
    const activeTop = canvasRect.top - containerRect.top;
    return {
      x: PLOT_LEFT + ((event.clientX - canvasRect.left) / canvasRect.width) * PLOT_WIDTH,
      y: event.clientY - containerRect.top,
      viewportTop: Math.max(0, -containerRect.top),
      viewportBottom: Math.min(containerRect.height, viewportHeight - containerRect.top),
      activeLeft,
      activeTop,
      activeWidth: canvasRect.width,
      activeHeight: canvasRect.height,
      activeIds,
      activeKey: [...activeIds].join("|"),
      touchLike: event.pointerType === "touch" || window.matchMedia("(hover: none) and (pointer: coarse)").matches
    };
  }

  renderTooltip(): TemplateResult | typeof nothing {
    if (!this.tooltip) return nothing;

    const axisLeft = this.tooltip.activeLeft + ((this.tooltip.x - PLOT_LEFT) / PLOT_WIDTH) * this.tooltip.activeWidth;
    const tooltipLeft = this.tooltip.activeLeft + ((this.tooltip.tooltipX - PLOT_LEFT) / PLOT_WIDTH) * this.tooltip.activeWidth;

    return html`
      <div class="tooltip-axis-pointer" style=${`left:${axisLeft.toFixed(1)}px;top:${this.tooltip.activeTop.toFixed(1)}px;height:${this.tooltip.activeHeight.toFixed(1)}px;`}></div>
      <div
        class="tooltip"
        data-placement=${this.tooltip.placement}
        style=${`left:clamp(150px,${tooltipLeft.toFixed(1)}px,calc(100% - 150px));top:${this.tooltip.y.toFixed(1)}px;transform:translateX(-50%);`}
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

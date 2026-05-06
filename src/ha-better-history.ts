import { LitElement, html, nothing, svg, type PropertyValues, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import { DataController } from "./controllers/data-controller.js";
import { TooltipController, type SyncedSeries } from "./controllers/tooltip-controller.js";
import { resolveConfig, resolvedSeriesToSource } from "./data/resolve-config.js";
import { localize } from "./localize/localize.js";
import {
  buildChartData,
  buildGraphGroups,
  CHART_WIDTH,
  PLOT_LEFT,
  PLOT_RIGHT,
  PLOT_TOP,
  PLOT_WIDTH,
  SEGMENT_ROW_HEIGHT,
  type ChartRenderData,
  type GraphGroup,
  type RenderableSeries
} from "./render/chart.js";
import { GRAPH_TOP, GRAPH_HEIGHT } from "./render/scales.js";
import { paletteColor } from "./render/colors.js";
import { chartStyles } from "./styles/chart.css.js";
import type { BetterHistoryConfig, ResolvedConfig } from "./types/config.js";
import type { HistorySeries, HistorySource } from "./data/history.js";
import type { HassEntity, HomeAssistant } from "./types/ha.js";
import { preloadDatePicker, renderDatePicker, datePickerAvailable } from "./ui/date-picker.js";
import {
  preloadEntityPickerComponents,
  entityPickerAvailable,
  entityLabel,
  renderEntityPicker
} from "./ui/entity-picker.js";
import { ensureHaComponents } from "./load-ha-components.js";
import { logPerformance, performanceNow } from "./utils/performance.js";

const TEMPERATURE_UNIT_RE = /°[CF]|[CFK]$/;
const SOURCE_ADD_BATCH_MS = 60;

function isTemperatureUnit(unit: string): boolean {
  return TEMPERATURE_UNIT_RE.test(unit);
}

interface ChartRenderCache {
  seriesRef: HistorySeries[];
  sourceKey: string;
  hiddenKey: string;
  startTime: number;
  endTime: number;
  containerWidth: number;
  data: ChartRenderData;
}

interface GraphGroupRenderCache {
  dataRef: ChartRenderData;
  maxXTicks: number;
  groups: GraphGroup[];
}

export class HaBetterHistory extends LitElement {
  static styles = chartStyles;

  @property({ attribute: false }) hass?: HomeAssistant;
  @property({ attribute: false }) config?: BetterHistoryConfig;
  @property({ attribute: false }) entities?: string[];
  @property({ type: Number }) hours = 24;
  @property({ attribute: false }) startDate?: Date;
  @property({ attribute: false }) endDate?: Date;
  @property({ type: Boolean, attribute: "show-date-picker" }) showDatePicker = false;
  @property({ type: Boolean, attribute: "show-entity-picker" }) showEntityPicker = false;
  @property({ type: Boolean, attribute: "show-legend" }) showLegend = true;
  @property({ type: Boolean, attribute: "show-tooltip" }) showTooltip = true;
  @property({ type: Boolean, attribute: "show-controls" }) showControls = true;
  @property() width?: string;
  @property() height?: string;
  @property() language?: string;
  @property({ type: Boolean, attribute: "debug-performance" }) debugPerformance = false;

  @state() private _resolved?: ResolvedConfig;
  @state() private _hiddenSeriesIds: string[] = [];
  @state() private _rangeStart?: Date;
  @state() private _rangeEnd?: Date;
  @state() private _datePickerReady = false;
  @state() private _entityComponentsReady = false;

  @state() private _attributeMenuOpen = false;
  @state() private _selectedEntityId?: string;
  @state() private _path: string[] = [];
  @state() private _selectedSources: HistorySource[] = [];
  @state() private _customEntityIds: string[] = [];
  @state() private _entityPickerOpen = false;

  private readonly _data = new DataController(this);
  private readonly _tooltip = new TooltipController(this);
  private _chartRenderCache?: ChartRenderCache;
  private _graphGroupRenderCache?: GraphGroupRenderCache;
  private _prevClipX = new Map<string, number>();
  private _prevStartTime = 0;
  private _prevEndTime = 0;
  private _prevContainerWidth = 0;
  private _wasLoading = false;
  private _suppressLineAnimation = false;
  private _pendingAddedSources: HistorySource[] = [];
  private _sourceAddBatchTimer?: ReturnType<typeof setTimeout>;

  @state() private _containerWidth = 0;
  private _resizeObserver?: ResizeObserver;

  connectedCallback(): void {
    super.connectedCallback();
    ensureHaComponents();
    document.addEventListener("click", this._handleDocumentClick, true);
    this._resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width !== this._containerWidth) {
        this._containerWidth = width;
      }
    });
    this._resizeObserver.observe(this);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("click", this._handleDocumentClick, true);
    this._resizeObserver?.disconnect();
    this._resizeObserver = undefined;
    if (this._sourceAddBatchTimer !== undefined) {
      clearTimeout(this._sourceAddBatchTimer);
      this._sourceAddBatchTimer = undefined;
    }
  }

  private _maxXTicks(): number {
    if (this._containerWidth <= 0) return 12;
    return Math.max(3, Math.floor(this._containerWidth * PLOT_WIDTH / (CHART_WIDTH * 50)));
  }

  private _effectiveStartDate(): Date {
    return this._rangeStart ?? this.startDate ?? this.config?.startDate ?? new Date(Date.now() - (this.config?.hours ?? this.hours ?? 24) * 3600000);
  }

  private _effectiveEndDate(): Date {
    return this._rangeEnd ?? this.endDate ?? this.config?.endDate ?? new Date();
  }

  private _pickerEntities(): HassEntity[] {
    if (!this.hass) return [];

    const configEntityIds = this.config?.defaultEntities ?? [];

    return [...configEntityIds, ...this._customEntityIds]
      .filter((entityId) => typeof entityId === "string" && entityId !== "")
      .filter((entityId, index, entityIds) => entityIds.indexOf(entityId) === index)
      .map((entityId) => this.hass?.states[entityId])
      .filter((entity): entity is HassEntity => entity !== undefined);
  }

  private _fetchSources(): HistorySource[] {
    const sources: HistorySource[] = [];
    const seen = new Set<string>();

    if (this._resolved) {
      for (const s of this._resolved.series) {
        if (!seen.has(s.id)) {
          seen.add(s.id);
          sources.push(resolvedSeriesToSource(s));
        }
      }
    }

    for (const s of this._selectedSources) {
      if (!seen.has(s.id)) {
        seen.add(s.id);
        sources.push(s);
      }
    }

    return sources;
  }

  private _isDefaultSource(source: HistorySource): boolean {
    return (this._resolved?.series ?? []).some((s) => s.id === source.id);
  }

  private _lastFetchKey = "";
  private _lastFetchSources: HistorySource[] = [];
  private _lastHassResolveTime = 0;

  protected willUpdate(changed: PropertyValues): void {
    this._data.debugPerformance = this.debugPerformance || this.config?.debugPerformance === true;

    const startTime = this._effectiveStartDate().getTime();
    const endTime = this._effectiveEndDate().getTime();

    if (startTime !== this._prevStartTime || endTime !== this._prevEndTime || this._containerWidth !== this._prevContainerWidth) {
      this._prevClipX.clear();
      this._prevStartTime = startTime;
      this._prevEndTime = endTime;
      this._prevContainerWidth = this._containerWidth;
    }

    if (this._data.loading && this._data.series.length === 0) {
      this._prevClipX.clear();
    }

    const watch = ["_rangeStart", "_rangeEnd", "_selectedSources", "hass", "config", "entities", "hours", "startDate", "endDate", "showDatePicker", "showEntityPicker", "showLegend", "showTooltip", "width", "height", "language", "debugPerformance"];

    if (watch.some((p) => changed.has(p))) {
      const hassOnly = !watch.some((p) => p !== "hass" && changed.has(p));

      if (hassOnly) {
        const now = Date.now();
        const rounded = Math.floor(now / 1000) * 1000;
        if (rounded === this._lastHassResolveTime && this._lastFetchKey) return;
        this._lastHassResolveTime = rounded;
      }

      const resolved = resolveConfig({
        config: this.config,
        entities: this.entities,
        hours: this.hours,
        startDate: this._effectiveStartDate(),
        endDate: this._effectiveEndDate(),
        showDatePicker: this.showDatePicker,
        showEntityPicker: this.showEntityPicker,
        showLegend: this.showLegend,
        showTooltip: this.showTooltip,
        width: this.width,
        height: this.height,
        language: this.language,
        hass: this.hass
      });

      this._resolved = resolved;

      if (!this._rangeStart && !this._rangeEnd) {
        this._rangeStart = resolved.startDate;
        this._rangeEnd = resolved.endDate;
      }

      const sources = this._fetchSources();
      const sourceIds = sources.map((s) => s.id).sort().join("|");
      const fetchKey = `${sourceIds}|${resolved.startDate.getTime()}|${resolved.endDate.getTime()}`;

      if (fetchKey !== this._lastFetchKey) {
        const prevSourceIds = this._lastFetchKey.split("|").slice(0, -2).join("|");
        const timeChanged = sourceIds === prevSourceIds && this._lastFetchKey !== "";

        if (this._lastFetchSources.length > 0 && !timeChanged) {
          const prevIds = new Set(this._lastFetchSources.map((s) => s.id));
          const currIds = new Set(sources.map((s) => s.id));
          const added = sources.filter((s) => !prevIds.has(s.id));
          const removed = this._lastFetchSources.filter((s) => !currIds.has(s.id)).map((s) => s.id);

          if (added.length > 0 && removed.length === 0) {
            this._lastFetchKey = fetchKey;
            this._lastFetchSources = sources;
            this._data.addSources(this.hass, added, resolved.startDate, resolved.endDate);
          } else if (removed.length > 0 && added.length === 0) {
            this._lastFetchKey = fetchKey;
            this._lastFetchSources = sources;
            this._data.removeSources(removed);
          } else {
            this._lastFetchKey = fetchKey;
            this._lastFetchSources = sources;
            this._data.fetch(this.hass, sources, resolved.startDate, resolved.endDate);
          }
        } else {
          this._lastFetchKey = fetchKey;
          this._lastFetchSources = sources;
          this._data.fetch(this.hass, sources, resolved.startDate, resolved.endDate);
        }
      }

      if (resolved.showDatePicker && !this._datePickerReady) {
        preloadDatePicker().then(() => {
          this._datePickerReady = datePickerAvailable();
          this.requestUpdate();
        });
      }

      if (resolved.showEntityPicker && !this._entityComponentsReady) {
        preloadEntityPickerComponents().then(() => {
          this._entityComponentsReady = entityPickerAvailable();
          this.requestUpdate();
        });
      }
    }
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("_attributeMenuOpen") && this._attributeMenuOpen) {
      this._positionEntityMenu();
    }
    this._animateClipPaths();
    this._wasLoading = this._data.loading;
  }

  private _onDateRangeChanged(startDate: Date, endDate: Date): void {
    this._rangeStart = startDate;
    this._rangeEnd = endDate;

    this.dispatchEvent(
      new CustomEvent("range-changed", {
        detail: { startDate, endDate },
        bubbles: true,
        composed: true
      })
    );

    void this.requestUpdate();
  }

  private _pickScaleGroup(source: HistorySource, _existing: RenderableSeries[]): string {
    if (source.valueType !== "number") return `series:${source.id}`;

    if (source.unit) {
      const match = this._resolved?.series.find(
        (s) => s.unit === source.unit && s.valueType === "number"
      );
      if (match) return match.scaleGroupKey;

      const tempGroup = this._resolved?.series.find(
        (s) => s.scaleGroupKey === "group:temperature"
      );
      if (tempGroup && isTemperatureUnit(source.unit)) return tempGroup.scaleGroupKey;
    }

    return source.unit ? `unit:${source.unit}` : `series:${source.id}`;
  }

  private _buildRenderSeries(): RenderableSeries[] {
    if (!this._resolved) return [];

    const result: RenderableSeries[] = this._resolved.series.flatMap((resolved) => {
      const fetched = this._data.series.find((s) => s.source.id === resolved.id);

      return [
        {
          id: resolved.id,
          label: resolved.label,
          color: resolved.color,
          scaleGroupKey: resolved.scaleGroupKey,
          scaleMode: resolved.scaleMode,
          scaleMin: resolved.scaleMin,
          scaleMax: resolved.scaleMax,
          valueType: resolved.valueType,
          points: fetched?.points ?? []
        }
      ];
    });

    for (const source of this._selectedSources) {
      if (result.some((s) => s.id === source.id)) continue;

      const fetched = this._data.series.find((s) => s.source.id === source.id);
      if (!fetched) continue;

      const colorIndex = result.length;
      const scaleGroupKey = this._pickScaleGroup(source, result);

      result.push({
        id: source.id,
        label: source.label,
        color: paletteColor(colorIndex),
        scaleGroupKey,
        scaleMode: "auto",
        valueType: source.valueType,
        points: fetched?.points ?? []
      });
    }

    return result;
  }

  private _chartSourceKey(): string {
    return [
      ...(this._resolved?.series.map((source) => source.id) ?? []),
      ...this._selectedSources.map((source) => source.id)
    ].join("|");
  }

  private _chartData(): ChartRenderData {
    const hiddenKey = this._hiddenSeriesIds.join("|");
    const sourceKey = this._chartSourceKey();
    const cache = this._chartRenderCache;
    const startTime = this._resolved?.startDate.getTime() ?? 0;
    const endTime = this._resolved?.endDate.getTime() ?? 0;
    const containerWidth = this._containerWidth;

    if (
      cache &&
      cache.seriesRef === this._data.series &&
      cache.sourceKey === sourceKey &&
      cache.hiddenKey === hiddenKey &&
      cache.startTime === startTime &&
      cache.endTime === endTime &&
      cache.containerWidth === containerWidth
    ) {
      return cache.data;
    }

    const maxXTicks = this._maxXTicks();
    const all = this._buildRenderSeries();
    const visible = all.filter((s) => !this._hiddenSeriesIds.includes(s.id));
    const timeBounds = { start: startTime, end: Math.max(endTime, startTime + 1) };
    const debugPerformance = this._data.debugPerformance;
    const chartBuildStart = debugPerformance ? performanceNow() : 0;
    const data = buildChartData(all, visible, timeBounds, this._resolved?.disableClimateOverlay ?? false, maxXTicks);
    const chartBuildDurationMs = debugPerformance ? performanceNow() - chartBuildStart : 0;

    if (debugPerformance) {
      logPerformance(debugPerformance, "chart.build_data", {
        allSeriesCount: all.length,
        visibleSeriesCount: visible.length,
        pointCount: visible.reduce((total, series) => total + series.points.length, 0),
        groupCount: data.numericScales.length,
        segmentCount: data.segments.length,
        lineCount: data.numericLines.length,
        buildDurationMs: Math.round(chartBuildDurationMs)
      });
    }

    this._chartRenderCache = { seriesRef: this._data.series, sourceKey, hiddenKey, startTime, endTime, containerWidth, data };

    return data;
  }

  private _graphGroups(data: ChartRenderData): GraphGroup[] {
    const maxXTicks = this._maxXTicks();
    const cache = this._graphGroupRenderCache;

    if (cache && cache.dataRef === data && cache.maxXTicks === maxXTicks) {
      return cache.groups;
    }

    const groups = buildGraphGroups(data, maxXTicks);
    this._graphGroupRenderCache = { dataRef: data, maxXTicks, groups };

    return groups;
  }

  private _renderGraphGroup(group: GraphGroup): TemplateResult {
    const showLegend = this._resolved?.showLegend ?? true;

    return html`
      <div class="graph-section">
        <div class="graph-canvas" style="height:${group.canvasHeight}px">
          <svg
            viewBox="0 0 ${CHART_WIDTH} ${group.svgHeight}"
            height="${group.svgHeight}"
            preserveAspectRatio="none"
          >
            ${group.xLabels.map(
              (label) => svg`
                <line class="grid-line grid-line--vertical" x1=${label.x.toFixed(1)} y1=${PLOT_TOP} x2=${label.x.toFixed(1)} y2=${group.svgHeight - 18}></line>
              `
            )}
            ${group.yLabels.map(
              (label) => svg`
                <line class="grid-line grid-line--horizontal" x1=${PLOT_LEFT} y1=${label.y.toFixed(1)} x2=${PLOT_RIGHT} y2=${label.y.toFixed(1)}></line>
              `
            )}
            <defs>
              ${group.lines.map((line) => {
                const safeId = line.id.replace(/[^a-zA-Z0-9]/g, "_");
                const clipId = `clip-${safeId}`;
                const rectId = `rect-${safeId}`;
                return svg`
                  <clipPath id=${clipId}>
                    <rect id=${rectId} x="0" y="0" width="0" height=${group.svgHeight}></rect>
                  </clipPath>
                `;
              })}
            </defs>
            ${group.heatingAreas.map(
              (area) => svg`<polygon class="climate-heating-area" points=${area.points}></polygon>`
            )}
            ${group.lines.map(
              (line) => {
                const safeId = line.id.replace(/[^a-zA-Z0-9]/g, "_");
                const clipId = `clip-${safeId}`;
                const pts = line.points.split(" ");
                const lastPt = pts[pts.length - 1];
                const targetX = lastPt ? parseFloat(lastPt.split(",")[0]) : 0;
                const prevX = this._prevClipX.get(line.id) ?? 0;
                const needAnim = !this._suppressLineAnimation && targetX > prevX;

                return svg`<polyline class="line" clip-path="url(#${clipId})" data-line-id=${line.id} data-animate-clip=${needAnim ? "true" : nothing} data-target-x=${targetX} points=${line.points} stroke=${line.color}></polyline>`;
              }
            )}
            ${group.segments.map(
              (seg) => svg`<rect class="segment" x=${seg.x} y=${seg.y} width=${seg.width} height="9" fill=${seg.fill}></rect>`
            )}
            ${group.series
              .filter((s) => s.valueType !== "number" && s.valueType !== "boolean")
              .map((s, ni) => {
                const y = GRAPH_TOP + GRAPH_HEIGHT + 10 + ni * SEGMENT_ROW_HEIGHT;
                return svg`<rect class="segment-border" x=${PLOT_LEFT} y=${y} width=${PLOT_WIDTH} height="9" fill="none" stroke=${s.color}></rect>`;
              })}
            <line class="axis" x1=${PLOT_LEFT} y1=${PLOT_TOP} x2=${PLOT_LEFT} y2=${group.svgHeight - 18}></line>
            <line class="axis" x1=${PLOT_LEFT} y1=${group.svgHeight - 18} x2=${PLOT_RIGHT} y2=${group.svgHeight - 18}></line>
            ${group.scale
              ? group.yLabels.map(
                  (label) => svg`
                    <line class="axis tick" x1=${PLOT_LEFT - 4} y1=${label.y.toFixed(1)} x2=${PLOT_LEFT} y2=${label.y.toFixed(1)}></line>
                  `
                )
              : nothing}
          </svg>
          ${group.yLabels.map(
            (label) => {
              const pct = ((PLOT_LEFT / CHART_WIDTH) * 100).toFixed(2);
              return html`<span class="y-axis-label" style="top:${label.y.toFixed(1)}px;left:0;width:${pct}%;text-align:right;padding-right:6px;">${label.value}</span>`;
            }
          )}
          ${group.xLabels.map(
            (label) => {
              const pct = ((label.x / CHART_WIDTH) * 100).toFixed(2);
              return html`<span class="x-axis-label ${label.bold ? "x-axis-label--bold" : ""}" style="left:${pct}%;top:${(group.svgHeight + 3)}px;">${label.label}</span>`;
            }
          )}
        </div>
        ${showLegend && group.allSeries.length > 0
          ? html`
            <div class="graph-legend">
              ${group.allSeries.map((s) => {
                const hidden = this._hiddenSeriesIds.includes(s.id);
                const swatchStyle =
                  s.valueType === "string"
                    ? `background:color-mix(in srgb,${s.color} 30%,transparent);border:1px solid ${s.color};`
                    : `background:${s.color};`;
                return html`
                  <button class="legend-item" ?hidden-series=${hidden} @click=${() => this._toggleSeries(s.id)}>
                    <span class="swatch" style=${swatchStyle}></span>
                    <span class="legend-label">${s.label}</span>
                  </button>
                `;
              })}
            </div>
          `
          : nothing}
      </div>
    `;
  }

  private _animateClipPaths(): void {
    const root = this.renderRoot;
    if (!root) return;

    const polylines = root.querySelectorAll<SVGPolylineElement>('polyline[data-animate-clip="true"]');
    if (polylines.length === 0) {
      // Still need to ensure all rects have their correct final width if not animating
      const allPolylines = root.querySelectorAll<SVGPolylineElement>("polyline[data-line-id]");
      allPolylines.forEach((poly) => {
        const lineId = poly.getAttribute("data-line-id");
        if (!lineId) return;
        const targetX = Number(poly.getAttribute("data-target-x"));
        const safeId = lineId.replace(/[^a-zA-Z0-9]/g, "_");
        const rect = root.querySelector(`#rect-${safeId}`);
        if (rect instanceof SVGRectElement) {
          rect.setAttribute("width", targetX.toString());
          this._prevClipX.set(lineId, targetX);
        }
      });
      return;
    }

    polylines.forEach((poly) => {
      const lineId = poly.getAttribute("data-line-id");
      const targetX = Number(poly.getAttribute("data-target-x"));
      if (!lineId || !Number.isFinite(targetX)) return;

      const prevX = this._prevClipX.get(lineId) ?? 0;
      const safeId = lineId.replace(/[^a-zA-Z0-9]/g, "_");
      const rect = root.querySelector(`#rect-${safeId}`);

      if (rect instanceof SVGRectElement) {
        // Force a stable starting state for the transition
        rect.style.setProperty("transition", "none");
        rect.setAttribute("width", prevX.toString());

        // Force reflow
        void rect.getBoundingClientRect();

        // Apply transition to new target width
        rect.style.setProperty("transition", "width 0.9s cubic-bezier(0.25, 0.1, 0.25, 1)");
        rect.setAttribute("width", targetX.toString());

        this._prevClipX.set(lineId, targetX);
      }

      poly.removeAttribute("data-animate-clip");
    });
  }

  private _renderChartBody(): TemplateResult {
    if (this._data.error) {
      const isTimeout = /timed?\s*out/i.test(this._data.error);
      return html`<div class="error">${localize(this.hass, isTimeout ? "error_timeout" : "error")}</div>`;
    }

    if (!this._resolved || (this._resolved.series.length === 0 && this._selectedSources.length === 0)) {
      return html`<div class="empty">${localize(this.hass, "no_series")}</div>`;
    }

    const chartData = this._chartData();
    const hasData = chartData.visibleSeries.some((s) => s.points.length > 0);
    const showTooltip = this._resolved.showTooltip;
    const groups = this._graphGroups(chartData);
    const hasStructure = groups.length > 0;
    const showStructure = hasStructure && (hasData || this._data.loading);
    this._suppressLineAnimation = this._wasLoading && !this._data.loading;
    const totalHeight = groups.reduce((h, g) => h + g.canvasHeight, 0);

    if (hasData && showTooltip) {
      const tooltipSeries: SyncedSeries[] = [
        ...(this._resolved?.series.map((s) => ({ id: s.id, label: s.label, color: s.color })) ?? []),
        ...this._selectedSources
          .filter((src) => !this._resolved?.series.some((r) => r.id === src.id))
          .map((src, i) => ({
            id: src.id,
            label: src.label,
            color: paletteColor(this._resolved!.series.length + i)
          }))
      ];

      this._tooltip.sync(
        tooltipSeries,
        this._data.series,
        this._hiddenSeriesIds,
        totalHeight,
        chartData.timeBounds
      );
    }

    return html`
      <div class="chart-surface">
        ${showStructure
          ? html`
              <div class="chart-graphs"
                @pointermove=${showTooltip ? (e: PointerEvent) => this._tooltip.handlePointerMove(e) : nothing}
                @pointerleave=${showTooltip ? () => this._tooltip.handlePointerLeave() : nothing}
              >
                ${groups.map((g) => this._renderGraphGroup(g))}
                ${showTooltip ? this._tooltip.renderTooltip(totalHeight) : nothing}
                ${this._data.loading ? html`<div class="chart-loading-overlay"><span class="chart-loading-label">${localize(this.hass, "loading")}</span></div>` : nothing}
              </div>`
          : this._data.loading
            ? html`<div class="chart-loading"><span class="chart-loading-label">${localize(this.hass, "loading")}</span></div>`
          : html`<div class="empty">${localize(this.hass, "empty")}</div>`}
      </div>
    `;
  }

  private readonly _getEntityPickerItems = (): unknown[] =>
    this._pickerEntities().map((entity) => ({
      id: entity.entity_id,
      primary: entityLabel(entity),
      secondary: entity.entity_id,
    }));

  private readonly _getAdditionalEntityPickerItems = (search?: string): unknown[] => {
    if (!this.hass || !search?.trim()) return [];
    const lower = search.toLowerCase();
    const pinnedIds = new Set(this._pickerEntities().map((e) => e.entity_id));
    return Object.values(this.hass.states)
      .filter((e): e is HassEntity => e !== undefined)
      .filter((e) => !pinnedIds.has(e.entity_id))
      .filter((e) =>
        e.entity_id.toLowerCase().includes(lower) ||
        (typeof e.attributes.friendly_name === "string" &&
          e.attributes.friendly_name.toLowerCase().includes(lower))
      )
      .slice(0, 20)
      .map((e) => ({
        id: e.entity_id,
        primary: entityLabel(e),
        secondary: e.entity_id,
      }));
  };

  private _renderEntityPickerUI(): TemplateResult | typeof nothing {
    if (!this._resolved?.showEntityPicker || !this._entityComponentsReady) return nothing;

    return renderEntityPicker({
      hass: this.hass,
      menuOpen: this._attributeMenuOpen,
      entityPickerOpen: this._entityPickerOpen,
      selectedEntityId: this._selectedEntityId,
      path: this._path,
      selectedSources: this._selectedSources,
      resolved: this._resolved,
      getItems: this._getEntityPickerItems,
      getAdditionalItems: this._getAdditionalEntityPickerItems,
      onEntityPickerOpened: () => this._onEntityPickerOpened(),
      onEntityPickerClosed: () => this._onEntityPickerClosed(),
      onEntitySelected: (entityId) => this._onEntitySelected(entityId),
      onSourceAdded: (source) => this._addSource(source),
      onSourceRemoved: (sourceId) => this._removeSource(sourceId),
      onBreadcrumbClick: (path) => { this._path = path; },
      onCloseMenu: () => this._closeAttributeMenu(),
    });
  }

  render(): TemplateResult {
    const width = this._resolved?.width ?? "100%";

    return html`
      <div class="root" style="width:${width};">
        ${this.showControls
          ? html`<div class="controls-bar">
              ${this._renderDatePicker()}
              ${this._renderEntityPickerUI()}
            </div>`
          : nothing}
        <div class="chart-area">
          ${this._renderChartBody()}
        </div>
      </div>
    `;
  }

  private _toggleSeries(id: string): void {
    const nowHidden = !this._hiddenSeriesIds.includes(id);

    this._hiddenSeriesIds = nowHidden
      ? [...this._hiddenSeriesIds, id]
      : this._hiddenSeriesIds.filter((h) => h !== id);

    this.dispatchEvent(
      new CustomEvent("series-toggled", {
        detail: { id, hidden: nowHidden },
        bubbles: true,
        composed: true
      })
    );
  }

  private _renderDatePicker(): TemplateResult | typeof nothing {
    if (!this._resolved?.showDatePicker || !this._datePickerReady) return nothing;

    return renderDatePicker(
      this.hass,
      this._resolved.startDate,
      this._resolved.endDate,
      (startDate, endDate) => this._onDateRangeChanged(startDate, endDate)
    );
  }

  private _positionEntityMenu(): void {
    const trigger = this.renderRoot?.querySelector(".entity-trigger") as HTMLElement | null;
    const menu = this.renderRoot?.querySelector(".entity-menu") as HTMLElement | null;
    if (!trigger || !menu) return;

    menu.style.top = "0";
    menu.style.left = "0";
    menu.style.right = "";
    menu.style.width = "";
    // originRect: viewport position of the menu when CSS left=0,top=0.
    // Inside a CSS-transformed ancestor (e.g. HA dialog), fixed coordinates are
    // relative to that ancestor, not the viewport. We convert at the end:
    //   css_x = viewport_x - originRect.left
    const originRect = menu.getBoundingClientRect();

    const triggerRect = trigger.getBoundingClientRect();
    const hostRect = this.getBoundingClientRect();
    const margin = 8;

    const available = hostRect.bottom - margin - triggerRect.bottom - margin;
    menu.style.maxHeight = `${Math.min(Math.max(available, 120), 420)}px`;
    menu.style.top = `${triggerRect.bottom - originRect.top + 6}px`;

    // All boundary calculations stay in viewport coordinates.
    const leftBoundaryVp = hostRect.left + margin;
    const rightBoundaryVp = hostRect.right - margin;
    const availableWidth = rightBoundaryVp - leftBoundaryVp;
    const menuWidth = Math.min(420, availableWidth);
    menu.style.width = `${menuWidth}px`;

    let leftVp: number;
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      leftVp = triggerRect.left;
      leftVp = Math.min(leftVp, rightBoundaryVp - menuWidth);
      leftVp = Math.max(leftVp, leftBoundaryVp);
    } else {
      leftVp = leftBoundaryVp;
      menu.style.width = `${availableWidth}px`;
    }

    menu.style.left = `${leftVp - originRect.left}px`;
    menu.style.right = "";
  }

  private _closeAttributeMenu(): void {
    this._attributeMenuOpen = false;
    this._entityPickerOpen = false;
  }

  private _onEntitySelected(entityId: string): void {
    const knownIds = new Set(this._pickerEntities().map((e) => e.entity_id));
    if (!knownIds.has(entityId)) {
      this._customEntityIds = [...this._customEntityIds, entityId];
    }
    this._selectedEntityId = entityId;
    this._path = [];
    this._attributeMenuOpen = true;
  }

  private _onEntityPickerOpened(): void {
    this._entityPickerOpen = true;
    this._attributeMenuOpen = false;
  }

  private _onEntityPickerClosed(): void {
    this._entityPickerOpen = false;
  }

  private _handleDocumentClick = (event: Event): void => {
    if (!this._attributeMenuOpen || this._entityPickerOpen) return;
    const menu = this.renderRoot?.querySelector(".entity-menu");
    if (menu && event.composedPath().includes(menu as EventTarget)) return;
    this._closeAttributeMenu();
  };

  private _addSource(source: HistorySource): void {
    if (this._selectedSources.some((selected) => selected.id === source.id)) {
      return;
    }
    if (this._pendingAddedSources.some((selected) => selected.id === source.id)) {
      return;
    }
    if ((this._resolved?.series ?? []).some((s) => s.id === source.id)) {
      return;
    }

    this._pendingAddedSources = [...this._pendingAddedSources, source];
    this._attributeMenuOpen = window.matchMedia("(hover: hover) and (pointer: fine)").matches ? this._attributeMenuOpen : false;

    this.dispatchEvent(
      new CustomEvent("series-added", {
        detail: { source },
        bubbles: true,
        composed: true
      })
    );

    if (this._sourceAddBatchTimer !== undefined) {
      clearTimeout(this._sourceAddBatchTimer);
    }

    this._sourceAddBatchTimer = setTimeout(() => this._flushPendingAddedSources(), SOURCE_ADD_BATCH_MS);
  }

  private _flushPendingAddedSources(): void {
    this._sourceAddBatchTimer = undefined;
    if (this._pendingAddedSources.length === 0) return;

    const existing = new Set(this._selectedSources.map((source) => source.id));
    const added = this._pendingAddedSources.filter((source) => !existing.has(source.id));

    this._pendingAddedSources = [];

    if (added.length === 0) return;

    this._selectedSources = [...this._selectedSources, ...added];
    void this.requestUpdate();
  }

  private _removeSource(sourceId: string): void {
    const source = this._selectedSources.find((s) => s.id === sourceId);
    this._pendingAddedSources = this._pendingAddedSources.filter((s) => s.id !== sourceId);

    if (!source || this._isDefaultSource(source)) {
      return;
    }

    this._selectedSources = this._selectedSources.filter((s) => s.id !== sourceId);
    this._hiddenSeriesIds = this._hiddenSeriesIds.filter((hs) => hs !== sourceId);

    this.dispatchEvent(
      new CustomEvent("series-removed", {
        detail: { sourceId },
        bubbles: true,
        composed: true
      })
    );

    void this.requestUpdate();
  }
}

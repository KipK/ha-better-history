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
  X_AXIS_LABEL_SPACE,
  type ChartRenderData,
  type GraphGroup,
  type RenderableSeries
} from "./render/chart.js";
import { GRAPH_TOP, GRAPH_HEIGHT } from "./render/scales.js";
import { paletteColor, CLIMATE_ATTR_COLORS } from "./render/colors.js";
import { chartStyles } from "./styles/chart.css.js";
import type { AttributeUnitMap, BetterHistoryConfig, BetterHistoryLineMode, ResolvedConfig, ResolvedSeries } from "./types/config.js";
import { attributeSource, type HistorySeries, type HistorySource } from "./data/history.js";
import { isAttributeTemperatureUnit, unitForAttributePath } from "./data/attribute-units.js";
import type { HassEntity, HomeAssistant } from "./types/ha.js";
import { preloadDatePicker, renderDatePicker, datePickerAvailable } from "./ui/date-picker.js";
import {
  preloadEntityPickerComponents,
  entityPickerAvailable,
  entityPickerItems,
  filterEntityPickerItems,
  renderEntityPicker
} from "./ui/entity-picker.js";
import { ensureHaComponents } from "./load-ha-components.js";
import { logPerformance, performanceNow } from "./utils/performance.js";

const TEMPERATURE_UNIT_RE = /°[CF]|[CFK]$/;
const SOURCE_ADD_BATCH_MS = 60;
const LIVE_NOW_UPDATE_MS = 1000;
const MIN_VIEW_RANGE_GAP_PX = 24;
const MIN_VIEW_RANGE_FALLBACK_TRACK_PX = 720;
const MIN_GRAPH_HEIGHT = 48;
const MAX_GRAPH_HEIGHT_TO_PLOT_WIDTH = 0.34;
const MAX_GRAPH_HEIGHT_TO_SURFACE = 0.72;
const MAX_GRAPH_HEIGHT_ABSOLUTE = 720;
const CHART_SURFACE_SIZE_TOLERANCE = 2;
const CLIMATE_LINE_ATTRIBUTES = ["current_temperature", "temperature", "hvac_action"];
const CLIMATE_TEMPERATURE_ATTRIBUTES = new Set(["current_temperature", "temperature"]);
const AXIS_LABEL_GAP_PX = 5;
const BROWSER_HISTORY_STATE_KEY = "haBetterHistory";

type BrowserHistoryLayer = "date-picker" | "entity-picker" | "attribute-picker";

interface BrowserHistoryEntry {
  instanceId: string;
  layer: BrowserHistoryLayer;
}

function axisLabelWidthPx(value: string): number {
  let width = 0;

  for (const char of value) {
    if (char >= "0" && char <= "9") width += 6.2;
    else if (char === "." || char === ",") width += 3.2;
    else if (char === "-") width += 4;
    else width += 6.2;
  }

  return Math.ceil(width);
}

function axisGutter(labels: Array<{ value: string }>): string {
  const width = Math.max(0, ...labels.map((label) => axisLabelWidthPx(label.value)));
  return width > 0 ? `${width + AXIS_LABEL_GAP_PX}px` : "0px";
}

function isTemperatureUnit(unit: string): boolean {
  return TEMPERATURE_UNIT_RE.test(unit);
}

interface ChartRenderCache {
  seriesRef: HistorySeries[];
  sourceKey: string;
  hiddenKey: string;
  startTime: number;
  endTime: number;
  extendStairToEnd: boolean;
  containerWidth: number;
  data: ChartRenderData;
}

interface GraphGroupRenderCache {
  dataRef: ChartRenderData;
  maxXTicks: number;
  graphHeight: number;
  groups: GraphGroup[];
}

interface ImportedSeriesMeta {
  color?: string;
  lineMode?: BetterHistoryLineMode;
}

interface BetterHistorySeriesExportV1 {
  format: "ha-better-history-series-v1";
  loadedRange?: {
    start?: string;
    end?: string;
  };
  viewRange?: {
    start?: string;
    end?: string;
  };
  series?: unknown[];
}

export class HaBetterHistory extends LitElement {
  static styles = chartStyles;

  @property({ attribute: false }) hass?: HomeAssistant;
  @property({ attribute: false }) config?: BetterHistoryConfig;
  @property({ attribute: false }) entities?: string[];
  @property({ attribute: false }) attributeUnits?: AttributeUnitMap;
  @property({ type: Number }) hours = 24;
  @property({ attribute: false }) startDate?: Date;
  @property({ attribute: false }) endDate?: Date;
  @property({ type: Boolean, attribute: "show-date-picker" }) showDatePicker = false;
  @property({ type: Boolean, attribute: "show-entity-picker" }) showEntityPicker = false;
  @property({ type: Boolean, attribute: "show-import-button" }) showImportButton = false;
  @property({ type: Boolean, attribute: "show-export-button" }) showExportButton = true;
  @property({ type: Boolean, attribute: "show-time-range-selector" }) showTimeRangeSelector = true;
  @property({ type: Boolean, attribute: "show-line-mode-buttons" }) showLineModeButtons = true;
  @property({ type: Boolean, attribute: "show-legend" }) showLegend = true;
  @property({ type: Boolean, attribute: "show-tooltip" }) showTooltip = true;
  @property({ type: Boolean, attribute: "show-grid" }) showGrid = true;
  @property({ type: Boolean, attribute: "show-scale" }) showScale = true;
  @property({ type: Boolean, attribute: "show-controls" }) showControls = true;
  @property() width?: string;
  @property() height?: string;
  @property({ attribute: "line-mode" }) lineMode?: BetterHistoryLineMode;
  @property({ attribute: "line-width" }) lineWidth?: string;
  @property({ attribute: "background-color" }) backgroundColor?: string;
  @property({ attribute: "graph-title" }) graphTitle?: string;
  @property({ attribute: "title-font-family" }) titleFontFamily?: string;
  @property({ attribute: "title-font-size" }) titleFontSize?: string;
  @property({ attribute: "title-color" }) titleColor?: string;
  @property() language?: string;
  @property({ type: Boolean, attribute: "debug-performance" }) debugPerformance = false;
  @property({ type: Boolean, attribute: "tools-open" }) toolsOpen = false;

  @state() private _resolved?: ResolvedConfig;
  @state() private _hiddenSeriesIds: string[] = [];
  @state() private _rangeStart?: Date;
  @state() private _rangeEnd?: Date;
  @state() private _viewStart?: Date;
  @state() private _viewEnd?: Date;
  @state() private _liveNow = Date.now();
  @state() private _datePickerReady = false;
  @state() private _entityComponentsReady = false;
  @state() private _runtimeLineMode?: BetterHistoryLineMode;

  @state() private _attributeMenuOpen = false;
  @state() private _attributeSearch = "";
  @state() private _selectedEntityId?: string;
  @state() private _path: string[] = [];
  @state() private _selectedSources: HistorySource[] = [];
  @state() private _removedConfigSourceIds: string[] = [];
  @state() private _customEntityIds: string[] = [];
  @state() private _entityPickerOpen = false;
  @state() private _datePickerOpen = false;
  @state() private _draggingSourceId?: string;

  private readonly _data = new DataController(this);
  private readonly _tooltip = new TooltipController(this);
  private readonly _browserHistoryInstanceId = `hbh-${Math.random().toString(36).slice(2)}`;
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
  private _liveNowTimer?: ReturnType<typeof setInterval>;
  private _dragStartSourceIds?: string[];
  private _dragDropCommitted = false;
  private _lastPickerOverlayOpen = false;
  private _lastPointerDownInside = false;
  private _syncingBrowserHistory = false;
  private _selectingEntityForAttributeMenu = false;
  private _importedSeriesMeta = new Map<string, ImportedSeriesMeta>();
  @state() private _importedDataActive = false;

  @state() private _containerWidth = 0;
  @state() private _chartSurfaceHeight = 0;
  @state() private _chartSurfaceConstrained = false;
  private _resizeObserver?: ResizeObserver;
  private _observedChartSurface?: Element;

  connectedCallback(): void {
    super.connectedCallback();
    ensureHaComponents();
    document.addEventListener("pointerdown", this._handleDocumentPointerDown, true);
    document.addEventListener("click", this._handleDocumentClick, true);
    window.addEventListener("popstate", this._handleBrowserPopState);
    this._resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === this) {
          const width = Math.round(entry.contentRect.width);
          if (width !== this._containerWidth) {
            this._containerWidth = width;
          }
        } else if (entry.target === this._observedChartSurface) {
          this._syncChartSurfaceSize(entry.contentRect.height);
        }
      }
    });
    this._resizeObserver.observe(this);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("pointerdown", this._handleDocumentPointerDown, true);
    document.removeEventListener("click", this._handleDocumentClick, true);
    window.removeEventListener("popstate", this._handleBrowserPopState);
    this._resizeObserver?.disconnect();
    this._resizeObserver = undefined;
    if (this._sourceAddBatchTimer !== undefined) {
      clearTimeout(this._sourceAddBatchTimer);
      this._sourceAddBatchTimer = undefined;
    }
    this._stopLiveClock();
  }

  private _maxXTicks(): number {
    if (this._containerWidth <= 0) return 12;
    const widthBased = Math.max(3, Math.floor(this._containerWidth * PLOT_WIDTH / (CHART_WIDTH * 50)));
    if (this._chartSurfaceHeight > 0 && this._chartSurfaceHeight < 120) {
      return Math.max(3, Math.min(widthBased, Math.floor(this._chartSurfaceHeight / 24)));
    }
    return widthBased;
  }

  private _observeChartSurface(): void {
    const surface = this.renderRoot.querySelector(".chart-surface");
    if (surface === this._observedChartSurface) return;

    if (this._observedChartSurface) {
      this._resizeObserver?.unobserve(this._observedChartSurface);
    }

    this._observedChartSurface = surface ?? undefined;

    if (surface) {
      this._resizeObserver?.observe(surface);
      this._syncChartSurfaceSize(surface.getBoundingClientRect().height);
    } else if (this._chartSurfaceHeight !== 0) {
      this._chartSurfaceHeight = 0;
      this._chartSurfaceConstrained = false;
    }
  }

  private _syncChartSurfaceSize(rawHeight: number): void {
    const height = Math.round(rawHeight);
    const surface = this._observedChartSurface;
    const graphs = surface?.querySelector<HTMLElement>(".chart-graphs");
    const contentHeight = graphs ? Math.round(graphs.offsetHeight) : 0;
    const contentDiffersFromSurface =
      contentHeight < height - CHART_SURFACE_SIZE_TOLERANCE ||
      height < contentHeight - CHART_SURFACE_SIZE_TOLERANCE;
    const surfaceShrank = height < this._chartSurfaceHeight - CHART_SURFACE_SIZE_TOLERANCE;
    const adaptiveGraphHeight = this._graphGroupRenderCache?.graphHeight ?? GRAPH_HEIGHT;
    const keepAdaptiveConstraint = this._chartSurfaceConstrained && adaptiveGraphHeight !== GRAPH_HEIGHT;
    const constrained = contentDiffersFromSurface || surfaceShrank || keepAdaptiveConstraint;

    if (constrained) {
      if (this._chartSurfaceHeight !== height) this._chartSurfaceHeight = height;
      if (!this._chartSurfaceConstrained) this._chartSurfaceConstrained = true;
      return;
    }

    if (this._chartSurfaceHeight !== 0) this._chartSurfaceHeight = 0;
    if (this._chartSurfaceConstrained) this._chartSurfaceConstrained = false;
  }

  private _effectiveStartDate(): Date {
    return this._rangeStart ?? this.startDate ?? this.config?.startDate ?? new Date(Date.now() - (this.config?.hours ?? this.hours ?? 24) * 3600000);
  }

  private _effectiveEndDate(): Date {
    const requestedEnd = this._requestedEndDate();
    const liveNow = this._liveNow || Date.now();

    return requestedEnd.getTime() > liveNow ? new Date(liveNow) : requestedEnd;
  }

  private _requestedEndDate(): Date {
    return this._rangeEnd ?? this.endDate ?? this.config?.endDate ?? new Date();
  }

  private _rangeExtendsFuture(): boolean {
    return this._requestedEndDate().getTime() > Date.now();
  }

  private _syncLiveClock(): void {
    if (!this._rangeExtendsFuture()) {
      this._stopLiveClock();
      return;
    }

    if (this._liveNowTimer !== undefined) return;

    const now = Date.now();
    if (this._viewEnd) {
      this._viewEnd = new Date(now);
    }
    this._liveNow = now;
    this._liveNowTimer = setInterval(() => {
      if (!this._rangeExtendsFuture()) {
        this._stopLiveClock();
        return;
      }

      const previousLiveEnd = this._effectiveEndDate().getTime();
      const pinnedToLiveEnd = !this._viewEnd || Math.abs(this._viewEnd.getTime() - previousLiveEnd) <= LIVE_NOW_UPDATE_MS * 2;
      const nextNow = Date.now();

      this._liveNow = nextNow;
      if (pinnedToLiveEnd) {
        this._viewEnd = new Date(nextNow);
      }
    }, LIVE_NOW_UPDATE_MS);
  }

  private _stopLiveClock(): void {
    if (this._liveNowTimer === undefined) return;

    clearInterval(this._liveNowTimer);
    this._liveNowTimer = undefined;
  }

  private _browserHistoryEntry(state = window.history.state): BrowserHistoryEntry | undefined {
    const entry = typeof state === "object" && state !== null
      ? (state as Record<string, unknown>)[BROWSER_HISTORY_STATE_KEY]
      : undefined;

    if (typeof entry !== "object" || entry === null) return undefined;

    const record = entry as Partial<BrowserHistoryEntry>;
    if (record.instanceId !== this._browserHistoryInstanceId) return undefined;
    if (record.layer !== "date-picker" && record.layer !== "entity-picker" && record.layer !== "attribute-picker") {
      return undefined;
    }

    return { instanceId: record.instanceId, layer: record.layer };
  }

  private _browserHistoryState(layer: BrowserHistoryLayer): Record<string, unknown> {
    const current = typeof window.history.state === "object" && window.history.state !== null
      ? window.history.state as Record<string, unknown>
      : {};

    return {
      ...current,
      [BROWSER_HISTORY_STATE_KEY]: {
        instanceId: this._browserHistoryInstanceId,
        layer
      }
    };
  }

  private _pushBrowserHistoryLayer(layer: BrowserHistoryLayer): void {
    if (this._syncingBrowserHistory) return;
    if (this._browserHistoryEntry()?.layer === layer) return;

    window.history.pushState(this._browserHistoryState(layer), "", window.location.href);
  }

  private _replaceBrowserHistoryLayer(layer: BrowserHistoryLayer): void {
    if (this._syncingBrowserHistory) return;

    window.history.replaceState(this._browserHistoryState(layer), "", window.location.href);
  }

  private _closeBrowserHistoryLayer(layer: BrowserHistoryLayer, close: () => void): void {
    if (!this._syncingBrowserHistory && this._browserHistoryEntry()?.layer === layer) {
      window.history.back();
      return;
    }

    close();
  }

  private readonly _handleBrowserPopState = (event: PopStateEvent): void => {
    const entry = this._browserHistoryEntry(event.state);

    this._syncingBrowserHistory = true;
    try {
      if (!entry) {
        this._closeBrowserHistoryOverlays();
        return;
      }

      this._openBrowserHistoryLayer(entry.layer);
    } finally {
      this._syncingBrowserHistory = false;
    }
  };

  private _openBrowserHistoryLayer(layer: BrowserHistoryLayer): void {
    this._datePickerOpen = layer === "date-picker";
    this._entityPickerOpen = layer === "entity-picker";
    this._attributeMenuOpen = layer === "attribute-picker";

    if (layer !== "attribute-picker") {
      this._attributeSearch = "";
    }
  }

  private _closeBrowserHistoryOverlays(): void {
    if (this._datePickerOpen) {
      this._closeDatePickerOverlay();
    }
    if (this._attributeMenuOpen || this._entityPickerOpen) {
      this._closePickerOverlay();
    }
  }

  private _closePickerOverlay(): void {
    this._attributeMenuOpen = false;
    this._entityPickerOpen = false;
    this._attributeSearch = "";
  }

  private _closeDatePickerOverlay(): void {
    this._datePickerOpen = false;

    const picker = this.renderRoot.querySelector("ha-date-range-picker") as HTMLElement | null;
    picker?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
    picker?.blur();

    const root = this.getRootNode();
    const active = root instanceof Document || root instanceof ShadowRoot
      ? root.activeElement
      : undefined;
    if (active instanceof HTMLElement) active.blur();
  }

  private _effectiveLineMode(): BetterHistoryLineMode | undefined {
    return this._runtimeLineMode ?? this.config?.lineMode ?? this.lineMode;
  }

  private _effectiveViewRange(): { start: Date; end: Date } {
    const loadedStart = this._resolved?.startDate ?? this._effectiveStartDate();
    const loadedEnd = this._rangeExtendsFuture()
      ? this._effectiveEndDate()
      : this._resolved?.endDate ?? this._effectiveEndDate();
    const start = this._viewStart && this._viewStart.getTime() >= loadedStart.getTime()
      ? this._viewStart
      : loadedStart;
    const end = this._viewEnd && this._viewEnd.getTime() <= loadedEnd.getTime()
      ? this._viewEnd
      : loadedEnd;

    if (end.getTime() <= start.getTime()) {
      return { start: loadedStart, end: loadedEnd };
    }

    const minSpan = this._minViewSpanMs();
    if (end.getTime() - start.getTime() >= minSpan) {
      return { start, end };
    }

    const loadedStartMs = loadedStart.getTime();
    const loadedEndMs = loadedEnd.getTime();
    const normalizedStart = Math.min(Math.max(start.getTime(), loadedStartMs), loadedEndMs - minSpan);

    return { start: new Date(normalizedStart), end: new Date(normalizedStart + minSpan) };
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

    if (this._resolved && !this._importedDataActive) {
      for (const s of this._activeResolvedSeries()) {
        if (!seen.has(s.id)) {
          seen.add(s.id);
          sources.push(resolvedSeriesToSource(s));
        }
      }
    }

    for (const s of this._selectedSources) {
      for (const source of this._expandedSelectedSources(s)) {
        if (!seen.has(source.id)) {
          seen.add(source.id);
          sources.push(source);
        }
      }
    }

    return sources;
  }

  private _isDefaultSource(source: HistorySource): boolean {
    return this._activeResolvedSeries().some((s) => s.id === source.id && s.forced !== false);
  }

  private _activeResolvedSeries(): ResolvedSeries[] {
    if (!this._resolved) return [];
    return this._resolved.series.filter((s) => !this._removedConfigSourceIds.includes(s.id));
  }

  private _activeResolvedConfig(): ResolvedConfig | undefined {
    if (!this._resolved) return undefined;
    return { ...this._resolved, series: this._activeResolvedSeries() };
  }

  private _reconcileRemovedConfigSourceIds(resolved: ResolvedConfig): void {
    if (this._removedConfigSourceIds.length === 0) return;

    const removableIds = new Set(
      resolved.series.filter((series) => series.forced === false).map((series) => series.id)
    );
    const next = this._removedConfigSourceIds.filter((id) => removableIds.has(id));

    if (next.length !== this._removedConfigSourceIds.length) {
      this._removedConfigSourceIds = next;
    }
  }

  private _resolvedTemperatureUnit(): string | undefined {
    return this._resolved?.series.find(
      (s) => s.scaleGroupKey === "group:temperature" && s.unit && isTemperatureUnit(s.unit)
    )?.unit;
  }

  private _lastFetchKey = "";
  private _lastFetchSources: HistorySource[] = [];
  private _lastHassResolveTime = 0;

  protected willUpdate(changed: PropertyValues): void {
    this._data.debugPerformance = this.debugPerformance || this.config?.debugPerformance === true;

    const startTime = this._effectiveStartDate().getTime();
    const endTime = this._effectiveEndDate().getTime();
    const futureRange = this._rangeExtendsFuture();

    this._syncLiveClock();

    if (changed.has("hass") && futureRange) {
      this._data.updateLivePoints(this.hass, this._lastFetchSources, new Date(startTime), new Date(endTime));
    }

    const timeChanged = startTime !== this._prevStartTime || endTime !== this._prevEndTime;
    const containerChanged = this._containerWidth !== this._prevContainerWidth;
    const explicitRangeChanged = changed.has("_rangeStart")
      || changed.has("_rangeEnd")
      || changed.has("startDate")
      || changed.has("endDate")
      || changed.has("config")
      || changed.has("hours");
    const liveRangeTick = futureRange && timeChanged && !containerChanged && !explicitRangeChanged;

    if (timeChanged || containerChanged) {
      if (!liveRangeTick) {
        this._prevClipX.clear();
      }
      this._prevStartTime = startTime;
      this._prevEndTime = endTime;
      this._prevContainerWidth = this._containerWidth;
    }

    if (this._data.loading && this._data.series.length === 0) {
      this._prevClipX.clear();
    }

    const watch = ["_rangeStart", "_rangeEnd", "_selectedSources", "_removedConfigSourceIds", "hass", "config", "entities", "hours", "startDate", "endDate", "showDatePicker", "showEntityPicker", "showLegend", "showTooltip", "showGrid", "showScale", "width", "height", "lineMode", "lineWidth", "backgroundColor", "graphTitle", "titleFontFamily", "titleFontSize", "titleColor", "language", "debugPerformance", "attributeUnits", "_runtimeLineMode"];

    if (watch.some((p) => changed.has(p))) {
      const hassOnly = !watch.some((p) => p !== "hass" && changed.has(p));
      const externalDataChanged = changed.has("config") || changed.has("entities");

      if (externalDataChanged) {
        this._importedDataActive = false;
        this._importedSeriesMeta.clear();
      }

      if (hassOnly) {
        const now = Date.now();
        const rounded = Math.floor(now / 1000) * 1000;
        if (futureRange && this._lastFetchKey) {
          this._lastHassResolveTime = rounded;
          return;
        }
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
        showGrid: this.showGrid,
        showScale: this.showScale,
        width: this.width,
        height: this.height,
        lineMode: this._effectiveLineMode(),
        lineWidth: this.lineWidth,
        backgroundColor: this.backgroundColor,
        title: this.graphTitle,
        titleFontFamily: this.titleFontFamily,
        titleFontSize: this.titleFontSize,
        titleColor: this.titleColor,
        language: this.language,
        hass: this.hass,
        attributeUnits: this.attributeUnits
      });

      this._reconcileRemovedConfigSourceIds(resolved);
      this._resolved = resolved;

      if (!this._rangeStart && !this._rangeEnd) {
        this._rangeStart = resolved.startDate;
        this._rangeEnd = resolved.endDate;
      }

      if (!this._viewStart && !this._viewEnd) {
        this._viewStart = resolved.startDate;
        this._viewEnd = resolved.endDate;
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
    this._observeChartSurface();
    if (changed.has("_attributeMenuOpen") && this._attributeMenuOpen) {
      this._positionEntityMenu();
    }
    if (changed.has("_attributeMenuOpen") || changed.has("_entityPickerOpen") || changed.has("_datePickerOpen")) {
      this._emitPickerOverlayState();
    }
    this._animateClipPaths();
    this._wasLoading = this._data.loading;
  }

  private _emitPickerOverlayState(): void {
    const open = this._datePickerOpen || this._attributeMenuOpen || this._entityPickerOpen;
    if (open === this._lastPickerOverlayOpen) return;

    this._lastPickerOverlayOpen = open;
    this.dispatchEvent(
      new CustomEvent("picker-overlay-changed", {
        detail: { open },
        bubbles: true,
        composed: true
      })
    );
  }

  private _onDateRangeChanged(startDate: Date, endDate: Date): void {
    this._rangeStart = startDate;
    this._rangeEnd = endDate;
    this._viewStart = startDate;
    this._viewEnd = endDate;

    this.dispatchEvent(
      new CustomEvent("range-changed", {
        detail: { startDate, endDate },
        bubbles: true,
        composed: true
      })
    );

    void this.requestUpdate();
  }

  private _onDatePickerOpened(): void {
    if (this._datePickerOpen) return;

    this._datePickerOpen = true;
    this._pushBrowserHistoryLayer("date-picker");
  }

  private _onDatePickerClosed(): void {
    this._closeBrowserHistoryLayer("date-picker", () => this._closeDatePickerOverlay());
  }

  private _pickScaleGroup(source: HistorySource, existing: RenderableSeries[]): string {
    if (source.valueType !== "number") return `series:${source.id}`;
    const climateTemperatureAttribute = source.entityId.startsWith("climate.")
      && source.path?.length === 1
      && CLIMATE_TEMPERATURE_ATTRIBUTES.has(source.path[0]);

    if (source.unit) {
      const existingMatch = existing.find(
        (s) => s.unit === source.unit && s.valueType === "number"
      );
      if (existingMatch) return existingMatch.scaleGroupKey;

      const match = this._resolved?.series.find(
        (s) => s.unit === source.unit && s.valueType === "number"
      );
      if (match) return match.scaleGroupKey;

      const tempGroup = this._resolved?.series.find(
        (s) => s.scaleGroupKey === "group:temperature"
      );
      if (tempGroup && isTemperatureUnit(source.unit)) return tempGroup.scaleGroupKey;
    }

    if (climateTemperatureAttribute) {
      const existingTemperatureGroup = existing.find(
        (s) => s.valueType === "number" && s.unit !== undefined && isTemperatureUnit(s.unit)
      );
      if (existingTemperatureGroup) return existingTemperatureGroup.scaleGroupKey;

      return "group:temperature";
    }

    return source.unit ? `unit:${source.unit}` : `series:${source.id}`;
  }

  private _defaultLineMode(): BetterHistoryLineMode {
    const mode = this._effectiveLineMode();

    return mode === "line" || mode === "column" ? mode : "stair";
  }

  private _defaultLineWidth(): string {
    const lineWidth = this.config?.lineWidth ?? this.lineWidth;

    if (typeof lineWidth === "number") {
      return Number.isFinite(lineWidth) && lineWidth >= 0 ? String(lineWidth) : "2.5";
    }

    if (typeof lineWidth === "string" && lineWidth.trim() !== "") {
      return lineWidth.trim();
    }

    return "2.5";
  }

  private _showImportButton(): boolean {
    return this.showImportButton || this.config?.showImportButton === true;
  }

  private _showExportButton(): boolean {
    return this.config?.showExportButton !== false && this.showExportButton;
  }

  private _showTimeRangeSelector(): boolean {
    return this.config?.showTimeRangeSelector !== false && this.showTimeRangeSelector;
  }

  private _allSeriesHaveExplicitLineMode(): boolean {
    // Picker-added sources always follow the global/runtime mode — buttons are always relevant.
    if (this._selectedSources.length > 0) return false;
    // A global lineMode covers every series that has no per-series override.
    if (this.config?.lineMode != null) return true;
    // Mirror resolveConfig: config.series takes precedence over defaultEntities when non-empty.
    const series = this.config?.series;
    if (series && series.length > 0) {
      return series.every((s) => s.lineMode != null);
    }
    // No config series — defaultEntities or prop entities are used, no per-series lineMode possible.
    return false;
  }

  private _showLineModeButtons(): boolean {
    if (this._allSeriesHaveExplicitLineMode()) return false;
    return this.config?.showLineModeButtons !== false && this.showLineModeButtons;
  }

  private _hasForcedConfigSeries(): boolean {
    return this._activeResolvedSeries().some((series) => series.forced !== false);
  }

  private _buildRenderSeries(): RenderableSeries[] {
    if (!this._resolved && !this._importedDataActive) return [];

    const result: RenderableSeries[] = this._importedDataActive ? [] : this._activeResolvedSeries().flatMap((resolved) => {
      const fetched = this._data.series.find((s) => s.source.id === resolved.id);

      return [
        {
          id: resolved.id,
          label: resolved.label,
          color: resolved.color,
          unit: resolved.unit,
          scaleGroupKey: resolved.scaleGroupKey,
          scaleMode: resolved.scaleMode,
          scaleMin: resolved.scaleMin,
          scaleMax: resolved.scaleMax,
          lineMode: this._runtimeLineMode ?? resolved.lineMode,
          lineWidth: resolved.lineWidth,
          valueType: resolved.valueType,
          points: fetched?.points ?? []
        }
      ];
    });

    for (const selectedSource of this._selectedSources) {
      for (const source of this._expandedSelectedSources(selectedSource)) {
        if (result.some((s) => s.id === source.id)) continue;

        const fetched = this._data.series.find((s) => s.source.id === source.id);
        if (!fetched) continue;

        const colorIndex = result.length;
        const scaleGroupKey = this._pickScaleGroup(source, result);
        const climateAttr = source.entityId.startsWith("climate.") && source.path?.length === 1 ? source.path[0] : undefined;

        result.push({
          id: source.id,
          label: source.label,
          color: this._importedSeriesMeta.get(source.id)?.color ?? (climateAttr ? CLIMATE_ATTR_COLORS[climateAttr] : undefined) ?? paletteColor(colorIndex),
          unit: source.unit,
          scaleGroupKey,
          scaleMode: "auto",
          lineMode: this._runtimeLineMode ?? this._importedSeriesMeta.get(source.id)?.lineMode ?? this._defaultLineMode(),
          lineWidth: this._defaultLineWidth(),
          valueType: source.valueType,
          points: fetched?.points ?? []
        });
      }
    }

    return result;
  }

  private _chartSourceKey(): string {
    return [
      ...((this._importedDataActive ? [] : this._activeResolvedSeries()).map((source) => [
        source.id,
        source.label,
        source.color,
        source.unit ?? "",
        source.scaleGroupKey,
        source.scaleMode,
        source.scaleMin ?? "",
        source.scaleMax ?? "",
        source.lineMode,
        source.lineWidth,
        source.valueType
      ].join("~")) ?? []),
      ...this._selectedSources.flatMap((source) => this._expandedSelectedSources(source)).map((effectiveSource) => {
        return [
          effectiveSource.id,
          effectiveSource.label,
          effectiveSource.kind,
          effectiveSource.unit ?? "",
          effectiveSource.valueType,
          this._defaultLineMode(),
          this._defaultLineWidth()
        ].join("~");
      })
    ].join("|");
  }

  private _chartData(): ChartRenderData {
    const hiddenKey = this._hiddenSeriesIds.join("|");
    const sourceKey = this._chartSourceKey();
    const cache = this._chartRenderCache;
    const viewRange = this._effectiveViewRange();
    const startTime = viewRange.start.getTime();
    const endTime = viewRange.end.getTime();
    const containerWidth = this._containerWidth;
    const extendStairToEnd = !this._data.loading;

    if (
      cache &&
      cache.seriesRef === this._data.series &&
      cache.sourceKey === sourceKey &&
      cache.hiddenKey === hiddenKey &&
      cache.startTime === startTime &&
      cache.endTime === endTime &&
      cache.extendStairToEnd === extendStairToEnd &&
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
    const data = buildChartData(
      all,
      visible,
      timeBounds,
      this._resolved?.disableClimateOverlay ?? false,
      maxXTicks,
      extendStairToEnd
    );
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

    this._chartRenderCache = { seriesRef: this._data.series, sourceKey, hiddenKey, startTime, endTime, extendStairToEnd, containerWidth, data };

    return data;
  }

  private _graphGroups(data: ChartRenderData): GraphGroup[] {
    const maxXTicks = this._maxXTicks();
    const graphHeight = this._graphHeightFor(data);
    const cache = this._graphGroupRenderCache;

    if (
      cache &&
      cache.dataRef === data &&
      cache.maxXTicks === maxXTicks &&
      cache.graphHeight === graphHeight
    ) {
      return cache.groups;
    }

    const groups = buildGraphGroups(data, maxXTicks, graphHeight);
    this._graphGroupRenderCache = { dataRef: data, maxXTicks, graphHeight, groups };

    return groups;
  }

  private _graphHeightFor(data: ChartRenderData): number {
    if (!this._chartSurfaceConstrained || this._chartSurfaceHeight <= 0) return GRAPH_HEIGHT;

    const graphCount = Math.max(
      new Set(data.numericScales.map((scale) => scale.graphKey)).size,
      data.allSeries.some((s) => s.valueType !== "number" && s.valueType !== "boolean") ? 1 : 0,
      1
    );
    const segmentCount = data.allSeries.filter((s) => s.valueType !== "number" && s.valueType !== "boolean").length;
    const staticCanvasHeight = graphCount * (GRAPH_TOP + 18 + 16) + (segmentCount > 0 ? 10 + segmentCount * SEGMENT_ROW_HEIGHT : 0);
    const availableForGraphs = this._chartSurfaceHeight - staticCanvasHeight;
    const plotWidth = this._containerWidth > 0
      ? this._containerWidth * PLOT_WIDTH / CHART_WIDTH
      : PLOT_WIDTH;
    const maxHeight = Math.max(
      GRAPH_HEIGHT,
      Math.min(
        Math.floor(plotWidth * MAX_GRAPH_HEIGHT_TO_PLOT_WIDTH),
        Math.floor((this._chartSurfaceHeight / graphCount) * MAX_GRAPH_HEIGHT_TO_SURFACE),
        MAX_GRAPH_HEIGHT_ABSOLUTE
      )
    );
    const constrainedHeight = Math.floor(Math.max(0, availableForGraphs) / graphCount);
    const height = Math.min(constrainedHeight, maxHeight);

    return Math.max(MIN_GRAPH_HEIGHT, height);
  }

  private _renderGraphGroup(group: GraphGroup): TemplateResult {
    const showLegend = this._resolved?.showLegend ?? true;
    const showGrid = this._resolved?.showGrid ?? true;
    const showScale = this._resolved?.showScale ?? true;
    const seriesIds = group.series.map((series) => series.id).join("|");
    const leftGutter = showScale ? axisGutter(group.yLabels) : "0px";
    const rightGutter = showScale ? axisGutter(group.rightYLabels) : "0px";
    const plotBottom = GRAPH_TOP + group.graphHeight;
    const xLabelTop = plotBottom + 3;
    const segmentStartY = plotBottom + X_AXIS_LABEL_SPACE + 6;

    return html`
      <div class="graph-section">
        <div class="graph-row" style=${`--axis-label-gap:${AXIS_LABEL_GAP_PX}px;--axis-left-gutter:${leftGutter};--axis-right-gutter:${rightGutter};`}>
          <div class="axis-labels axis-labels--left" style="height:${group.canvasHeight}px">
            ${showScale
              ? group.yLabels.map(
                  (label) => html`<span class="y-axis-label y-axis-label--left" style="top:${label.y.toFixed(1)}px;">${label.value}</span>`
                )
              : nothing}
          </div>
          <div class="graph-canvas" data-series-ids=${seriesIds} style="height:${group.canvasHeight}px">
            <svg
              viewBox="${PLOT_LEFT} 0 ${PLOT_WIDTH} ${group.svgHeight}"
              height="${group.svgHeight}"
              preserveAspectRatio="none"
            >
              ${showGrid
                ? group.xLabels.map(
                    (label) => svg`
                      <line class="grid-line grid-line--vertical" x1=${label.x.toFixed(1)} y1=${PLOT_TOP} x2=${label.x.toFixed(1)} y2=${plotBottom}></line>
                    `
                  )
                : nothing}
              ${showGrid
                ? group.yLabels.map(
                    (label) => svg`
                      <line class="grid-line grid-line--horizontal" x1=${PLOT_LEFT} y1=${label.y.toFixed(1)} x2=${PLOT_RIGHT} y2=${label.y.toFixed(1)}></line>
                    `
                  )
                : nothing}
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
              ${group.columns.map(
                (col) => svg`<rect class="column" x=${col.x.toFixed(1)} y=${col.y.toFixed(1)} width=${col.width.toFixed(1)} height=${col.height.toFixed(1)} fill=${col.fill}></rect>`
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

                  return svg`<polyline class="line" style=${`--better-history-line-width:${line.lineWidth};`} clip-path="url(#${clipId})" data-line-id=${line.id} data-animate-clip=${needAnim ? "true" : nothing} data-target-x=${targetX} points=${line.points} stroke=${line.color}></polyline>`;
                }
              )}
              ${group.segments.map(
                (seg) => svg`<rect class="segment" x=${seg.x} y=${seg.y} width=${seg.width} height="9" fill=${seg.fill}></rect>`
              )}
              ${group.series
                .filter((s) => s.valueType !== "number" && s.valueType !== "boolean")
                .map((s, ni) => {
                  const y = segmentStartY + ni * SEGMENT_ROW_HEIGHT;
                  return svg`<rect class="segment-border" x=${PLOT_LEFT} y=${y} width=${PLOT_WIDTH} height="9" fill="none" stroke=${s.color}></rect>`;
                })}
              ${showScale
                ? svg`<line class="axis" x1=${PLOT_LEFT} y1=${PLOT_TOP} x2=${PLOT_LEFT} y2=${plotBottom}></line>`
                : nothing}
              ${showScale && group.rightYLabels.length > 0
                ? svg`<line class="axis" x1=${PLOT_RIGHT} y1=${PLOT_TOP} x2=${PLOT_RIGHT} y2=${plotBottom}></line>`
                : nothing}
              ${showScale
                ? svg`<line class="axis" x1=${PLOT_LEFT} y1=${plotBottom} x2=${PLOT_RIGHT} y2=${plotBottom}></line>`
                : nothing}
              ${showScale && group.scale
                ? group.yLabels.map(
                    (label) => svg`
                      <line class="axis tick" x1=${PLOT_LEFT} y1=${label.y.toFixed(1)} x2=${PLOT_LEFT + 4} y2=${label.y.toFixed(1)}></line>
                    `
                  )
                : nothing}
              ${showScale
                ? group.rightYLabels.map(
                    (label) => svg`
                      <line class="axis tick" x1=${PLOT_RIGHT - 4} y1=${label.y.toFixed(1)} x2=${PLOT_RIGHT} y2=${label.y.toFixed(1)}></line>
                    `
                  )
                : nothing}
            </svg>
            ${showScale
              ? group.xLabels.map(
                  (label) => {
                    const pct = (((label.x - PLOT_LEFT) / PLOT_WIDTH) * 100).toFixed(2);
                    return html`<span class="x-axis-label ${label.bold ? "x-axis-label--bold" : ""}" style="left:${pct}%;top:${xLabelTop}px;">${label.label}</span>`;
                  }
                )
              : nothing}
          </div>
          <div class="axis-labels axis-labels--right" style="height:${group.canvasHeight}px">
            ${showScale
              ? group.rightYLabels.map(
                  (label) => html`<span class="y-axis-label y-axis-label--right" style="top:${label.y.toFixed(1)}px;">${label.value}</span>`
                )
              : nothing}
          </div>
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

    root.querySelectorAll<SVGPolylineElement>("polyline[data-line-id]").forEach((poly) => {
      const lineId = poly.getAttribute("data-line-id");
      const targetX = Number(poly.getAttribute("data-target-x"));
      if (!lineId || !Number.isFinite(targetX)) return;

      const prevX = this._prevClipX.get(lineId) ?? 0;
      const safeId = lineId.replace(/[^a-zA-Z0-9]/g, "_");
      const rect = root.querySelector(`#rect-${safeId}`);

      if (rect instanceof SVGRectElement) {
        if (poly.getAttribute("data-animate-clip") !== "true") {
          rect.style.removeProperty("transition");
          rect.setAttribute("width", targetX.toString());
          this._prevClipX.set(lineId, targetX);
          return;
        }

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

  private _renderChartBody(): TemplateResult | typeof nothing {
    if (this._data.error) {
      const isTimeout = /timed?\s*out/i.test(this._data.error);
      return html`<div class="error">${localize(this.hass, isTimeout ? "error_timeout" : "error")}</div>`;
    }

    if (!this._resolved || (this._resolved.series.length === 0 && this._selectedSources.length === 0)) {
      return nothing;
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
      const tooltipSeries: SyncedSeries[] = groups.flatMap((group) =>
        group.allSeries.map((s) => ({ id: s.id, label: s.label, color: s.color }))
      );

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
                ${showTooltip ? this._tooltip.renderTooltip() : nothing}
              </div>`
          : this._data.loading
            ? nothing
          : html`<div class="empty">${localize(this.hass, "empty")}</div>`}
      </div>
    `;
  }

  private readonly _getEntityPickerItems = (): unknown[] =>
    entityPickerItems(this.hass);

  private readonly _getAdditionalEntityPickerItems = (search?: string): unknown[] => {
    if (!this.hass || !search?.trim()) return [];
    const pinnedIds = new Set(this._pickerEntities().map((e) => e.entity_id));
    const items = entityPickerItems(
      this.hass,
      Object.values(this.hass.states)
        .filter((entity): entity is HassEntity => entity !== undefined)
        .filter((entity) => !pinnedIds.has(entity.entity_id))
    );
    return filterEntityPickerItems(items, search);
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
      draggingSourceId: this._draggingSourceId,
      resolved: this._activeResolvedConfig(),
      loading: this._data.loading,
      attributeSearch: this._attributeSearch,
      getItems: this._getEntityPickerItems,
      getAdditionalItems: this._getAdditionalEntityPickerItems,
      onEntityPickerOpened: () => this._onEntityPickerOpened(),
      onEntityPickerClosed: () => this._onEntityPickerClosed(),
      onEntitySelected: (entityId) => this._onEntitySelected(entityId),
      onAttributeSearchChanged: (value) => { this._attributeSearch = value; },
      onSourceAdded: (source) => this._addSource(source),
      onSourceRemoved: (sourceId) => this._removeSource(sourceId),
      onSourceDragStart: (sourceId, event) => this._onSourceDragStart(sourceId, event),
      onSourceDragOver: (sourceId, event) => this._onSourceDragOver(sourceId, event),
      onSourceDragEnd: () => this._onSourceDragEnd(),
      onSourceDrop: (sourceId, event) => this._onSourceDrop(sourceId, event),
      onBreadcrumbClick: (path) => { this._path = path; },
      onCloseMenu: () => this._closeAttributeMenu(),
    });
  }

  private _rangePercent(date: Date | undefined, fallback: Date): number {
    const start = this._resolved?.startDate.getTime() ?? this._effectiveStartDate().getTime();
    const end = this._rangeExtendsFuture()
      ? this._effectiveEndDate().getTime()
      : this._resolved?.endDate.getTime() ?? this._effectiveEndDate().getTime();
    const span = Math.max(end - start, 1);
    const value = date?.getTime() ?? fallback.getTime();

    return Math.round(((value - start) / span) * 1000);
  }

  private _loadedRangeMs(): { start: number; end: number; span: number } {
    const start = this._resolved?.startDate.getTime() ?? this._effectiveStartDate().getTime();
    const rawEnd = this._rangeExtendsFuture()
      ? this._effectiveEndDate().getTime()
      : this._resolved?.endDate.getTime() ?? this._effectiveEndDate().getTime();
    const end = Math.max(rawEnd, start + 1);

    return { start, end, span: end - start };
  }

  private _rangeSliderTrackWidthPx(source?: Element | null): number | undefined {
    const stack = (
      source?.closest(".range-slider-stack")
      ?? this.renderRoot.querySelector(".range-slider-stack")
    ) as HTMLElement | null | undefined;
    const width = stack?.getBoundingClientRect().width ?? 0;

    return width > 0 ? width : undefined;
  }

  private _minViewSpanMs(trackWidthPx = this._rangeSliderTrackWidthPx()): number {
    const { span } = this._loadedRangeMs();
    const readableTrackWidth = Math.max(trackWidthPx ?? MIN_VIEW_RANGE_FALLBACK_TRACK_PX, MIN_VIEW_RANGE_GAP_PX);
    const sliderReadableSpan = Math.ceil((span * MIN_VIEW_RANGE_GAP_PX) / readableTrackWidth);
    const timeReadableSpan = Math.min(60_000, Math.max(1, Math.floor(span / 1000)));

    return Math.min(span, Math.max(1, sliderReadableSpan, timeReadableSpan));
  }

  private _minViewRangeStep(trackWidthPx?: number): number {
    const loaded = this._loadedRangeMs();

    return Math.max(1, Math.ceil((this._minViewSpanMs(trackWidthPx) / loaded.span) * 1000));
  }

  private _setViewRangeMs(startMs: number, endMs: number, trackWidthPx?: number): void {
    const loaded = this._loadedRangeMs();
    const minSpan = this._minViewSpanMs(trackWidthPx);
    const requestedSpan = Math.max(endMs - startMs, minSpan);
    const span = Math.min(requestedSpan, loaded.span);
    const start = Math.min(Math.max(startMs, loaded.start), loaded.end - span);
    const end = start + span;

    this._viewStart = new Date(start);
    this._viewEnd = new Date(end);

    this.dispatchEvent(
      new CustomEvent("view-range-changed", {
        detail: { start: this._viewStart, end: this._viewEnd },
        bubbles: true,
        composed: true
      })
    );
  }

  private _dateFromRangePercent(percent: number): Date {
    const start = this._resolved?.startDate.getTime() ?? this._effectiveStartDate().getTime();
    const end = this._rangeExtendsFuture()
      ? this._effectiveEndDate().getTime()
      : this._resolved?.endDate.getTime() ?? this._effectiveEndDate().getTime();

    return new Date(start + (Math.max(0, Math.min(1000, percent)) / 1000) * (end - start));
  }

  private _formatRangeDate(date: Date): string {
    return date.toLocaleString(this._resolved?.language ?? undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  private _setViewRangePart(part: "start" | "end", event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const nextPercent = Number(input.value);
    const trackWidthPx = this._rangeSliderTrackWidthPx(input);
    const current = this._effectiveViewRange();
    const currentStartPercent = this._rangePercent(current.start, current.start);
    const currentEndPercent = this._rangePercent(current.end, current.end);
    const minStep = this._minViewRangeStep(trackWidthPx);
    let clampedPercent: number;

    if (part === "start") {
      clampedPercent = Math.min(Math.max(nextPercent, 0), currentEndPercent - minStep);
      input.value = String(clampedPercent);
      this._setViewRangeMs(this._dateFromRangePercent(clampedPercent).getTime(), current.end.getTime(), trackWidthPx);
    } else {
      clampedPercent = Math.max(Math.min(nextPercent, 1000), currentStartPercent + minStep);
      input.value = String(clampedPercent);
      this._setViewRangeMs(current.start.getTime(), this._dateFromRangePercent(clampedPercent).getTime(), trackWidthPx);
    }
  }

  private _onRangeSelectionPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;

    const selection = event.currentTarget as HTMLElement;
    const stack = selection.closest(".range-slider-stack");
    if (!(stack instanceof HTMLElement)) return;

    const rect = stack.getBoundingClientRect();
    if (rect.width <= 0) return;

    const loaded = this._loadedRangeMs();
    const current = this._effectiveViewRange();
    const viewStart = current.start.getTime();
    const viewSpan = current.end.getTime() - viewStart;
    if (viewSpan >= loaded.span - 1) return;

    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    selection.setPointerCapture(event.pointerId);
    selection.toggleAttribute("dragging", true);

    const move = (moveEvent: PointerEvent): void => {
      moveEvent.preventDefault();
      const delta = ((moveEvent.clientX - startX) / rect.width) * loaded.span;
      const nextStart = Math.min(Math.max(viewStart + delta, loaded.start), loaded.end - viewSpan);

      this._setViewRangeMs(nextStart, nextStart + viewSpan);
    };
    const cleanup = (): void => {
      selection.toggleAttribute("dragging", false);
      selection.removeEventListener("pointermove", move);
      selection.removeEventListener("pointerup", cleanup);
      selection.removeEventListener("pointercancel", cleanup);
    };

    selection.addEventListener("pointermove", move);
    selection.addEventListener("pointerup", cleanup);
    selection.addEventListener("pointercancel", cleanup);
  }

  private _resetViewRange(): void {
    if (!this._resolved) return;

    this._viewStart = this._resolved.startDate;
    this._viewEnd = this._rangeExtendsFuture() ? this._effectiveEndDate() : this._resolved.endDate;

    this.dispatchEvent(
      new CustomEvent("view-range-changed", {
        detail: { start: this._viewStart, end: this._viewEnd },
        bubbles: true,
        composed: true
      })
    );
  }

  private _setRuntimeLineMode(mode: BetterHistoryLineMode): void {
    this._runtimeLineMode = mode;
  }

  private _exportData(): void {
    const viewRange = this._effectiveViewRange();
    const series = this._buildRenderSeries()
      .filter((item) => !this._hiddenSeriesIds.includes(item.id))
      .map((item) => ({
        id: item.id,
        entityId: item.id.startsWith("attr:") ? item.id.slice(5).split(":")[0] : item.id.replace(/^state:/, ""),
        attribute: item.id.startsWith("attr:") ? item.id.slice(5).split(":").slice(1).join(":") : undefined,
        label: item.label,
        unit: item.unit,
        valueType: item.valueType,
        lineMode: item.lineMode,
        color: item.color,
        points: item.points
          .filter((point) => point.time >= viewRange.start.getTime() && point.time <= viewRange.end.getTime())
          .map((point) => ({
            timestamp: new Date(point.time).toISOString(),
            value: point.value
          }))
      }));
    const payload = {
      format: "ha-better-history-series-v1",
      exportedAt: new Date().toISOString(),
      loadedRange: {
        start: this._resolved?.startDate.toISOString(),
        end: (this._rangeExtendsFuture() ? this._effectiveEndDate() : this._resolved?.endDate)?.toISOString()
      },
      viewRange: {
        start: viewRange.start.toISOString(),
        end: viewRange.end.toISOString()
      },
      series
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");

    anchor.href = url;
    anchor.download = `ha-better-history-${stamp}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private _importData(): void {
    const input = document.createElement("input");

    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;

      file.text()
        .then((content) => this._applyImportedData(JSON.parse(content) as unknown))
        .catch(() => this._data.setError("Invalid import file"));
    }, { once: true });
    input.click();
  }

  private _applyImportedData(payload: unknown): void {
    if (!this._isExportPayload(payload)) {
      this._data.setError("Unsupported import format");
      return;
    }

    const imported = this._parseImportedSeries(payload.series ?? []);
    if (!imported) {
      this._data.setError("Invalid import data");
      return;
    }

    const viewStart = this._parseDate(payload.viewRange?.start);
    const viewEnd = this._parseDate(payload.viewRange?.end);
    const loadedStart = this._parseDate(payload.loadedRange?.start) ?? viewStart;
    const loadedEnd = this._parseDate(payload.loadedRange?.end) ?? viewEnd;

    if (!viewStart || !viewEnd || !loadedStart || !loadedEnd || loadedStart.getTime() >= loadedEnd.getTime()) {
      this._data.setError("Invalid import range");
      return;
    }

    this._importedSeriesMeta = imported.meta;
    this._importedDataActive = true;
    this._selectedSources = imported.series.map((item) => item.source);
    this._removedConfigSourceIds = [];
    this._rangeStart = loadedStart;
    this._rangeEnd = loadedEnd;
    this._viewStart = viewStart;
    this._viewEnd = viewEnd;
    this._hiddenSeriesIds = [];
    this._prevClipX.clear();
    this._chartRenderCache = undefined;
    this._graphGroupRenderCache = undefined;

    const sourceIds = this._selectedSources.map((source) => source.id).sort().join("|");
    this._lastFetchKey = `${sourceIds}|${loadedStart.getTime()}|${loadedEnd.getTime()}`;
    this._lastFetchSources = [...this._selectedSources];
    this._data.setImportedSeries(imported.series, loadedStart, loadedEnd);

    this.dispatchEvent(
      new CustomEvent("data-imported", {
        detail: { start: loadedStart, end: loadedEnd, seriesCount: imported.series.length },
        bubbles: true,
        composed: true
      })
    );
  }

  private _isExportPayload(payload: unknown): payload is BetterHistorySeriesExportV1 {
    return typeof payload === "object"
      && payload !== null
      && (payload as BetterHistorySeriesExportV1).format === "ha-better-history-series-v1";
  }

  private _parseImportedSeries(items: unknown[]): { series: HistorySeries[]; meta: Map<string, ImportedSeriesMeta> } | undefined {
    const series: HistorySeries[] = [];
    const meta = new Map<string, ImportedSeriesMeta>();

    for (const item of items) {
      if (typeof item !== "object" || item === null) return undefined;
      const record = item as Record<string, unknown>;
      const id = typeof record.id === "string" && record.id.trim() !== "" ? record.id : undefined;
      const entityId = typeof record.entityId === "string" && record.entityId.trim() !== "" ? record.entityId : undefined;
      const label = typeof record.label === "string" && record.label.trim() !== "" ? record.label : id;
      const valueType = record.valueType === "number" || record.valueType === "boolean" || record.valueType === "string" ? record.valueType : undefined;
      const points = Array.isArray(record.points) ? record.points : undefined;

      if (!id || !entityId || !label || !valueType || !points) return undefined;

      const attribute = typeof record.attribute === "string" && record.attribute.trim() !== "" ? record.attribute : undefined;
      const source: HistorySource = {
        id,
        kind: attribute ? "entity_attribute" : "entity_state",
        entityId,
        label,
        path: attribute?.split("."),
        valueType,
        unit: typeof record.unit === "string" ? record.unit : undefined
      };
      const parsedPoints = points
        .map((point) => this._parseImportedPoint(point, valueType))
        .filter((point): point is NonNullable<ReturnType<typeof this._parseImportedPoint>> => point !== undefined)
        .sort((left, right) => left.time - right.time);

      series.push({ source, points: parsedPoints });
      meta.set(id, {
        color: typeof record.color === "string" && record.color.trim() !== "" ? record.color : undefined,
        lineMode: record.lineMode === "line" || record.lineMode === "column" || record.lineMode === "stair" ? record.lineMode : undefined
      });
    }

    return { series, meta };
  }

  private _parseImportedPoint(point: unknown, valueType: HistorySource["valueType"]): HistorySeries["points"][number] | undefined {
    if (typeof point !== "object" || point === null) return undefined;
    const record = point as Record<string, unknown>;
    const time = Date.parse(String(record.timestamp ?? ""));
    const value = record.value;

    if (!Number.isFinite(time)) return undefined;
    if (valueType === "number" && typeof value === "number" && Number.isFinite(value)) return { time, value };
    if (valueType === "boolean" && typeof value === "boolean") return { time, value };
    if (valueType === "string" && typeof value === "string") return { time, value };

    return undefined;
  }

  private _parseDate(value: unknown): Date | undefined {
    if (typeof value !== "string") return undefined;
    const time = Date.parse(value);

    return Number.isFinite(time) ? new Date(time) : undefined;
  }

  private _renderToolsPanel(): TemplateResult | typeof nothing {
    if (!this.toolsOpen || !this._resolved) return nothing;

    const viewRange = this._effectiveViewRange();
    const startPercent = this._rangePercent(viewRange.start, this._resolved.startDate);
    const endPercent = this._rangePercent(viewRange.end, this._resolved.endDate);
    const currentMode = this._defaultLineMode();
    const showRangeSelector = this._showTimeRangeSelector();
    const showLineModeButtons = this._showLineModeButtons();
    const showExportButton = this._showExportButton();
    const showImportButton = this._showImportButton();

    if (!showRangeSelector && !showLineModeButtons && !showExportButton && !showImportButton) return nothing;

    return html`
      <div class="tools-panel">
        <div class="tool-range">
          <div class="tool-range-row">
            ${showRangeSelector
              ? html`
                <div class="tool-range-control">
                  <div class="range-values">
                    <span>${this._formatRangeDate(viewRange.start)}</span>
                    <span>${this._formatRangeDate(viewRange.end)}</span>
                  </div>
                  <div class="range-slider-stack">
                    <div
                      class="range-selection"
                      style="left:${startPercent / 10}%;right:${100 - endPercent / 10}%;"
                    ></div>
                    <div
                      class="range-selection-hit"
                      @pointerdown=${(event: PointerEvent) => this._onRangeSelectionPointerDown(event)}
                    ></div>
                    <input class="range-slider" type="range" min="0" max="1000" .value=${String(startPercent)} @input=${(event: Event) => this._setViewRangePart("start", event)} />
                    <input class="range-slider" type="range" min="0" max="1000" .value=${String(endPercent)} @input=${(event: Event) => this._setViewRangePart("end", event)} />
                  </div>
                </div>
                <button
                  class="tool-action-button tool-reset-button"
                  title=${localize(this.hass, "reset_zoom")}
                  aria-label=${localize(this.hass, "reset_zoom")}
                  @click=${() => this._resetViewRange()}
                >
                  <ha-icon .icon=${"mdi:restore"}></ha-icon>
                </button>
              `
              : nothing}
            <div class="tool-actions">
              ${showLineModeButtons ? html`
                <div class="mode-switch" role="group" aria-label=${localize(this.hass, "line_mode")}>
                  ${[
                    ["stair", "mdi:stairs", "mode_stair"],
                    ["line", "mdi:chart-line", "mode_line"],
                    ["column", "mdi:chart-bar", "mode_column"]
                  ].map(([mode, icon, label]) => html`
                    <button
                      class="mode-button"
                      ?active=${currentMode === mode}
                      title=${localize(this.hass, label)}
                      @click=${() => this._setRuntimeLineMode(mode as BetterHistoryLineMode)}
                    >
                      <ha-icon .icon=${icon}></ha-icon>
                    </button>
                  `)}
                </div>
              ` : nothing}
              ${showExportButton
                ? html`
                  <button
                    class="tool-action-button"
                    title=${localize(this.hass, "export_data")}
                    aria-label=${localize(this.hass, "export_data")}
                    @click=${() => this._exportData()}
                  >
                    <ha-icon .icon=${"mdi:download"}></ha-icon>
                  </button>
                `
                : nothing}
              ${showImportButton
                ? html`
                  <button
                    class="tool-action-button"
                    title=${localize(this.hass, "import_data")}
                    aria-label=${localize(this.hass, "import_data")}
                    ?disabled=${this._hasForcedConfigSeries()}
                    @click=${() => this._importData()}
                  >
                    <ha-icon .icon=${"mdi:upload"}></ha-icon>
                  </button>
                `
                : nothing}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  render(): TemplateResult {
    const width = this._resolved?.width ?? "100%";
    const backgroundColor = this._resolved?.backgroundColor ?? "transparent";
    const title = this._resolved?.title?.trim();
    const titleStyle = [
      this._resolved?.titleFontFamily ? `font-family:${this._resolved.titleFontFamily};` : "",
      this._resolved?.titleFontSize ? `font-size:${this._resolved.titleFontSize};` : "",
      this._resolved?.titleColor ? `color:${this._resolved.titleColor};` : ""
    ].join("");

    return html`
      <div class="root" style="width:${width};background:${backgroundColor};">
        ${title ? html`<div class="graph-title" style=${titleStyle}>${title}</div>` : nothing}
        ${this.showControls
          ? html`<div class="controls-bar">
              ${this._renderDatePicker()}
              ${this._renderEntityPickerUI()}
            </div>`
          : nothing}
        ${this._renderToolsPanel()}
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

    return renderDatePicker({
      hass: this.hass,
      startDate: this._resolved.startDate,
      endDate: this._resolved.endDate,
      onChange: (startDate, endDate) => this._onDateRangeChanged(startDate, endDate),
      onOpen: () => this._onDatePickerOpened(),
      onClose: () => this._onDatePickerClosed()
    });
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
    this._closeBrowserHistoryLayer("attribute-picker", () => this._closePickerOverlay());
  }

  private _onEntitySelected(entityId: string): void {
    this._selectingEntityForAttributeMenu = true;
    const knownIds = new Set(this._pickerEntities().map((e) => e.entity_id));
    if (!knownIds.has(entityId)) {
      this._customEntityIds = [...this._customEntityIds, entityId];
    }
    this._selectedEntityId = entityId;
    this._path = [];
    this._attributeSearch = "";
    // Selecting an entity closes the HA picker overlay; ensure state stays in sync
    // even if `picker-closed` is not delivered.
    this._entityPickerOpen = false;
    this._attributeMenuOpen = true;
    if (this._browserHistoryEntry()?.layer === "entity-picker") {
      this._replaceBrowserHistoryLayer("attribute-picker");
    } else {
      this._pushBrowserHistoryLayer("attribute-picker");
    }

    queueMicrotask(() => {
      this._selectingEntityForAttributeMenu = false;
    });
  }

  private _onEntityPickerOpened(): void {
    if (this._entityPickerOpen && !this._attributeMenuOpen) return;

    this._entityPickerOpen = true;
    this._attributeMenuOpen = false;
    this._pushBrowserHistoryLayer("entity-picker");
  }

  private _onEntityPickerClosed(): void {
    if (this._selectingEntityForAttributeMenu) {
      this._entityPickerOpen = false;
      return;
    }

    this._closeBrowserHistoryLayer("entity-picker", () => {
      this._entityPickerOpen = false;
    });
  }

  // When the attribute browser is open, swallow outside pointer/mouse events
  // before HA's dialog scrim handler fires. Otherwise mwc-dialog's scrim logic
  // (which reacts to pointerdown) would close the parent dialog when the user
  // only meant to dismiss the attribute browser.
  private _handleDocumentPointerDown = (event: Event): void => {
    this._lastPointerDownInside = this._isEventInsideAttributeOverlay(event);
    if (!this._attributeMenuOpen) return;
    if (this._lastPointerDownInside) return;
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  private _handleDocumentClick = (event: Event): void => {
    if (!this._attributeMenuOpen) {
      this._lastPointerDownInside = false;
      return;
    }
    const pointerWasInside = this._lastPointerDownInside;
    this._lastPointerDownInside = false;
    if (pointerWasInside) return;
    if (this._isEventInsideAttributeOverlay(event)) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    this._closeAttributeMenu();
  };

  private _isEventInsideAttributeOverlay(event: Event): boolean {
    const path = event.composedPath();

    const menu = this.renderRoot?.querySelector(".entity-menu");
    if (menu && this._pathContainsElement(path, menu)) return true;

    const trigger = this.renderRoot?.querySelector(".entity-trigger");
    if (trigger && this._pathContainsElement(path, trigger)) return true;

    for (const el of path) {
      if (el === this) break;
      if (!(el instanceof HTMLElement)) continue;
      const tag = el.localName;
      if (
        tag === "ha-generic-picker" ||
        tag === "ha-combo-box" ||
        tag === "vaadin-combo-box-overlay" ||
        tag === "mwc-menu-surface" ||
        tag === "ha-md-list" ||
        tag === "md-menu"
      ) {
        return true;
      }
    }
    return false;
  }

  private _pathContainsElement(path: EventTarget[], element: Element): boolean {
    return path.some((target) => target instanceof Node && element.contains(target));
  }

  private _sourceWithAttributeUnit(source: HistorySource): HistorySource {
    if (source.kind !== "entity_attribute" || !source.path) return source;
    const mappedUnit = unitForAttributePath(source.path, this.attributeUnits ?? this.config?.attributeUnits);
    const unit = isAttributeTemperatureUnit(mappedUnit) ? this._resolvedTemperatureUnit() ?? mappedUnit : mappedUnit;
    if (!unit || source.unit === unit) return source;
    return { ...source, unit };
  }

  private _expandedSelectedSources(source: HistorySource): HistorySource[] {
    if (source.kind !== "entity_state" || !source.entityId.startsWith("climate.")) {
      return [this._sourceWithAttributeUnit(source)];
    }

    const entity = this.hass?.states[source.entityId];
    if (!entity) return [this._sourceWithAttributeUnit(source)];

    const tempUnit = typeof entity.attributes.temperature_unit === "string" && entity.attributes.temperature_unit !== ""
      ? entity.attributes.temperature_unit
      : typeof entity.attributes.unit_of_measurement === "string" && entity.attributes.unit_of_measurement !== ""
        ? entity.attributes.unit_of_measurement
        : undefined;
    const attributeSources = CLIMATE_LINE_ATTRIBUTES.map((attribute) => {
      const attrSource = attributeSource(entity, [attribute]);
      const fallbackSource: HistorySource = {
        id: `attr:${source.entityId}:${attribute}`,
        kind: "entity_attribute",
        entityId: source.entityId,
        label: attribute,
        path: [attribute],
        valueType: attribute === "hvac_action" ? "string" : "number",
        unit: CLIMATE_TEMPERATURE_ATTRIBUTES.has(attribute) ? tempUnit : undefined
      };
      const sourceForAttribute = attrSource ?? fallbackSource;
      if (CLIMATE_TEMPERATURE_ATTRIBUTES.has(attribute) && tempUnit) {
        return { ...sourceForAttribute, unit: tempUnit };
      }
      return sourceForAttribute;
    });

    return [this._sourceWithAttributeUnit(source), ...attributeSources.map((item) => this._sourceWithAttributeUnit(item))];
  }

  private _addSource(source: HistorySource): void {
    const removedConfigSource = this._resolved?.series.find(
      (series) => series.id === source.id && series.forced === false && this._removedConfigSourceIds.includes(series.id)
    );
    if (removedConfigSource) {
      this._removedConfigSourceIds = this._removedConfigSourceIds.filter((id) => id !== source.id);
      this._hiddenSeriesIds = this._hiddenSeriesIds.filter((id) => id !== source.id);
      return;
    }

    if (this._selectedSources.some((selected) => selected.id === source.id)) {
      return;
    }
    if (this._pendingAddedSources.some((selected) => selected.id === source.id)) {
      return;
    }
    if ((this._resolved?.series ?? []).some((s) => s.id === source.id)) {
      return;
    }

    const sourceWithUnit = this._sourceWithAttributeUnit(source);

    this._pendingAddedSources = [...this._pendingAddedSources, sourceWithUnit];

    this.dispatchEvent(
      new CustomEvent("series-added", {
        detail: { source: sourceWithUnit },
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

    const removableConfigSource = this._activeResolvedSeries().find((s) => s.id === sourceId && s.forced === false);
    if (removableConfigSource) {
      this._removedConfigSourceIds = [...this._removedConfigSourceIds, sourceId];
      this._hiddenSeriesIds = this._hiddenSeriesIds.filter((hs) => hs !== sourceId);
      this._data.removeSources([sourceId]);
      this.dispatchEvent(
        new CustomEvent("series-removed", {
          detail: { sourceId },
          bubbles: true,
          composed: true
        })
      );
      return;
    }

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

  private _onSourceDragStart(sourceId: string, event: DragEvent): void {
    const source = this._selectedSources.find((item) => item.id === sourceId);

    if (!source || this._isDefaultSource(source)) {
      event.preventDefault();
      return;
    }

    this._draggingSourceId = sourceId;
    this._dragStartSourceIds = this._selectedSources.map((item) => item.id);
    this._dragDropCommitted = false;
    event.dataTransfer?.setData("text/plain", sourceId);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
    }
  }

  private _onSourceDragEnd(): void {
    if (!this._dragDropCommitted && this._dragStartSourceIds) {
      const order = new Map(this._dragStartSourceIds.map((id, index) => [id, index]));

      this._selectedSources = [...this._selectedSources].sort(
        (left, right) => (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER)
      );
    }

    this._draggingSourceId = undefined;
    this._dragStartSourceIds = undefined;
    this._dragDropCommitted = false;
  }

  private _onSourceDragOver(targetSourceId: string | undefined, event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }

    const draggedId = this._draggingSourceId ?? event.dataTransfer?.getData("text/plain");
    if (!draggedId) return;

    this._previewSourceOrder(draggedId, targetSourceId);
  }

  private _onSourceDrop(targetSourceId: string | undefined, event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();

    const draggedId = this._draggingSourceId ?? event.dataTransfer?.getData("text/plain");
    if (!draggedId) return;

    this._previewSourceOrder(draggedId, targetSourceId);
    this._dragDropCommitted = true;
    this.dispatchEvent(
      new CustomEvent("series-reordered", {
        detail: { sourceIds: this._selectedSources.map((source) => source.id) },
        bubbles: true,
        composed: true
      })
    );

    void this.requestUpdate();
  }

  private _previewSourceOrder(draggedId: string, targetSourceId: string | undefined): void {
    if (draggedId === targetSourceId) return;

    const dragged = this._selectedSources.find((source) => source.id === draggedId);
    if (!dragged || this._isDefaultSource(dragged)) return;

    const withoutDragged = this._selectedSources.filter((source) => source.id !== draggedId);
    const targetIndex = targetSourceId
      ? withoutDragged.findIndex((source) => source.id === targetSourceId)
      : withoutDragged.length;

    if (targetIndex < 0) return;

    const nextSources = [
      ...withoutDragged.slice(0, targetIndex),
      dragged,
      ...withoutDragged.slice(targetIndex)
    ];
    if (nextSources.map((source) => source.id).join("|") === this._selectedSources.map((source) => source.id).join("|")) return;

    this._selectedSources = nextSources;
    void this.requestUpdate();
  }
}

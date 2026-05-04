import { LitElement, html, nothing, svg, type PropertyValues, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import { DataController } from "./controllers/data-controller.js";
import { TooltipController } from "./controllers/tooltip-controller.js";
import { resolveConfig, resolvedSeriesToSource } from "./data/resolve-config.js";
import { localize } from "./localize/localize.js";
import {
  buildChartData,
  CHART_WIDTH,
  PLOT_LEFT,
  PLOT_RIGHT,
  PLOT_TOP,
  type ChartRenderData,
  type RenderableSeries
} from "./render/chart.js";
import { chartStyles } from "./styles/chart.css.js";
import type { BetterHistoryConfig, ResolvedConfig } from "./types/config.js";
import type { HistorySeries, HistorySource } from "./data/history.js";
import type { HassEntity, HomeAssistant } from "./types/ha.js";
import { preloadDatePicker, renderDatePicker, datePickerAvailable } from "./ui/date-picker.js";
import {
  preloadEntityPickerComponents,
  entityPickerAvailable,
  renderEntityPicker
} from "./ui/entity-picker.js";

interface ChartRenderCache {
  seriesRef: HistorySeries[];
  hiddenKey: string;
  startTime: number;
  endTime: number;
  data: ChartRenderData;
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
  @state() private _customEntityInput = "";
  @state() private _entityPickerOpen = false;
  private _isMouseOutsideEntityPicker = false;

  private readonly _data = new DataController(this);
  private readonly _tooltip = new TooltipController(this);
  private _chartRenderCache?: ChartRenderCache;

  connectedCallback(): void {
    super.connectedCallback();

    document.addEventListener("click", this._handleDocumentClick);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("click", this._handleDocumentClick);
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
  private _lastHassResolveTime = 0;

  protected willUpdate(changed: PropertyValues): void {
    const watch = ["_rangeStart", "_rangeEnd", "hass", "config", "entities", "hours", "startDate", "endDate", "showDatePicker", "showEntityPicker", "showLegend", "showTooltip", "width", "height", "language"];

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
      const fetchKey = `${sources.map((s) => s.id).sort().join("|")}|${resolved.startDate.getTime()}|${resolved.endDate.getTime()}`;

      if (fetchKey !== this._lastFetchKey) {
        this._lastFetchKey = fetchKey;
        this._data.fetch(this.hass, sources, resolved.startDate, resolved.endDate);
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

  private _buildRenderSeries(): RenderableSeries[] {
    if (!this._resolved) return [];

    return this._resolved.series.flatMap((resolved) => {
      const fetched = this._data.series.find((s) => s.source.id === resolved.id);

      if (!fetched) return [];

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
          points: fetched.points
        }
      ];
    });
  }

  private _chartData(): ChartRenderData {
    const hiddenKey = this._hiddenSeriesIds.join("|");
    const cache = this._chartRenderCache;
    const startTime = this._resolved?.startDate.getTime() ?? 0;
    const endTime = this._resolved?.endDate.getTime() ?? 0;

    if (
      cache &&
      cache.seriesRef === this._data.series &&
      cache.hiddenKey === hiddenKey &&
      cache.startTime === startTime &&
      cache.endTime === endTime
    ) {
      return cache.data;
    }

    const all = this._buildRenderSeries();
    const visible = all.filter((s) => !this._hiddenSeriesIds.includes(s.id));
    const timeBounds = { start: startTime, end: Math.max(endTime, startTime + 1) };
    const data = buildChartData(visible, timeBounds, this._resolved?.disableClimateOverlay ?? false);

    this._chartRenderCache = { seriesRef: this._data.series, hiddenKey, startTime, endTime, data };

    return data;
  }

  private _renderScaleLabels(chartData: ChartRenderData): TemplateResult[] {
    const result: TemplateResult[] = [];

    for (const [index, scale] of chartData.numericScales.entries()) {
      if (index > 0) {
        const separatorY = scale.top - 17;

        result.push(svg`<line class="graph-separator" x1=${PLOT_LEFT} y1=${separatorY} x2=${PLOT_RIGHT} y2=${separatorY}></line>` as unknown as TemplateResult);
      }

      result.push(svg`<line class="axis" x1=${PLOT_LEFT} y1=${scale.top} x2=${PLOT_RIGHT} y2=${scale.top}></line>` as unknown as TemplateResult);

      for (const tickY of [scale.top, scale.top + scale.height / 2, scale.top + scale.height]) {
        result.push(svg`<line class="axis" x1=${PLOT_LEFT - 4} y1=${tickY} x2=${PLOT_LEFT} y2=${tickY}></line>` as unknown as TemplateResult);
      }
    }

    return result;
  }

  private _renderYAxisLabels(chartData: ChartRenderData): TemplateResult {
    const leftPct = ((PLOT_LEFT / CHART_WIDTH) * 100).toFixed(2);
    const sideStyle = `left:0;width:${leftPct}%;text-align:right;padding-right:6px;`;

    return html`
      ${chartData.yAxisLabels.map(
        (label) => html`<span class="y-axis-label" style="top:${label.y.toFixed(1)}px;${sideStyle}">${label.value}</span>`
      )}
    `;
  }

  private _renderLegend(): TemplateResult | typeof nothing {
    if (!this._resolved?.showLegend || this._resolved.series.length === 0) return nothing;

    return html`
      <div class="legend">
        ${this._resolved.series.map((s) => {
          const hidden = this._hiddenSeriesIds.includes(s.id);
          const swatchStyle =
            s.valueType !== "number"
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

  private _renderChart(): TemplateResult {
    const lang = this._resolved?.language;

    if (this._data.error) {
      return html`<div class="error">${this._data.error}</div>`;
    }

    if (!this._resolved || this._resolved.series.length === 0) {
      return html`<div class="empty">${localize(lang, "no_series")}</div>`;
    }

    if (this._data.loading) {
      const spinnerAvailable = customElements.get("ha-spinner") !== undefined;
      return html`<div class="chart-loading">
        ${spinnerAvailable
          ? html`<ha-spinner size="medium"></ha-spinner>`
          : html`<span>${localize(lang, "loading")}</span>`}
      </div>`;
    }

    if (this._data.series.length === 0) {
      return html`<div class="empty">${localize(lang, "empty")}</div>`;
    }

    const chartData = this._chartData();
    const hasData = chartData.visibleSeries.some((s) => s.points.length > 0);
    const showTooltip = this._resolved.showTooltip;

    if (hasData && showTooltip) {
      this._tooltip.sync(
        this._resolved.series,
        this._data.series,
        this._hiddenSeriesIds,
        chartData.chartHeight,
        chartData.timeBounds
      );
    }

    return html`
      <div class="chart-surface" style="height:${this._resolved.height ?? "auto"}">
        ${hasData
          ? html`
              <svg
                viewBox="0 0 ${CHART_WIDTH} ${chartData.chartHeight}"
                height="${chartData.chartHeight}"
                preserveAspectRatio="none"
                @pointermove=${showTooltip ? (e: PointerEvent) => this._tooltip.handlePointerMove(e) : nothing}
                @pointerleave=${showTooltip ? () => this._tooltip.handlePointerLeave() : nothing}
              >
                <line class="axis" x1=${PLOT_LEFT} y1=${PLOT_TOP} x2=${PLOT_LEFT} y2=${chartData.plotBottom}></line>
                <line class="axis" x1=${PLOT_LEFT} y1=${chartData.plotBottom} x2=${PLOT_RIGHT} y2=${chartData.plotBottom}></line>
                ${this._renderScaleLabels(chartData)}
                ${chartData.heatingAreas.map(
                  (area) => svg`<polygon class="climate-heating-area" points=${area.points}></polygon>`
                )}
                ${chartData.numericLines.map(
                  (line) => svg`<polyline class="line" points=${line.points} stroke=${line.color}></polyline>`
                )}
                ${chartData.segments.map(
                  (seg) => svg`<rect class="segment" x=${seg.x} y=${seg.y} width=${seg.width} height="9" fill=${seg.fill}></rect>`
                )}
                ${showTooltip ? this._tooltip.renderGuide(chartData.plotBottom) : nothing}
              </svg>
              ${this._renderYAxisLabels(chartData)}
              ${showTooltip
                ? html`<div class="chart-tooltip-clip" style="height:${chartData.chartHeight}px">${this._tooltip.renderTooltip(chartData.chartHeight)}</div>`
                : nothing}
            `
          : html`<div class="empty">${localize(lang, "empty")}</div>`}
      </div>
      ${this._renderLegend()}
    `;
  }

  private _renderEntityPickerUI(): TemplateResult | typeof nothing {
    if (!this._resolved?.showEntityPicker || !this._entityComponentsReady) return nothing;

    return renderEntityPicker({
      hass: this.hass,
      language: this.language,
      menuOpen: this._attributeMenuOpen,
      entityPickerOpen: this._entityPickerOpen,
      selectedEntityId: this._selectedEntityId,
      path: this._path,
      selectedSources: this._selectedSources,
      resolved: this._resolved,
      entities: this._pickerEntities(),
      customEntityInput: this._customEntityInput,
      positionMenu: () => this._positionEntityMenu(),
      onToggleMenu: () => this._toggleAttributeMenu(),
      onSelectEntity: (entityId) => this._selectEntity(entityId),
      onEntityPickerChanged: (entityId) => this._onEntityPickerChanged(entityId),
      onEntityPickerOpened: () => this._onEntityPickerOpened(),
      onEntityPickerClosed: () => this._onEntityPickerClosed(),
      onEntityPickerFocusOut: () => this._onEntityPickerFocusOut(),
      onSourceAdded: (source) => this._addSource(source),
      onSourceRemoved: (sourceId) => this._removeSource(sourceId),
      onBreadcrumbClick: (path) => { this._path = path; },
      onCloseMenu: () => this._closeAttributeMenu(),
    });
  }

  render(): TemplateResult {
    const width = this._resolved?.width ?? "100%";

    return html`
      <div style="width:${width};">
        ${this.showControls
          ? html`<div class="controls-bar">
              ${this._renderDatePicker()}
              ${this._renderEntityPickerUI()}
            </div>`
          : nothing}
        ${this._renderChart()}
      </div>
    `;
  }

  private _positionEntityMenu(): void {
    const trigger = this.renderRoot?.querySelector(".entity-trigger") as HTMLElement | null;
    const menu = this.renderRoot?.querySelector(".entity-menu") as HTMLElement | null;
    if (!trigger || !menu) return;

    menu.style.top = "0";
    menu.style.left = "0";
    menu.style.right = "";
    menu.style.width = "";
    const originRect = menu.getBoundingClientRect();

    const triggerRect = trigger.getBoundingClientRect();
    const host = this.renderRoot?.firstElementChild as HTMLElement | null;
    const bottomLimit = (host?.getBoundingClientRect().bottom ?? window.innerHeight) - 8;
    const available = bottomLimit - triggerRect.bottom - 8;

    menu.style.maxHeight = `${Math.min(Math.max(available, 120), 420)}px`;
    menu.style.top = `${triggerRect.bottom - originRect.top + 6}px`;

    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      menu.style.left = `${triggerRect.left - originRect.left}px`;
    } else {
      menu.style.left = `${16 - originRect.left}px`;
      menu.style.width = "calc(100vw - 32px)";
    }
  }

  private _toggleAttributeMenu(): void {
    this._attributeMenuOpen = !this._attributeMenuOpen;
  }

  private _closeAttributeMenu(): void {
    this._attributeMenuOpen = false;
    this._isMouseOutsideEntityPicker = false;
    this._entityPickerOpen = false;
  }

  private _selectEntity(entityId: string): void {
    this._selectedEntityId = entityId;
    this._path = [];
    this._attributeMenuOpen = true;
  }

  private _onEntityPickerChanged(entityId: string): void {
    const knownIds = new Set(this._pickerEntities().map((entity) => entity.entity_id));

    if (!knownIds.has(entityId)) {
      this._customEntityIds = [...this._customEntityIds, entityId];
    }

    this._selectedEntityId = entityId;
    this._path = [];
    this._customEntityInput = "";
    this._isMouseOutsideEntityPicker = false;
  }

  private _onEntityPickerOpened(): void {
    this._entityPickerOpen = true;
  }

  private _onEntityPickerFocusOut(): void {
    this._entityPickerOpen = false;
    if (this._isMouseOutsideEntityPicker) {
      this._closeAttributeMenu();
    }
  }

  private _onEntityPickerClosed(): void {
    this._entityPickerOpen = false;
    if (this._isMouseOutsideEntityPicker) {
      this._closeAttributeMenu();
    }
  }

  private _handleDocumentClick = (event: Event): void => {
    if (!this._attributeMenuOpen || this._entityPickerOpen) return;
    const picker = this.renderRoot?.querySelector(".entity-picker");
    if (!picker || !event.composedPath().includes(picker)) {
      this._closeAttributeMenu();
    }
  };

  private _addSource(source: HistorySource): void {
    if (this._selectedSources.some((selected) => selected.id === source.id)) {
      return;
    }

    this._selectedSources = [...this._selectedSources, source];
    this._attributeMenuOpen = window.matchMedia("(hover: hover) and (pointer: fine)").matches ? this._attributeMenuOpen : false;

    this.dispatchEvent(
      new CustomEvent("series-added", {
        detail: { source },
        bubbles: true,
        composed: true
      })
    );

    void this.requestUpdate();
  }

  private _removeSource(sourceId: string): void {
    const source = this._selectedSources.find((s) => s.id === sourceId);

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

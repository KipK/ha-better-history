import { LitElement, html, nothing, svg, type PropertyValues, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import { DataController } from "./controllers/data-controller.js";
import { resolveConfig, resolvedSeriesToSource } from "./data/resolve-config.js";
import { localize } from "./localize/localize.js";
import {
  buildChartData,
  scaleFor,
  CHART_WIDTH,
  PLOT_LEFT,
  PLOT_RIGHT,
  PLOT_TOP,
  PLOT_WIDTH,
  type ChartRenderData,
  type RenderableSeries
} from "./render/chart.js";
import { chartStyles } from "./styles/chart.css.js";
import type { BetterHistoryConfig, ResolvedConfig } from "./types/config.js";
import type { HistorySeries } from "./data/history.js";
import type { HomeAssistant } from "./types/ha.js";

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
  @property() width?: string;
  @property() height?: string;
  @property() language?: string;

  @state() private _resolved?: ResolvedConfig;
  @state() private _hiddenSeriesIds: string[] = [];

  private readonly _data = new DataController(this);
  private _chartRenderCache?: ChartRenderCache;

  protected willUpdate(changed: PropertyValues): void {
    const watch = ["hass", "config", "entities", "hours", "startDate", "endDate", "showDatePicker", "showEntityPicker", "showLegend", "showTooltip", "width", "height", "language"];

    if (watch.some((p) => changed.has(p))) {
      this._resolved = resolveConfig({
        config: this.config,
        entities: this.entities,
        hours: this.hours,
        startDate: this.startDate,
        endDate: this.endDate,
        showDatePicker: this.showDatePicker,
        showEntityPicker: this.showEntityPicker,
        showLegend: this.showLegend,
        showTooltip: this.showTooltip,
        width: this.width,
        height: this.height,
        language: this.language,
        hass: this.hass
      });

      this._data.fetch(
        this.hass,
        this._resolved.series.map(resolvedSeriesToSource),
        this._resolved.startDate,
        this._resolved.endDate
      );
    }
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
    const data = buildChartData(visible, timeBounds);

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

  private _renderChart(): TemplateResult {
    const lang = this._resolved?.language;

    if (this._data.error) {
      return html`<div class="error">${this._data.error}</div>`;
    }

    if (!this._resolved || this._resolved.series.length === 0) {
      return html`<div class="empty">${localize(lang, "no_series")}</div>`;
    }

    if (!this._data.loading && this._data.series.length === 0) {
      return html`<div class="empty">${localize(lang, "empty")}</div>`;
    }

    const chartData = this._chartData();
    const hasData = chartData.visibleSeries.some((s) => s.points.length > 0);

    return html`
      <div class="chart-surface" style="height:${this._resolved.height ?? "auto"}">
        ${hasData
          ? html`
              <svg
                viewBox="0 0 ${CHART_WIDTH} ${chartData.chartHeight}"
                height="${chartData.chartHeight}"
                preserveAspectRatio="none"
              >
                <line class="axis" x1=${PLOT_LEFT} y1=${PLOT_TOP} x2=${PLOT_LEFT} y2=${chartData.plotBottom}></line>
                <line class="axis" x1=${PLOT_LEFT} y1=${chartData.plotBottom} x2=${PLOT_RIGHT} y2=${chartData.plotBottom}></line>
                ${this._renderScaleLabels(chartData)}
                ${chartData.numericLines.map(
                  (line) => svg`<polyline class="line" points=${line.points} stroke=${line.color}></polyline>`
                )}
                ${chartData.segments.map(
                  (seg) => svg`<rect class="segment" x=${seg.x} y=${seg.y} width=${seg.width} height="9" fill=${seg.fill}></rect>`
                )}
              </svg>
              ${this._renderYAxisLabels(chartData)}
            `
          : html`<div class="empty">${localize(lang, "empty")}</div>`}
        ${this._data.loading
          ? html`<div class="chart-loading-overlay"><span class="chart-loading-label">${localize(lang, "loading")}</span></div>`
          : nothing}
      </div>
    `;
  }

  render(): TemplateResult {
    const width = this._resolved?.width ?? "100%";

    return html`
      <div style="width:${width};position:relative;">
        ${this._renderChart()}
      </div>
    `;
  }

  // Exposed for legend (step 5) and tooltip (step 6).
  toggleSeries(id: string): void {
    this._hiddenSeriesIds = this._hiddenSeriesIds.includes(id)
      ? this._hiddenSeriesIds.filter((h) => h !== id)
      : [...this._hiddenSeriesIds, id];
    this.dispatchEvent(new CustomEvent("series-toggled", { detail: { id, hidden: this._hiddenSeriesIds.includes(id) }, bubbles: true, composed: true }));
  }

  scaleForSeries(id: string): ReturnType<typeof scaleFor> {
    return scaleFor({ id } as RenderableSeries, this._chartData().numericScales);
  }

  get timeBounds(): { start: number; end: number } {
    return this._chartData().timeBounds;
  }

  get plotWidth(): number {
    return PLOT_WIDTH;
  }

  get plotLeft(): number {
    return PLOT_LEFT;
  }

  get chartWidth(): number {
    return CHART_WIDTH;
  }
}

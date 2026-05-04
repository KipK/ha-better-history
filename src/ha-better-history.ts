import { LitElement, html, nothing, type PropertyValues } from "lit";
import { property, state } from "lit/decorators.js";
import { DataController } from "./controllers/data-controller.js";
import { resolveConfig, resolvedSeriesToSource } from "./data/resolve-config.js";
import type { BetterHistoryConfig, ResolvedConfig } from "./types/config.js";
import type { HomeAssistant } from "./types/ha.js";

export class HaBetterHistory extends LitElement {
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

  private readonly _data = new DataController(this);

  protected willUpdate(changed: PropertyValues): void {
    const watchedProps = ["hass", "config", "entities", "hours", "startDate", "endDate", "showDatePicker", "showEntityPicker", "showLegend", "showTooltip", "width", "height", "language"];

    if (watchedProps.some((p) => changed.has(p))) {
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

      const sources = this._resolved.series.map(resolvedSeriesToSource);

      this._data.fetch(this.hass, sources, this._resolved.startDate, this._resolved.endDate);
    }
  }

  render() {
    if (!this._resolved || this._resolved.series.length === 0) {
      return html`<div class="empty">No series configured.</div>`;
    }

    if (this._data.error) {
      return html`<div class="error">${this._data.error}</div>`;
    }

    if (this._data.loading) {
      return html`<div class="loading">Loading…</div>`;
    }

    if (this._data.series.length === 0) {
      return html`<div class="empty">No data.</div>`;
    }

    return html`
      <div class="chart-placeholder">
        ${this._data.series.map((s) => html`<div>${s.source.label}: ${s.points.length} points</div>`)}
        ${this._data.loading ? html`<div class="loading-overlay">Loading…</div>` : nothing}
      </div>
    `;
  }
}

import { LitElement, html } from "lit";

export { type BetterHistoryConfig, type SeriesConfig, type ResolvedConfig, type ResolvedSeries } from "./types/config.js";
export { type HistorySource, type HistorySeries, type HistoryPoint, type HistoryValueType } from "./data/history.js";
export { type HomeAssistant, type HassEntity } from "./types/ha.js";

export class HaBetterHistory extends LitElement {
  render() {
    return html`<div>hello</div>`;
  }
}

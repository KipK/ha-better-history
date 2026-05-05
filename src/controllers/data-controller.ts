import type { ReactiveController, ReactiveControllerHost } from "lit";
import { fetchHistory, type HistorySeries, type HistorySource } from "../data/history.js";
import type { HomeAssistant } from "../types/ha.js";

export class DataController implements ReactiveController {
  readonly host: ReactiveControllerHost;

  series: HistorySeries[] = [];
  loading = false;
  error = "";

  private _prevKey = "";
  private _requestId = 0;

  constructor(host: ReactiveControllerHost) {
    this.host = host;
    host.addController(this);
  }

  hostConnected(): void {}
  hostDisconnected(): void {}

  fetch(hass: HomeAssistant | undefined, sources: HistorySource[], start: Date, end: Date): void {
    const key = `${sources.map((s) => s.id).join("|")}|${start.getTime()}|${end.getTime()}`;

    if (key === this._prevKey && !this.error) return;

    this._prevKey = key;

    if (!hass || sources.length === 0) {
      this.series = [];
      this.loading = false;
      this.error = hass ? "No sources provided" : "No hass object";
      this.host.requestUpdate();
      return;
    }

    const id = ++this._requestId;

    this.loading = this.series.length === 0;
    this.error = "";

    fetchHistory(hass, sources, start, end).then((series) => {
      if (id !== this._requestId) return;
      this.series = series;
      this.loading = false;
      this.host.requestUpdate();
    }).catch((err: unknown) => {
      if (id !== this._requestId) return;
      this.error = err instanceof Error ? err.message : String(err);
      this.series = [];
      this.loading = false;
      this.host.requestUpdate();
    });
  }

  addSources(
    hass: HomeAssistant | undefined,
    newSources: HistorySource[],
    start: Date,
    end: Date
  ): void {
    if (!hass || newSources.length === 0) return;

    const existingIds = new Set(this.series.map((s) => s.source.id));
    const toFetch = newSources.filter((s) => !existingIds.has(s.id));

    if (toFetch.length === 0) return;

    const id = ++this._requestId;

    this.loading = this.series.length === 0;

    fetchHistory(hass, toFetch, start, end).then((results) => {
      if (id !== this._requestId) return;

      for (const result of results) {
        const idx = this.series.findIndex((s) => s.source.id === result.source.id);
        if (idx !== -1) {
          this.series[idx] = result;
        } else {
          this.series.push(result);
        }
      }

      this.loading = false;
      this.host.requestUpdate();
    }).catch((err: unknown) => {
      if (id !== this._requestId) return;
      this.error = err instanceof Error ? err.message : String(err);
      this.loading = false;
      this.host.requestUpdate();
    });
  }

  removeSources(sourceIds: string[]): void {
    if (sourceIds.length === 0) return;

    const removed = new Set(sourceIds);

    this.series = this.series.filter((s) => !removed.has(s.source.id));
    this._prevKey = this.series.map((s) => s.source.id).join("|") + "|";

    this.host.requestUpdate();
  }
}

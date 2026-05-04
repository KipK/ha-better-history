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
      this.error = "";
      this.host.requestUpdate();

      return;
    }

    const id = ++this._requestId;

    this.loading = true;
    this.error = "";
    this.host.requestUpdate();

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
}

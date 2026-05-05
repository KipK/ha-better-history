import type { ReactiveController, ReactiveControllerHost } from "lit";
import { fetchHistory, type HistorySeries, type HistorySource } from "../data/history.js";
import type { HomeAssistant } from "../types/ha.js";

const FETCH_TIMEOUT_MS = 60000;

function defer(cb: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(cb));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out")), ms)
    )
  ]);
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

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

    this.loading = true;
    this.error = "";
    this.host.requestUpdate();

    withTimeout(fetchHistory(hass, sources, start, end), FETCH_TIMEOUT_MS)
      .then((series) => {
        if (id !== this._requestId) return;
        defer(() => {
          this.series = series;
          this.loading = false;
          this.host.requestUpdate();
        });
      }).catch((err: unknown) => {
        if (id !== this._requestId) return;
        this.error = formatError(err);
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

    this.loading = true;
    this.host.requestUpdate();

    withTimeout(fetchHistory(hass, toFetch, start, end), FETCH_TIMEOUT_MS)
      .then((results) => {
        if (id !== this._requestId) return;
        defer(() => {
          const updated = [...this.series];

          for (const result of results) {
            const idx = updated.findIndex((s) => s.source.id === result.source.id);
            if (idx !== -1) {
              updated[idx] = result;
            } else {
              updated.push(result);
            }
          }

          this.series = updated;
          this.loading = false;
          this.host.requestUpdate();
        });
      }).catch((err: unknown) => {
        if (id !== this._requestId) return;
        this.error = formatError(err);
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

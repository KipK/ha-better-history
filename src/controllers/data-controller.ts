import type { ReactiveController, ReactiveControllerHost } from "lit";
import { fetchHistory, type HistorySeries, type HistorySource } from "../data/history.js";
import type { HomeAssistant } from "../types/ha.js";
import { logPerformance, performanceNow } from "../utils/performance.js";

const FETCH_TIMEOUT_MS = 60000;

function defer(cb: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(cb));
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
  debugPerformance = false;

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
    const fetchStart = performanceNow();

    this.series = [];
    this.loading = true;
    this.error = "";
    if (this.debugPerformance) {
      logPerformance(this.debugPerformance, "controller.fetch_start", {
        sourceCount: sources.length,
        rangeHours: Math.round((end.getTime() - start.getTime()) / 36_000) / 100
      });
    }
    this.host.requestUpdate();

    fetchHistory(
      hass,
      sources,
      start,
      end,
      (partial) => {
        if (id !== this._requestId) return;
        const updateStart = performanceNow();
        this.series = partial;
        this.host.requestUpdate();
        if (this.debugPerformance) {
          logPerformance(this.debugPerformance, "controller.progress_update", {
            sourceCount: partial.length,
            pointCount: partial.reduce((total, series) => total + series.points.length, 0),
            updateDurationMs: Math.round(performanceNow() - updateStart)
          });
        }
      },
      this.debugPerformance ? (event) => {
        logPerformance(this.debugPerformance, event.event, event.details);
      } : undefined,
      {
        isCancelled: () => id !== this._requestId,
        chunkTimeoutMs: FETCH_TIMEOUT_MS
      }
    )
      .then((series) => {
        if (id !== this._requestId) return;
        defer(() => {
          const updateStart = performanceNow();
          this.series = series;
          this.loading = false;
          this.host.requestUpdate();
          if (this.debugPerformance) {
            logPerformance(this.debugPerformance, "controller.fetch_complete", {
              sourceCount: series.length,
              pointCount: series.reduce((total, item) => total + item.points.length, 0),
              totalDurationMs: Math.round(performanceNow() - fetchStart),
              updateDurationMs: Math.round(performanceNow() - updateStart)
            });
          }
        });
      }).catch((err: unknown) => {
        if (id !== this._requestId) return;
        this.error = formatError(err);
        this.loading = false;
        this.host.requestUpdate();
        if (this.debugPerformance) {
          logPerformance(this.debugPerformance, "controller.fetch_error", {
            totalDurationMs: Math.round(performanceNow() - fetchStart),
            error: this.error
          });
        }
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
    const fetchStart = performanceNow();

    this.loading = true;
    if (this.debugPerformance) {
      logPerformance(this.debugPerformance, "controller.add_sources_start", {
        sourceCount: toFetch.length,
        existingSourceCount: this.series.length,
        rangeHours: Math.round((end.getTime() - start.getTime()) / 36_000) / 100
      });
    }
    this.host.requestUpdate();

    fetchHistory(
      hass,
      toFetch,
      start,
      end,
      (partial) => {
        if (id !== this._requestId) return;
        const mergeStart = performanceNow();
        this._mergePartial(partial);
        this.host.requestUpdate();
        if (this.debugPerformance) {
          logPerformance(this.debugPerformance, "controller.add_sources_progress", {
            sourceCount: partial.length,
            pointCount: partial.reduce((total, series) => total + series.points.length, 0),
            mergeDurationMs: Math.round(performanceNow() - mergeStart)
          });
        }
      },
      this.debugPerformance ? (event) => {
        logPerformance(this.debugPerformance, event.event, event.details);
      } : undefined,
      {
        isCancelled: () => id !== this._requestId,
        chunkTimeoutMs: FETCH_TIMEOUT_MS
      }
    )
      .then((results) => {
        if (id !== this._requestId) return;
        defer(() => {
          const mergeStart = performanceNow();
          this._mergePartial(results);
          this.loading = false;
          this.host.requestUpdate();
          if (this.debugPerformance) {
            logPerformance(this.debugPerformance, "controller.add_sources_complete", {
              sourceCount: results.length,
              pointCount: results.reduce((total, series) => total + series.points.length, 0),
              totalDurationMs: Math.round(performanceNow() - fetchStart),
              mergeDurationMs: Math.round(performanceNow() - mergeStart)
            });
          }
        });
      }).catch((err: unknown) => {
        if (id !== this._requestId) return;
        this.error = formatError(err);
        this.loading = false;
        this.host.requestUpdate();
        if (this.debugPerformance) {
          logPerformance(this.debugPerformance, "controller.add_sources_error", {
            totalDurationMs: Math.round(performanceNow() - fetchStart),
            error: this.error
          });
        }
      });
  }

  private _mergePartial(partial: HistorySeries[]): void {
    const updated = [...this.series];

    for (const result of partial) {
      const idx = updated.findIndex((s) => s.source.id === result.source.id);
      if (idx !== -1) {
        updated[idx] = result;
      } else {
        updated.push(result);
      }
    }

    this.series = updated;
  }

  removeSources(sourceIds: string[]): void {
    if (sourceIds.length === 0) return;

    const removed = new Set(sourceIds);

    this.series = this.series.filter((s) => !removed.has(s.source.id));
    this._prevKey = this.series.map((s) => s.source.id).join("|") + "|";

    this.host.requestUpdate();
  }
}

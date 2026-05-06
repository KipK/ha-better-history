import type { ReactiveController, ReactiveControllerHost } from "lit";
import { fetchHistory, HistoryDataAccumulator, type HistorySeries, type HistorySource } from "../data/history.js";
import type { HomeAssistant } from "../types/ha.js";
import { logPerformance, performanceNow } from "../utils/performance.js";

const FETCH_TIMEOUT_MS = 60000;

type SourceLoadState = "queued" | "loading" | "ready" | "partial" | "error";

interface HistoryLoadSession {
  id: number;
  startTime: number;
  endTime: number;
  cancelled: boolean;
  activeLoads: number;
  sourceStates: Map<string, SourceLoadState>;
  accumulator: HistoryDataAccumulator;
}

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
  private _nextSessionId = 0;
  private _session?: HistoryLoadSession;

  constructor(host: ReactiveControllerHost) {
    this.host = host;
    host.addController(this);
  }

  hostConnected(): void {}
  hostDisconnected(): void {}

  private _createSession(sources: HistorySource[], start: Date, end: Date): HistoryLoadSession {
    if (this._session) {
      this._session.cancelled = true;
    }

    const session: HistoryLoadSession = {
      id: ++this._nextSessionId,
      startTime: start.getTime(),
      endTime: end.getTime(),
      cancelled: false,
      activeLoads: 0,
      sourceStates: new Map(sources.map((source) => [source.id, "queued"])),
      accumulator: new HistoryDataAccumulator()
    };

    this._session = session;

    return session;
  }

  private _activeSession(start: Date, end: Date): HistoryLoadSession | undefined {
    const session = this._session;

    if (!session || session.cancelled) {
      return undefined;
    }

    return session.startTime === start.getTime() && session.endTime === end.getTime()
      ? session
      : undefined;
  }

  private _isCurrentSession(session: HistoryLoadSession): boolean {
    return this._session === session && !session.cancelled;
  }

  private _beginLoad(session: HistoryLoadSession, sources: HistorySource[]): void {
    session.activeLoads += 1;
    for (const source of sources) {
      session.sourceStates.set(source.id, "loading");
    }
  }

  private _completeLoad(session: HistoryLoadSession): void {
    session.activeLoads = Math.max(0, session.activeLoads - 1);
    this.loading = session.activeLoads > 0;
  }

  private _sessionSources(session: HistoryLoadSession, series: HistorySeries[]): HistorySeries[] {
    return series.filter((item) => session.sourceStates.has(item.source.id));
  }

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

    const session = this._createSession(sources, start, end);
    const fetchStart = performanceNow();

    this.series = [];
    this.loading = true;
    this.error = "";
    this._beginLoad(session, sources);
    if (this.debugPerformance) {
      logPerformance(this.debugPerformance, "controller.fetch_start", {
        sessionId: session.id,
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
        if (!this._isCurrentSession(session)) return;
        const updateStart = performanceNow();
        const nextPartial = this._sessionSources(session, partial);
        this.series = this._mergeSeries(this.series.filter((series) => !sources.some((source) => source.id === series.source.id)), nextPartial);
        for (const item of nextPartial) {
          session.sourceStates.set(item.source.id, "partial");
        }
        this.host.requestUpdate();
        if (this.debugPerformance) {
          logPerformance(this.debugPerformance, "controller.progress_update", {
            sessionId: session.id,
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
        isCancelled: () => !this._isCurrentSession(session),
        chunkTimeoutMs: FETCH_TIMEOUT_MS,
        accumulator: session.accumulator
      }
    )
      .then((series) => {
        if (!this._isCurrentSession(session)) return;
        defer(() => {
          if (!this._isCurrentSession(session)) return;
          const updateStart = performanceNow();
          const nextSeries = this._sessionSources(session, series);
          this.series = this._mergeSeries(this.series.filter((item) => !sources.some((source) => source.id === item.source.id)), nextSeries);
          for (const item of nextSeries) {
            session.sourceStates.set(item.source.id, "ready");
          }
          this._completeLoad(session);
          this.host.requestUpdate();
          if (this.debugPerformance) {
            logPerformance(this.debugPerformance, "controller.fetch_complete", {
              sessionId: session.id,
              sourceCount: series.length,
              pointCount: series.reduce((total, item) => total + item.points.length, 0),
              totalDurationMs: Math.round(performanceNow() - fetchStart),
              updateDurationMs: Math.round(performanceNow() - updateStart)
            });
          }
        });
      }).catch((err: unknown) => {
        if (!this._isCurrentSession(session)) return;
        for (const source of sources) {
          session.sourceStates.set(source.id, "error");
        }
        this.error = formatError(err);
        this._completeLoad(session);
        this.host.requestUpdate();
        if (this.debugPerformance) {
          logPerformance(this.debugPerformance, "controller.fetch_error", {
            sessionId: session.id,
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

    const session = this._activeSession(start, end) ?? this._createSession(this.series.map((item) => item.source), start, end);
    const fetchStart = performanceNow();

    for (const source of toFetch) {
      session.sourceStates.set(source.id, "queued");
    }

    this.loading = true;
    this._beginLoad(session, toFetch);
    if (this.debugPerformance) {
      logPerformance(this.debugPerformance, "controller.add_sources_start", {
        sessionId: session.id,
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
        if (!this._isCurrentSession(session)) return;
        const mergeStart = performanceNow();
        const nextPartial = this._sessionSources(session, partial);
        this._mergePartial(nextPartial);
        for (const item of nextPartial) {
          session.sourceStates.set(item.source.id, "partial");
        }
        this.host.requestUpdate();
        if (this.debugPerformance) {
          logPerformance(this.debugPerformance, "controller.add_sources_progress", {
            sessionId: session.id,
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
        isCancelled: () => !this._isCurrentSession(session),
        chunkTimeoutMs: FETCH_TIMEOUT_MS,
        accumulator: session.accumulator
      }
    )
      .then((results) => {
        if (!this._isCurrentSession(session)) return;
        defer(() => {
          if (!this._isCurrentSession(session)) return;
          const mergeStart = performanceNow();
          const nextResults = this._sessionSources(session, results);
          this._mergePartial(nextResults);
          for (const item of nextResults) {
            session.sourceStates.set(item.source.id, "ready");
          }
          this._completeLoad(session);
          this.host.requestUpdate();
          if (this.debugPerformance) {
            logPerformance(this.debugPerformance, "controller.add_sources_complete", {
              sessionId: session.id,
              sourceCount: results.length,
              pointCount: results.reduce((total, series) => total + series.points.length, 0),
              totalDurationMs: Math.round(performanceNow() - fetchStart),
              mergeDurationMs: Math.round(performanceNow() - mergeStart)
            });
          }
        });
      }).catch((err: unknown) => {
        if (!this._isCurrentSession(session)) return;
        for (const source of toFetch) {
          session.sourceStates.set(source.id, "error");
        }
        this.error = formatError(err);
        this._completeLoad(session);
        this.host.requestUpdate();
        if (this.debugPerformance) {
          logPerformance(this.debugPerformance, "controller.add_sources_error", {
            sessionId: session.id,
            totalDurationMs: Math.round(performanceNow() - fetchStart),
            error: this.error
          });
        }
      });
  }

  private _mergeSeries(base: HistorySeries[], partial: HistorySeries[]): HistorySeries[] {
    const updated = [...base];

    for (const result of partial) {
      const idx = updated.findIndex((s) => s.source.id === result.source.id);
      if (idx !== -1) {
        updated[idx] = result;
      } else {
        updated.push(result);
      }
    }

    return updated;
  }

  private _mergePartial(partial: HistorySeries[]): void {
    this.series = this._mergeSeries(this.series, partial);
  }

  removeSources(sourceIds: string[]): void {
    if (sourceIds.length === 0) return;

    const removed = new Set(sourceIds);

    this.series = this.series.filter((s) => !removed.has(s.source.id));
    for (const sourceId of sourceIds) {
      this._session?.sourceStates.delete(sourceId);
    }
    this._prevKey = this.series.map((s) => s.source.id).join("|") + "|";

    this.host.requestUpdate();
  }
}

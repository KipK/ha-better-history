import type { ReactiveController, ReactiveControllerHost } from "lit";
import { currentSourcePoint, fetchHistory, HistoryDataAccumulator, type HistoryPoint, type HistorySeries, type HistorySource } from "../data/history.js";
import type { HomeAssistant } from "../types/ha.js";
import { logPerformance, performanceNow } from "../utils/performance.js";

const FETCH_TIMEOUT_MS = 60000;
const PROGRESS_UPDATE_THROTTLE_MS = 48;

type SourceLoadState = "queued" | "loading" | "ready" | "partial" | "error";

interface HistoryLoadSession {
  id: number;
  startTime: number;
  endTime: number;
  cancelled: boolean;
  activeLoads: number;
  sources: HistorySource[];
  sourceStates: Map<string, SourceLoadState>;
  activeEntityLoads: Map<string, number>;
  accumulator: HistoryDataAccumulator;
}

function defer(cb: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(cb));
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function sourceCoverageKey(source: HistorySource): string {
  return `${source.kind === "entity_attribute" ? "full" : "state"}:${source.entityId}`;
}

function seriesContentEquals(left: HistorySeries[], right: HistorySeries[]): boolean {
  if (left.length !== right.length) return false;

  for (let i = 0; i < left.length; i++) {
    const leftSeries = left[i];
    const rightSeries = right[i];

    if (leftSeries.source.id !== rightSeries.source.id) return false;
    if (leftSeries.points.length !== rightSeries.points.length) return false;

    for (let j = 0; j < leftSeries.points.length; j++) {
      const leftPoint = leftSeries.points[j];
      const rightPoint = rightSeries.points[j];

      if (leftPoint.time !== rightPoint.time || leftPoint.value !== rightPoint.value) {
        return false;
      }
    }
  }

  return true;
}

function mergeLivePoint(points: HistoryPoint[], point: HistoryPoint): HistoryPoint[] {
  const existingIndex = points.findIndex((item) => item.time === point.time);

  if (existingIndex !== -1) {
    if (points[existingIndex].value === point.value) {
      return points;
    }

    const next = [...points];
    next[existingIndex] = point;

    return next;
  }

  const previous = [...points].reverse().find((item) => item.time < point.time);

  if (previous?.value === point.value) {
    return points;
  }

  return [...points, point].sort((left, right) => left.time - right.time);
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
  private _progressUpdateScheduled = false;
  private _lastProgressUpdateMs = 0;

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
      sources: [...sources],
      sourceStates: new Map(sources.map((source) => [source.id, "queued"])),
      activeEntityLoads: new Map(),
      accumulator: new HistoryDataAccumulator()
    };

    this._session = session;

    return session;
  }

  private _cancelSession(): void {
    if (this._session) {
      this._session.cancelled = true;
    }
    this._session = undefined;
    this._progressUpdateScheduled = false;
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

  private _addSessionSources(session: HistoryLoadSession, sources: HistorySource[]): void {
    const known = new Set(session.sources.map((source) => source.id));

    for (const source of sources) {
      if (!known.has(source.id)) {
        known.add(source.id);
        session.sources.push(source);
      }
    }
  }

  private _hasActiveEntityLoad(session: HistoryLoadSession, source: HistorySource): boolean {
    return (session.activeEntityLoads.get(sourceCoverageKey(source)) ?? 0) > 0;
  }

  private _beginLoad(session: HistoryLoadSession, sources: HistorySource[]): void {
    session.activeLoads += 1;
    for (const source of sources) {
      session.sourceStates.set(source.id, "loading");
      const key = sourceCoverageKey(source);
      session.activeEntityLoads.set(key, (session.activeEntityLoads.get(key) ?? 0) + 1);
    }
  }

  private _completeLoad(session: HistoryLoadSession, sources: HistorySource[]): void {
    session.activeLoads = Math.max(0, session.activeLoads - 1);
    for (const source of sources) {
      const key = sourceCoverageKey(source);
      const count = Math.max(0, (session.activeEntityLoads.get(key) ?? 0) - 1);
      if (count > 0) {
        session.activeEntityLoads.set(key, count);
      } else {
        session.activeEntityLoads.delete(key);
      }
    }
    this.loading = session.activeLoads > 0;
  }

  private _sessionSources(session: HistoryLoadSession, series: HistorySeries[]): HistorySeries[] {
    return series.filter((item) => session.sourceStates.has(item.source.id));
  }

  private _hasAccumulatorSeries(session: HistoryLoadSession, source: HistorySource): boolean {
    return source.kind === "entity_attribute"
      ? session.accumulator.hasFullStates(source.entityId)
      : session.accumulator.hasStates(source.entityId);
  }

  private _availableSessionSeries(
    session: HistoryLoadSession,
    hass: HomeAssistant,
    start: Date,
    end: Date,
    series: HistorySeries[]
  ): HistorySeries[] {
    const nextSeries = this._sessionSources(session, series);
    const seen = new Set(nextSeries.map((item) => item.source.id));

    for (const source of session.sources) {
      if (seen.has(source.id) || !session.sourceStates.has(source.id)) continue;
      if (!this._hasAccumulatorSeries(session, source)) continue;

      nextSeries.push(session.accumulator.buildSeries(source, hass, start, end));
      seen.add(source.id);
    }

    return nextSeries;
  }

  private _requestProgressUpdate(session: HistoryLoadSession): void {
    if (this._progressUpdateScheduled) return;

    this._progressUpdateScheduled = true;
    const elapsed = performanceNow() - this._lastProgressUpdateMs;
    const delay = Math.max(0, PROGRESS_UPDATE_THROTTLE_MS - elapsed);

    setTimeout(() => {
      requestAnimationFrame(() => {
        this._progressUpdateScheduled = false;
        if (!this._isCurrentSession(session)) return;

        this._lastProgressUpdateMs = performanceNow();
        this.host.requestUpdate();
      });
    }, delay);
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
      session.sources,
      start,
      end,
      (partial) => {
        if (!this._isCurrentSession(session)) return;
        const updateStart = performanceNow();
        const nextPartial = this._availableSessionSeries(session, hass, start, end, partial);
        this.series = this._mergeSeries(this.series.filter((series) => !session.sources.some((source) => source.id === series.source.id)), nextPartial);
        for (const item of nextPartial) {
          session.sourceStates.set(item.source.id, "partial");
        }
        this._requestProgressUpdate(session);
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
          const nextSeries = this._availableSessionSeries(session, hass, start, end, series);
          const mergedSeries = this._mergeSeries(this.series.filter((item) => !session.sources.some((source) => source.id === item.source.id)), nextSeries);
          if (!seriesContentEquals(this.series, mergedSeries)) {
            this.series = mergedSeries;
          }
          for (const item of nextSeries) {
            session.sourceStates.set(item.source.id, "ready");
          }
          this._completeLoad(session, sources);
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
        this._completeLoad(session, sources);
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

  setImportedSeries(series: HistorySeries[], start: Date, end: Date): void {
    this._cancelSession();
    this.series = series;
    this.loading = false;
    this.error = "";
    this._prevKey = `${series.map((item) => item.source.id).join("|")}|${start.getTime()}|${end.getTime()}`;
    this.host.requestUpdate();
  }

  setError(error: string): void {
    this._cancelSession();
    this.loading = false;
    this.error = error;
    this.host.requestUpdate();
  }

  addSources(
    hass: HomeAssistant | undefined,
    newSources: HistorySource[],
    start: Date,
    end: Date
  ): void {
    if (!hass || newSources.length === 0) return;

    const session = this._activeSession(start, end) ?? this._createSession(this.series.map((item) => item.source), start, end);
    const existingIds = new Set([
      ...this.series.map((s) => s.source.id),
      ...session.sourceStates.keys()
    ]);
    const toFetch = newSources.filter((s) => !existingIds.has(s.id));

    if (toFetch.length === 0) return;

    const activeCoverageKeys = new Set(session.activeEntityLoads.keys());
    this._addSessionSources(session, toFetch);
    const networkSources = toFetch.filter((source) => !this._hasActiveEntityLoad(session, source));
    const networkSourceIds = new Set(networkSources.map((source) => source.id));
    const fetchSources = session.sources.filter((source) =>
      networkSourceIds.has(source.id) || !activeCoverageKeys.has(sourceCoverageKey(source))
    );
    const fetchStart = performanceNow();

    for (const source of toFetch) {
      session.sourceStates.set(source.id, networkSources.includes(source) ? "queued" : "loading");
    }

    if (networkSources.length === 0) {
      const availableSeries = this._availableSessionSeries(session, hass, start, end, []);
      if (availableSeries.length > 0) {
        this._mergePartial(availableSeries);
        for (const item of availableSeries) {
          session.sourceStates.set(item.source.id, "partial");
        }
      }
      this.loading = session.activeLoads > 0;
      this._requestProgressUpdate(session);
      if (this.debugPerformance) {
        logPerformance(this.debugPerformance, "controller.add_sources_joined_active_load", {
          sessionId: session.id,
          sourceCount: toFetch.length,
          existingSourceCount: this.series.length
        });
      }
      return;
    }

    this.loading = true;
    this._beginLoad(session, networkSources);
    if (this.debugPerformance) {
      logPerformance(this.debugPerformance, "controller.add_sources_start", {
        sessionId: session.id,
        sourceCount: networkSources.length,
        joinedActiveSourceCount: toFetch.length - networkSources.length,
        existingSourceCount: this.series.length,
        rangeHours: Math.round((end.getTime() - start.getTime()) / 36_000) / 100
      });
    }
    this.host.requestUpdate();

    fetchHistory(
      hass,
      fetchSources,
      start,
      end,
      (partial) => {
        if (!this._isCurrentSession(session)) return;
        const mergeStart = performanceNow();
        const nextPartial = this._availableSessionSeries(session, hass, start, end, partial);
        this._mergePartial(nextPartial);
        for (const item of nextPartial) {
          session.sourceStates.set(item.source.id, "partial");
        }
        this._requestProgressUpdate(session);
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
          const nextResults = this._availableSessionSeries(session, hass, start, end, results);
          const mergedSeries = this._mergeSeries(this.series, nextResults);
          if (!seriesContentEquals(this.series, mergedSeries)) {
            this.series = mergedSeries;
          }
          for (const item of nextResults) {
            session.sourceStates.set(item.source.id, "ready");
          }
          this._completeLoad(session, networkSources);
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
        for (const source of networkSources) {
          session.sourceStates.set(source.id, "error");
        }
        this.error = formatError(err);
        this._completeLoad(session, networkSources);
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

  updateLivePoints(
    hass: HomeAssistant | undefined,
    sources: HistorySource[],
    start: Date,
    end: Date
  ): void {
    if (!hass || sources.length === 0 || this.series.length === 0) return;

    const startTime = start.getTime();
    const endTime = end.getTime();
    let changed = false;
    const bySourceId = new Map(sources.map((source) => [source.id, source]));
    const nextSeries = this.series.map((series) => {
      const source = bySourceId.get(series.source.id);
      if (!source) return series;

      const current = currentSourcePoint(hass, source, endTime);
      if (!current) return series;

      const livePoint = {
        ...current,
        time: Math.min(Math.max(current.time, startTime), endTime)
      };
      const points = mergeLivePoint(series.points, livePoint);
      if (points === series.points) return series;

      changed = true;

      return { ...series, points };
    });

    if (changed) {
      this.series = nextSeries;
      this.host.requestUpdate();
    }
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

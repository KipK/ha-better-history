import type { HassEntity, HomeAssistant } from "../types/ha.js";
import type { HistorySourceKind, HistoryValueType } from "./value-type.js";
import { asNumber, asString } from "./format.js";
import { performanceNow, type PerformanceDetails } from "../utils/performance.js";
import { runHistoryQueue, type HistoryQueueTask } from "./history-queue.js";

export type { HistoryValueType, HistorySourceKind };

export interface HistorySource {
  id: string;
  kind: HistorySourceKind;
  entityId: string;
  label: string;
  path?: string[];
  valueType: HistoryValueType;
  unit?: string;
  group?: string;
  /** @deprecated Use `group` instead. */
  scaleGroup?: string;
}

export interface HistoryPoint {
  time: number;
  value: number | string | boolean;
}

export interface HistorySeries {
  source: HistorySource;
  points: HistoryPoint[];
}

export interface HistoryPerformanceEvent {
  event: string;
  details: PerformanceDetails;
}

export type HistoryPerformanceCallback = (event: HistoryPerformanceEvent) => void;

export interface HistoryFetchOptions {
  concurrency?: number;
  isCancelled?: () => boolean;
  chunkTimeoutMs?: number;
  maxChunkAttempts?: number;
  chunkRetryBaseDelayMs?: number;
  accumulator?: HistoryDataAccumulator;
}

const DEFAULT_CHUNK_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_CHUNK_ATTEMPTS = 3;
const DEFAULT_CHUNK_RETRY_BASE_DELAY_MS = 350;
const DEFAULT_ATTRIBUTE_CHUNK_MS = 6 * 60 * 60 * 1000;
const MIN_ATTRIBUTE_CHUNK_MS = 1 * 60 * 60 * 1000;
const MAX_ATTRIBUTE_CHUNK_MS = 12 * 60 * 60 * 1000;
const LIGHT_CHUNK_STATE_COUNT = 2_500;
const HEAVY_CHUNK_STATE_COUNT = 8_000;
const VERY_HEAVY_CHUNK_STATE_COUNT = 15_000;
const LIGHT_CHUNK_TOTAL_MS = 300;
const HEAVY_CHUNK_TOTAL_MS = 700;
const VERY_HEAVY_CHUNK_TOTAL_MS = 1_100;
const HEAVY_CHUNK_PROCESS_MS = 80;

function deduplicatePoints(points: HistoryPoint[]): HistoryPoint[] {
  if (points.length <= 2) return points;

  const result: HistoryPoint[] = [points[0]];

  for (let i = 1; i < points.length - 1; i++) {
    const curr = points[i];
    const prev = points[i - 1];
    const next = points[i + 1];

    if (curr.value !== prev.value || next.value !== curr.value) {
      result.push(curr);
    }
  }

  result.push(points[points.length - 1]);

  return result;
}

export interface HistoryState {
  entity_id?: string;
  state?: string;
  s?: string;
  last_changed?: string;
  last_updated?: string;
  lu?: number;
  attributes?: Record<string, unknown>;
  a?: Record<string, unknown>;
}

type HistoryResponse = HistoryState[][] | Record<string, HistoryState[]>;

class HistoryChunkTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`History chunk timed out after ${timeoutMs}ms`);
    this.name = "HistoryChunkTimeoutError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPath(source: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), source);
}

function attributeDisplayName(path: string[]): string {
  return path[path.length - 1] ?? "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const status = error.status ?? error.statusCode ?? error.status_code;

  return typeof status === "number" ? status : undefined;
}

function errorCode(error: unknown): string {
  if (!isRecord(error)) {
    return "";
  }

  const code = error.code;

  return typeof code === "string" ? code.toLowerCase() : "";
}

function isRetryableHistoryError(error: unknown): boolean {
  if (error instanceof HistoryChunkTimeoutError) {
    return true;
  }

  const status = errorStatus(error);
  if (status !== undefined) {
    return status === 408 || status === 429 || status >= 500;
  }

  const message = errorMessage(error).toLowerCase();
  const code = errorCode(error);
  const retryableText = `${code} ${message}`;

  return retryableText.includes("timeout")
    || retryableText.includes("timed out")
    || retryableText.includes("network")
    || retryableText.includes("failed to fetch")
    || retryableText.includes("connection")
    || retryableText.includes("temporarily unavailable")
    || retryableText.includes("unavailable")
    || retryableText.includes("aborted");
}

function jitteredBackoff(attempt: number, baseDelayMs: number): number {
  const jitterMs = Math.floor(Math.random() * Math.max(1, baseDelayMs));

  return baseDelayMs * 2 ** Math.max(0, attempt - 1) + jitterMs;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function yieldToBrowser(timeoutMs = 80): Promise<void> {
  const idle = (globalThis as typeof globalThis & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  }).requestIdleCallback;

  if (idle) {
    return new Promise((resolve) => idle(() => resolve(), { timeout: timeoutMs }));
  }

  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

async function withChunkTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new HistoryChunkTimeoutError(timeoutMs)), timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

export function valueType(value: unknown): HistoryValueType | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return "number";
  }

  if (typeof value === "boolean") {
    return "boolean";
  }

  if (typeof value === "string" && value !== "") {
    return "string";
  }

  return undefined;
}

export function entityStateSource(entity: HassEntity): HistorySource | undefined {
  const type = valueType(Number.isFinite(Number(entity.state)) ? Number(entity.state) : entity.state);
  const unit = entity.attributes.unit_of_measurement;

  if (!type) {
    return undefined;
  }

  return {
    id: `state:${entity.entity_id}`,
    kind: "entity_state",
    entityId: entity.entity_id,
    label: entity.attributes.friendly_name && typeof entity.attributes.friendly_name === "string" ? entity.attributes.friendly_name : entity.entity_id,
    valueType: type,
    unit: type === "number" && typeof unit === "string" && unit !== "" ? unit : undefined
  };
}

export function attributeSource(entity: HassEntity, path: string[], label?: string): HistorySource | undefined {
  const value = readPath(entity.attributes, path);
  const numericStringValue = typeof value === "string" && Number.isFinite(Number(value)) ? Number(value) : value;
  const type = valueType(numericStringValue);

  if (!type) {
    return undefined;
  }

  return {
    id: `attr:${entity.entity_id}:${path.join(".")}`,
    kind: "entity_attribute",
    entityId: entity.entity_id,
    label: label ?? attributeDisplayName(path),
    path,
    valueType: type
  };
}

function normalizeValue(value: unknown, type: HistoryValueType): number | string | boolean | undefined {
  if (type === "number") {
    return asNumber(value);
  }

  if (type === "boolean") {
    return typeof value === "boolean" ? value : undefined;
  }

  return asString(value);
}

function valueFromState(state: HistoryState, source: HistorySource): number | string | boolean | undefined {
  const attributes = state.attributes ?? state.a ?? {};
  const raw = source.kind === "entity_state" ? state.state ?? state.s : readPath(attributes, source.path ?? []);

  return normalizeValue(raw, source.valueType);
}

function timeFromState(state: HistoryState): number {
  if (typeof state.lu === "number") {
    return state.lu * 1000;
  }

  const timestamp = state.last_changed ?? state.last_updated;

  return timestamp ? Date.parse(timestamp) : Number.NaN;
}

function extendPoints(points: HistoryPoint[], start: Date, end: Date): HistoryPoint[] {
  if (points.length === 0) {
    return points;
  }

  const startTime = start.getTime();
  const effectiveEnd = Math.min(end.getTime(), Date.now());
  const sorted = [...points].sort((left, right) => left.time - right.time);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  return [
    ...(first.time > startTime ? [{ time: startTime, value: first.value }] : []),
    ...sorted,
    ...(last.time < effectiveEnd ? [{ time: effectiveEnd, value: last.value }] : [])
  ];
}

function statesByEntity(history: HistoryResponse, entityIds: string[]): Map<string, HistoryState[]> {
  const result = new Map<string, HistoryState[]>();

  if (Array.isArray(history)) {
    history.forEach((entityStates, index) => {
      const entityId = entityStates[0]?.entity_id ?? entityIds[index];

      if (entityId) {
        result.set(entityId, entityStates);
      }
    });

    return result;
  }

  for (const [entityId, entityStates] of Object.entries(history)) {
    if (Array.isArray(entityStates)) {
      result.set(entityId, entityStates);
    }
  }

  return result;
}

export function currentSourcePoint(
  hass: HomeAssistant,
  source: HistorySource,
  fallbackTime = Date.now()
): HistoryPoint | undefined {
  const entity = hass.states[source.entityId];

  if (!entity) {
    return undefined;
  }

  const state: HistoryState = {
    entity_id: entity.entity_id,
    state: entity.state,
    last_changed: entity.last_changed,
    last_updated: entity.last_updated,
    attributes: entity.attributes
  };
  const value = valueFromState(state, source);
  const entityTime = timeFromState(state);
  const time = Number.isFinite(entityTime) ? entityTime : fallbackTime;

  return value === undefined || !Number.isFinite(time) ? undefined : { time, value };
}

function currentPoint(hass: HomeAssistant, source: HistorySource, start: Date, end: Date): HistoryPoint[] {
  const point = currentSourcePoint(hass, source, start.getTime());

  if (!point) {
    return [];
  }

  return [
    { time: start.getTime(), value: point.value },
    { time: Math.min(end.getTime(), Date.now()), value: point.value }
  ];
}

type HistoryCoverageKind = "state" | "full";

interface HistoryCoverageInterval {
  startTime: number;
  endTime: number;
}

interface HistoryEntityAccumulator {
  states: HistoryState[];
  stateCoverage: HistoryCoverageInterval[];
  fullCoverage: HistoryCoverageInterval[];
}

export class HistoryDataAccumulator {
  private readonly _entities = new Map<string, HistoryEntityAccumulator>();

  hasStates(entityId: string): boolean {
    return (this._entities.get(entityId)?.states.length ?? 0) > 0;
  }

  hasFullStates(entityId: string): boolean {
    const entity = this._entities.get(entityId);

    return entity !== undefined && entity.fullCoverage.length > 0 && entity.states.length > 0;
  }

  hasCoverage(entityId: string, start: Date, end: Date, kind: HistoryCoverageKind): boolean {
    const entity = this._entities.get(entityId);
    if (!entity) return false;

    const intervals = kind === "full"
      ? entity.fullCoverage
      : [...entity.stateCoverage, ...entity.fullCoverage];

    return coversRange(intervals, start.getTime(), end.getTime());
  }

  missingIntervals(entityId: string, start: Date, end: Date, kind: HistoryCoverageKind): Array<{ start: Date; end: Date }> {
    const entity = this._entities.get(entityId);
    const intervals = entity
      ? kind === "full"
        ? entity.fullCoverage
        : [...entity.stateCoverage, ...entity.fullCoverage]
      : [];

    return missingRanges(intervals, start.getTime(), end.getTime()).map((range) => ({
      start: new Date(range.startTime),
      end: new Date(range.endTime)
    }));
  }

  integrate(entityId: string, states: HistoryState[], start: Date, end: Date, kind: HistoryCoverageKind): void {
    const entity = this._entities.get(entityId) ?? {
      states: [],
      stateCoverage: [],
      fullCoverage: []
    };

    entity.states = deduplicateStates([...entity.states, ...states]);
    entity.stateCoverage = mergeCoverage([...entity.stateCoverage, { startTime: start.getTime(), endTime: end.getTime() }]);

    if (kind === "full") {
      entity.fullCoverage = mergeCoverage([...entity.fullCoverage, { startTime: start.getTime(), endTime: end.getTime() }]);
    }

    this._entities.set(entityId, entity);
  }

  buildSeries(source: HistorySource, hass: HomeAssistant, start: Date, end: Date): HistorySeries {
    const kind = source.kind === "entity_attribute" ? "full" : "state";
    const coveredEnd = this.coverageEnd(source.entityId, start, end, kind);

    return buildSeries(source, this._entities.get(source.entityId)?.states ?? [], hass, start, new Date(coveredEnd));
  }

  private coverageEnd(entityId: string, start: Date, end: Date, kind: HistoryCoverageKind): number {
    const entity = this._entities.get(entityId);
    if (!entity) return end.getTime();

    const intervals = kind === "full"
      ? entity.fullCoverage
      : [...entity.stateCoverage, ...entity.fullCoverage];

    return coveredRangeEnd(intervals, start.getTime(), end.getTime());
  }
}

function mergeCoverage(intervals: HistoryCoverageInterval[]): HistoryCoverageInterval[] {
  const sorted = intervals
    .filter((interval) => interval.endTime > interval.startTime)
    .sort((left, right) => left.startTime - right.startTime);
  const merged: HistoryCoverageInterval[] = [];

  for (const interval of sorted) {
    const last = merged[merged.length - 1];

    if (last && interval.startTime <= last.endTime + 1) {
      last.endTime = Math.max(last.endTime, interval.endTime);
    } else {
      merged.push({ ...interval });
    }
  }

  return merged;
}

function coversRange(intervals: HistoryCoverageInterval[], startTime: number, endTime: number): boolean {
  return coveredRangeEnd(intervals, startTime, endTime) >= endTime - 1;
}

function coveredRangeEnd(intervals: HistoryCoverageInterval[], startTime: number, endTime: number): number {
  if (endTime <= startTime) return endTime;

  let cursor = startTime;

  for (const interval of mergeCoverage(intervals)) {
    if (interval.endTime < cursor) continue;
    if (interval.startTime > cursor + 1) break;

    cursor = Math.max(cursor, interval.endTime);
    if (cursor >= endTime - 1) return endTime;
  }

  return cursor;
}

function missingRanges(intervals: HistoryCoverageInterval[], startTime: number, endTime: number): HistoryCoverageInterval[] {
  if (endTime <= startTime) return [];

  const missing: HistoryCoverageInterval[] = [];
  let cursor = startTime;

  for (const interval of mergeCoverage(intervals)) {
    if (interval.endTime <= cursor) continue;

    if (interval.startTime > cursor + 1) {
      missing.push({ startTime: cursor, endTime: Math.min(interval.startTime, endTime) });
    }

    cursor = Math.max(cursor, interval.endTime);
    if (cursor >= endTime) break;
  }

  if (cursor < endTime) {
    missing.push({ startTime: cursor, endTime });
  }

  return missing;
}

function deduplicateStates(states: HistoryState[]): HistoryState[] {
  const byTime = new Map<number, HistoryState>();

  for (const state of states) {
    const time = timeFromState(state);
    if (Number.isFinite(time)) {
      byTime.set(time, state);
    }
  }

  return [...byTime.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, state]) => state);
}

function nextAdaptiveAttributeChunkMs(
  currentChunkMs: number,
  metrics: {
    stateCount: number;
    requestDurationMs: number;
    normalizeDurationMs: number;
    mergeDurationMs: number;
    buildDurationMs: number;
  }
): { nextChunkMs: number; reason: "increase" | "decrease" | "keep" } {
  const processingDurationMs = metrics.normalizeDurationMs + metrics.mergeDurationMs + metrics.buildDurationMs;
  const isVeryHeavy = metrics.stateCount >= VERY_HEAVY_CHUNK_STATE_COUNT
    || metrics.requestDurationMs >= VERY_HEAVY_CHUNK_TOTAL_MS;
  const isHeavy = isVeryHeavy
    || metrics.stateCount >= HEAVY_CHUNK_STATE_COUNT
    || metrics.requestDurationMs >= HEAVY_CHUNK_TOTAL_MS
    || processingDurationMs >= HEAVY_CHUNK_PROCESS_MS;
  const isLight = metrics.stateCount <= LIGHT_CHUNK_STATE_COUNT
    && metrics.requestDurationMs <= LIGHT_CHUNK_TOTAL_MS
    && processingDurationMs <= HEAVY_CHUNK_PROCESS_MS / 2;

  if (isHeavy && currentChunkMs > MIN_ATTRIBUTE_CHUNK_MS) {
    const divisor = isVeryHeavy ? 4 : 2;
    return {
      nextChunkMs: Math.max(MIN_ATTRIBUTE_CHUNK_MS, Math.floor(currentChunkMs / divisor)),
      reason: "decrease"
    };
  }

  if (isLight && currentChunkMs < MAX_ATTRIBUTE_CHUNK_MS) {
    return {
      nextChunkMs: Math.min(MAX_ATTRIBUTE_CHUNK_MS, currentChunkMs * 2),
      reason: "increase"
    };
  }

  return { nextChunkMs: currentChunkMs, reason: "keep" };
}

async function fetchHistoryBatch(
  hass: HomeAssistant,
  entityIds: string[],
  start: Date,
  end: Date,
  minimalResponse: boolean,
  noAttributes: boolean,
  significantChangesOnly: boolean
): Promise<HistoryResponse> {
  if (hass.callWS) {
    return hass.callWS<HistoryResponse>({
      type: "history/history_during_period",
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      entity_ids: entityIds,
      minimal_response: minimalResponse,
      no_attributes: noAttributes,
      significant_changes_only: significantChangesOnly
    });
  }

  const params = new URLSearchParams({
    filter_entity_id: entityIds.join(","),
    end_time: end.toISOString()
  });

  if (minimalResponse) params.set("minimal_response", "1");
  if (noAttributes) params.set("no_attributes", "1");
  if (significantChangesOnly) params.set("significant_changes_only", "1");

  return hass.callApi!("GET",
    `history/period/${encodeURIComponent(start.toISOString())}?${params.toString()}`
  );
}

async function fetchHistoryChunkWithRetry(
  fetchChunk: () => Promise<HistoryResponse>,
  options: {
    taskId: string;
    timeoutMs: number;
    maxAttempts: number;
    retryBaseDelayMs: number;
    isCancelled?: () => boolean;
    onPerformance?: HistoryPerformanceCallback;
  }
): Promise<HistoryResponse> {
  let attempt = 1;

  while (true) {
    if (options.isCancelled?.()) {
      throw new Error("History request cancelled");
    }

    const attemptStart = options.onPerformance ? performanceNow() : 0;

    try {
      options.onPerformance?.({
        event: "history.chunk_attempt",
        details: {
          taskId: options.taskId,
          attempt,
          maxAttempts: options.maxAttempts,
          timeoutMs: options.timeoutMs
        }
      });

      const response = await withChunkTimeout(fetchChunk(), options.timeoutMs);

      options.onPerformance?.({
        event: "history.chunk_success",
        details: {
          taskId: options.taskId,
          attempt,
          durationMs: Math.round(performanceNow() - attemptStart)
        }
      });

      return response;
    } catch (error) {
      const retryable = isRetryableHistoryError(error);
      const canRetry = retryable && attempt < options.maxAttempts && !options.isCancelled?.();

      options.onPerformance?.({
        event: canRetry ? "history.chunk_retry" : "history.chunk_error",
        details: {
          taskId: options.taskId,
          attempt,
          maxAttempts: options.maxAttempts,
          retryable,
          error: errorMessage(error),
          durationMs: Math.round(performanceNow() - attemptStart)
        }
      });

      if (!canRetry) {
        throw error;
      }

      await sleep(jitteredBackoff(attempt, options.retryBaseDelayMs));
      attempt += 1;
    }
  }
}

export async function fetchHistory(
  hass: HomeAssistant,
  sources: HistorySource[],
  start: Date,
  end: Date,
  onProgress?: (series: HistorySeries[], changedSourceIds: string[]) => void,
  onPerformance?: HistoryPerformanceCallback,
  options: HistoryFetchOptions = {}
): Promise<HistorySeries[]> {
  if (!hass.callWS && !hass.callApi) {
    throw new Error("Home Assistant history API is unavailable");
  }

  const allEntityIds = [...new Set(sources.map((source) => source.entityId))];

  const stateEntityIds = new Set(
    sources
      .filter((s) => s.kind === "entity_state")
      .map((s) => s.entityId)
  );
  const attrEntityIds = new Set(
    sources
      .filter((s) => s.kind === "entity_attribute")
      .map((s) => s.entityId)
  );

  const stateIds = allEntityIds.filter((id) => stateEntityIds.has(id));
  const attrIds = allEntityIds.filter((id) => attrEntityIds.has(id));

  interface Batch extends HistoryQueueTask<HistoryResponse> {
    entityIds: string[];
    start: Date;
    end: Date;
    coverageKind: HistoryCoverageKind;
  }

  const accumulator = options.accumulator ?? new HistoryDataAccumulator();
  const batches: Batch[] = [];
  const chunkTimeoutMs = Math.max(1, Math.floor(options.chunkTimeoutMs ?? DEFAULT_CHUNK_TIMEOUT_MS));
  const maxChunkAttempts = Math.max(1, Math.floor(options.maxChunkAttempts ?? DEFAULT_MAX_CHUNK_ATTEMPTS));
  const chunkRetryBaseDelayMs = Math.max(0, Math.floor(options.chunkRetryBaseDelayMs ?? DEFAULT_CHUNK_RETRY_BASE_DELAY_MS));
  const runChunk = (taskId: string, fetchChunk: () => Promise<HistoryResponse>): Promise<HistoryResponse> =>
    fetchHistoryChunkWithRetry(fetchChunk, {
      taskId,
      timeoutMs: chunkTimeoutMs,
      maxAttempts: maxChunkAttempts,
      retryBaseDelayMs: chunkRetryBaseDelayMs,
      isCancelled: options.isCancelled,
      onPerformance
    });
  const groupedBatches = new Map<string, {
    entityIds: string[];
    start: Date;
    end: Date;
    coverageKind: HistoryCoverageKind;
    minimalResponse: boolean;
    noAttributes: boolean;
    significantChangesOnly: boolean;
  }>();
  const addBatch = (
    entityId: string,
    batchStart: Date,
    batchEnd: Date,
    coverageKind: HistoryCoverageKind,
    minimalResponse: boolean,
    noAttributes: boolean,
    significantChangesOnly: boolean
  ): void => {
    const key = [
      coverageKind,
      batchStart.toISOString(),
      batchEnd.toISOString(),
      minimalResponse ? "minimal" : "full",
      noAttributes ? "noattr" : "attrs",
      significantChangesOnly ? "significant" : "all"
    ].join("|");
    const existing = groupedBatches.get(key);

    if (existing) {
      existing.entityIds.push(entityId);
    } else {
      groupedBatches.set(key, {
        entityIds: [entityId],
        start: batchStart,
        end: batchEnd,
        coverageKind,
        minimalResponse,
        noAttributes,
        significantChangesOnly
      });
    }
  };
  const attributeIntervals: Array<{ entityId: string; start: Date; end: Date }> = [];

  for (const entityId of stateIds) {
    for (const interval of accumulator.missingIntervals(entityId, start, end, "state")) {
      addBatch(entityId, interval.start, interval.end, "state", true, true, true);
    }
  }

  for (const entityId of attrIds) {
    for (const interval of accumulator.missingIntervals(entityId, start, end, "full")) {
      attributeIntervals.push({ entityId, start: interval.start, end: interval.end });
    }
  }

  const estimatedAttributeBatchCount = attributeIntervals.reduce((total, interval) => {
    const span = interval.end.getTime() - interval.start.getTime();

    return total + Math.max(1, Math.ceil(span / DEFAULT_ATTRIBUTE_CHUNK_MS));
  }, 0);

  const estimatedBatchCount = groupedBatches.size + estimatedAttributeBatchCount;

  type ProcessBatch = {
    id: string;
    entityIds: string[];
    start: Date;
    end: Date;
    coverageKind: HistoryCoverageKind;
  };

  type ProcessedBatchMetrics = {
    stateCount: number;
    requestDurationMs: number;
    normalizeDurationMs: number;
    mergeDurationMs: number;
    buildDurationMs: number;
  };

  let processedBatchCount = 0;
  const fetchedEntityIds = new Set<string>();

  const processBatchResult = async (
    batch: ProcessBatch,
    response: HistoryResponse,
    batchDurationMs: number
  ): Promise<ProcessedBatchMetrics> => {
    const batchIndex = processedBatchCount;
    processedBatchCount += 1;

    if (options.isCancelled?.()) {
      return {
        stateCount: 0,
        requestDurationMs: Math.round(batchDurationMs),
        normalizeDurationMs: 0,
        mergeDurationMs: 0,
        buildDurationMs: 0
      };
    }

    await yieldToBrowser();

    const normalizeStart = performanceNow();
    const batchMap = statesByEntity(response, batch.entityIds);
    const normalizeDurationMs = performanceNow() - normalizeStart;
    const stateCount = [...batchMap.values()].reduce((total, states) => total + states.length, 0);

    onPerformance?.({
      event: "history.batch",
      details: {
        batchIndex,
        batchCount: estimatedBatchCount,
        entityCount: batch.entityIds.length,
        stateCount,
        requestDurationMs: Math.round(batchDurationMs),
        normalizeDurationMs: Math.round(normalizeDurationMs)
      }
    });

    const mergeStart = performanceNow();
    const changedEntityIds = new Set<string>();
    for (const [entityId, states] of batchMap) {
      accumulator.integrate(entityId, states, batch.start, batch.end, batch.coverageKind);
      changedEntityIds.add(entityId);
      fetchedEntityIds.add(entityId);
    }
    const mergeDurationMs = performanceNow() - mergeStart;

    onPerformance?.({
      event: "history.merge",
      details: {
        batchIndex,
        entityCount: batch.entityIds.length,
        stateCount,
        mergeDurationMs: Math.round(mergeDurationMs)
      }
    });

    let buildDurationMs = 0;

    if (onProgress) {
      await yieldToBrowser();

      const buildStart = performanceNow();
      const changedSourceIds = new Set<string>();
      for (const source of sources) {
        const sourceMatchesBatch = batch.coverageKind === "full"
          ? source.kind === "entity_attribute"
          : source.kind === "entity_state";

        if ((sourceMatchesBatch && changedEntityIds.has(source.entityId)) || !seriesBySourceId.has(source.id)) {
          if (source.kind === "entity_attribute" ? accumulator.hasFullStates(source.entityId) : accumulator.hasStates(source.entityId)) {
            seriesBySourceId.set(source.id, accumulator.buildSeries(source, hass, start, end));
            changedSourceIds.add(source.id);
          }
        }
      }
      const progressSeries = sources
        .map((source) => seriesBySourceId.get(source.id))
        .filter((series): series is HistorySeries => series !== undefined);
      buildDurationMs = performanceNow() - buildStart;

      onPerformance?.({
        event: "history.progress_series",
        details: {
          batchIndex,
          seriesCount: progressSeries.length,
          pointCount: progressSeries.reduce((total, series) => total + series.points.length, 0),
          buildDurationMs: Math.round(buildDurationMs)
        }
      });

      onProgress(progressSeries, [...changedSourceIds]);

      await yieldToBrowser(120);
    }

    return {
      stateCount,
      requestDurationMs: Math.round(batchDurationMs),
      normalizeDurationMs: Math.round(normalizeDurationMs),
      mergeDurationMs: Math.round(mergeDurationMs),
      buildDurationMs: Math.round(buildDurationMs)
    };
  };

  for (const batch of groupedBatches.values()) {
    const prefix = batch.coverageKind === "full" ? "attr" : "state";
    const entityIds = [...new Set(batch.entityIds)];
    const id = `${prefix}:${entityIds.join(",")}:${batch.start.toISOString()}:${batch.end.toISOString()}`;

    batches.push({
      id,
      entityIds,
      start: batch.start,
      end: batch.end,
      coverageKind: batch.coverageKind,
      run: () => runChunk(id, () => fetchHistoryBatch(
        hass,
        entityIds,
        batch.start,
        batch.end,
        batch.minimalResponse,
        batch.noAttributes,
        batch.significantChangesOnly
      ))
    });
  }

  onPerformance?.({
    event: "history.start",
    details: {
      sourceCount: sources.length,
      entityCount: allEntityIds.length,
      batchCount: estimatedBatchCount,
      attributeChunkHours: DEFAULT_ATTRIBUTE_CHUNK_MS / 3_600_000,
      minAttributeChunkHours: MIN_ATTRIBUTE_CHUNK_MS / 3_600_000,
      maxAttributeChunkHours: MAX_ATTRIBUTE_CHUNK_MS / 3_600_000,
      adaptiveAttributeChunks: attributeIntervals.length > 0,
      cachedSourceCount: sources.filter((source) =>
        accumulator.hasCoverage(source.entityId, start, end, source.kind === "entity_attribute" ? "full" : "state")
      ).length,
      chunkTimeoutMs,
      maxChunkAttempts,
      rangeHours: Math.round((end.getTime() - start.getTime()) / 36_000) / 100
    }
  });

  const seriesBySourceId = new Map<string, HistorySeries>();
  for (const source of sources) {
    if (source.kind === "entity_attribute" ? accumulator.hasFullStates(source.entityId) : accumulator.hasStates(source.entityId)) {
      seriesBySourceId.set(source.id, accumulator.buildSeries(source, hass, start, end));
    }
  }

  await runHistoryQueue<HistoryResponse, Batch>(batches, {
    concurrency: options.concurrency ?? 1,
    isCancelled: options.isCancelled,
    onEvent: (event) => {
      onPerformance?.({
        event: `history.${event.event}`,
        details: {
          taskId: event.taskId,
          queuedCount: event.queuedCount,
          activeCount: event.activeCount,
          completedCount: event.completedCount
        }
      });
    },
    onResult: async ({ task: batch, value: response, durationMs: batchDurationMs }) => {
      await processBatchResult(batch, response, batchDurationMs);
    }
  });

  let completedAttributeChunks = 0;
  for (const interval of attributeIntervals) {
    let chunkMs = DEFAULT_ATTRIBUTE_CHUNK_MS;

    for (let t = interval.start.getTime(); t < interval.end.getTime();) {
      if (options.isCancelled?.()) {
        break;
      }

      const chunkStart = new Date(t);
      const chunkEnd = new Date(Math.min(t + chunkMs, interval.end.getTime()));
      const actualChunkMs = chunkEnd.getTime() - chunkStart.getTime();
      const taskId = `attr:${interval.entityId}:${chunkStart.toISOString()}:${chunkEnd.toISOString()}`;

      onPerformance?.({
        event: "history.queue.task_start",
        details: {
          taskId,
          queuedCount: undefined,
          activeCount: 1,
          completedCount: completedAttributeChunks
        }
      });

      const requestStart = performanceNow();
      const response = await runChunk(taskId, () => fetchHistoryBatch(
        hass,
        [interval.entityId],
        chunkStart,
        chunkEnd,
        false,
        false,
        false
      ));
      const requestDurationMs = performanceNow() - requestStart;
      completedAttributeChunks += 1;

      onPerformance?.({
        event: "history.queue.task_complete",
        details: {
          taskId,
          queuedCount: undefined,
          activeCount: 0,
          completedCount: completedAttributeChunks
        }
      });

      const metrics = await processBatchResult({
        id: taskId,
        entityIds: [interval.entityId],
        start: chunkStart,
        end: chunkEnd,
        coverageKind: "full"
      }, response, requestDurationMs);
      const adaptive = nextAdaptiveAttributeChunkMs(chunkMs, metrics);

      onPerformance?.({
        event: "history.adaptive_chunk",
        details: {
          taskId,
          entityId: interval.entityId,
          chunkHours: Math.round(actualChunkMs / 36_000) / 100,
          nextChunkHours: Math.round(adaptive.nextChunkMs / 36_000) / 100,
          stateCount: metrics.stateCount,
          requestDurationMs: metrics.requestDurationMs,
          processingDurationMs: metrics.normalizeDurationMs + metrics.mergeDurationMs + metrics.buildDurationMs,
          reason: adaptive.reason
        }
      });

      chunkMs = adaptive.nextChunkMs;
      t = chunkEnd.getTime();
    }
  }

  const finalBuildStart = onPerformance ? performanceNow() : 0;
  const finalSeries = sources.map((source) => {
    const existing = seriesBySourceId.get(source.id);
    if (existing && !fetchedEntityIds.has(source.entityId)) {
      return existing;
    }

    return accumulator.buildSeries(source, hass, start, end);
  });
  const finalBuildDurationMs = onPerformance ? performanceNow() - finalBuildStart : 0;

  onPerformance?.({
    event: "history.final_series",
    details: {
      seriesCount: finalSeries.length,
      pointCount: finalSeries.reduce((total, series) => total + series.points.length, 0),
      buildDurationMs: Math.round(finalBuildDurationMs)
    }
  });

  return finalSeries;
}

function buildSeries(
  source: HistorySource,
  states: HistoryState[],
  hass: HomeAssistant,
  start: Date,
  end: Date
): HistorySeries {
  const points = states.flatMap((state) => {
    const value = valueFromState(state, source);
    const time = timeFromState(state);

    return value !== undefined && Number.isFinite(time) ? [{ time, value }] : [];
  });

  const raw = points.length > 0 ? extendPoints(points, start, end) : currentPoint(hass, source, start, end);

  return {
    source,
    points: deduplicatePoints(raw)
  };
}

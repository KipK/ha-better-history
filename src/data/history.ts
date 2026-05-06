import type { HassEntity, HomeAssistant } from "../types/ha.js";
import type { HistorySourceKind, HistoryValueType } from "./value-type.js";
import { asNumber, asString } from "./format.js";
import { performanceNow, type PerformanceDetails } from "../utils/performance.js";

export type { HistoryValueType, HistorySourceKind };

export interface HistorySource {
  id: string;
  kind: HistorySourceKind;
  entityId: string;
  label: string;
  path?: string[];
  valueType: HistoryValueType;
  unit?: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPath(source: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), source);
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
  const type = valueType(value);

  if (!type) {
    return undefined;
  }

  return {
    id: `attr:${entity.entity_id}:${path.join(".")}`,
    kind: "entity_attribute",
    entityId: entity.entity_id,
    label: label ?? path.join("."),
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

function currentPoint(hass: HomeAssistant, source: HistorySource, start: Date, end: Date): HistoryPoint[] {
  const entity = hass.states[source.entityId];

  if (!entity) {
    return [];
  }

  const state: HistoryState = {
    entity_id: entity.entity_id,
    state: entity.state,
    last_changed: start.toISOString(),
    attributes: entity.attributes
  };
  const value = valueFromState(state, source);

  return value === undefined
    ? []
    : [
        { time: start.getTime(), value },
        { time: Math.min(end.getTime(), Date.now()), value }
      ];
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

export async function fetchHistory(
  hass: HomeAssistant,
  sources: HistorySource[],
  start: Date,
  end: Date,
  onProgress?: (series: HistorySeries[]) => void,
  onPerformance?: HistoryPerformanceCallback
): Promise<HistorySeries[]> {
  if (!hass.callWS && !hass.callApi) {
    throw new Error("Home Assistant history API is unavailable");
  }

  const allEntityIds = [...new Set(sources.map((source) => source.entityId))];

  const attrEntityIds = new Set(
    sources
      .filter((s) => s.kind === "entity_attribute")
      .map((s) => s.entityId)
  );

  const stateOnlyIds = allEntityIds.filter((id) => !attrEntityIds.has(id));
  const attrIds = allEntityIds.filter((id) => attrEntityIds.has(id));

  interface Batch {
    entityIds: string[];
    end: Date;
    data: () => Promise<HistoryResponse>;
  }

  const batches: Batch[] = [];

  if (stateOnlyIds.length > 0) {
    batches.push({
      entityIds: stateOnlyIds,
      end,
      data: () => fetchHistoryBatch(hass, stateOnlyIds, start, end, true, true, true)
    });
  }

  if (attrIds.length > 0) {
    const CHUNK_MS = 24 * 60 * 60 * 1000;
    const span = end.getTime() - start.getTime();

    if (span > CHUNK_MS) {
      for (let t = start.getTime(); t < end.getTime(); t += CHUNK_MS) {
        const chunkStart = new Date(t);
        const chunkEnd = new Date(Math.min(t + CHUNK_MS, end.getTime()));
        batches.push({
          entityIds: attrIds,
          end: chunkEnd,
          data: () => fetchHistoryBatch(hass, attrIds, chunkStart, chunkEnd, false, false, false)
        });
      }
    } else {
      batches.push({
        entityIds: attrIds,
        end,
        data: () => fetchHistoryBatch(hass, attrIds, start, end, false, false, false)
      });
    }
  }

  onPerformance?.({
    event: "history.start",
    details: {
      sourceCount: sources.length,
      entityCount: allEntityIds.length,
      batchCount: batches.length,
      rangeHours: Math.round((end.getTime() - start.getTime()) / 36_000) / 100
    }
  });

  const allStates = new Map<string, HistoryState[]>();
  const entityDataEnd = new Map<string, Date>();

  for (const [batchIndex, batch] of batches.entries()) {
    const batchStart = onPerformance ? performanceNow() : 0;
    const response = await batch.data();
    const batchDurationMs = onPerformance ? performanceNow() - batchStart : 0;

    // Defer processing so the browser can handle events between network IO
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const normalizeStart = onPerformance ? performanceNow() : 0;
    const batchMap = statesByEntity(response, batch.entityIds);
    const normalizeDurationMs = onPerformance ? performanceNow() - normalizeStart : 0;
    const stateCount = onPerformance ? [...batchMap.values()].reduce((total, states) => total + states.length, 0) : 0;

    onPerformance?.({
      event: "history.batch",
      details: {
        batchIndex,
        batchCount: batches.length,
        entityCount: batch.entityIds.length,
        stateCount,
        requestDurationMs: Math.round(batchDurationMs),
        normalizeDurationMs: Math.round(normalizeDurationMs)
      }
    });

    const mergeStart = onPerformance ? performanceNow() : 0;
    for (const [entityId, states] of batchMap) {
      const existing = allStates.get(entityId);
      if (existing) {
        existing.push(...states);
      } else {
        allStates.set(entityId, states);
      }
    }

    for (const entityId of batch.entityIds) {
      entityDataEnd.set(entityId, batch.end);
    }
    const mergeDurationMs = onPerformance ? performanceNow() - mergeStart : 0;

    onPerformance?.({
      event: "history.merge",
      details: {
        batchIndex,
        entityCount: batch.entityIds.length,
        stateCount,
        mergeDurationMs: Math.round(mergeDurationMs)
      }
    });

    if (onProgress) {
      const buildStart = onPerformance ? performanceNow() : 0;
      const progressSeries = (
        sources
          .filter((source) => (allStates.get(source.entityId)?.length ?? 0) > 0)
          .map((source) => buildSeries(source, allStates.get(source.entityId) ?? [], hass, start, entityDataEnd.get(source.entityId) ?? end))
      );
      const buildDurationMs = onPerformance ? performanceNow() - buildStart : 0;

      onPerformance?.({
        event: "history.progress_series",
        details: {
          batchIndex,
          seriesCount: progressSeries.length,
          pointCount: progressSeries.reduce((total, series) => total + series.points.length, 0),
          buildDurationMs: Math.round(buildDurationMs)
        }
      });

      onProgress(progressSeries);

      await new Promise<void>((resolve) => {
        const raf = requestAnimationFrame(() => resolve());
        setTimeout(() => {
          cancelAnimationFrame(raf);
          resolve();
        }, 120);
      });
    }
  }

  const finalBuildStart = onPerformance ? performanceNow() : 0;
  const finalSeries = sources.map((source) => buildSeries(source, allStates.get(source.entityId) ?? [], hass, start, end));
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

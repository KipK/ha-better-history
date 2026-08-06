import type { HistorySource } from "./history.js";
import type {
  BetterHistoryConfig,
  BetterHistoryLineMode,
  BetterHistoryRuntimeConfigSnapshot,
  BetterHistorySnapshotRange,
  SeriesConfig,
} from "../types/config.js";

interface DateRange {
  start: Date;
  end: Date;
}

export interface RuntimeConfigSnapshotInput {
  config?: BetterHistoryConfig;
  entities?: string[];
  targetSources: HistorySource[];
  selectedSources: HistorySource[];
  pendingSources: HistorySource[];
  removedConfigSourceIds: string[];
  scalePreferences: Record<string, "auto" | "primary" | "secondary">;
  rollingRelativeRange: boolean;
  viewRangeZoomed: boolean;
  hours?: number;
  viewRange: DateRange;
  loadedRange: DateRange;
  runtimeLineMode?: BetterHistoryLineMode;
  lineMode?: BetterHistoryLineMode;
  importedData: boolean;
  now?: number;
}

function attributePath(attribute: string | string[] | undefined): string | undefined {
  if (Array.isArray(attribute)) return attribute.join(".");
  return attribute;
}

function seriesId(series: Pick<SeriesConfig, "entity" | "attribute">): string {
  const path = attributePath(series.attribute);
  return path ? `attr:${series.entity}:${path}` : `state:${series.entity}`;
}

function cloneSeries(series: SeriesConfig): SeriesConfig {
  return {
    ...series,
    ...(Array.isArray(series.attribute) ? { attribute: [...series.attribute] } : {}),
  };
}

function sourceToSeries(source: HistorySource): SeriesConfig {
  const scalePreference = source.scalePreference === "primary" || source.scalePreference === "secondary"
    ? source.scalePreference
    : undefined;
  const group = source.group ?? source.scaleGroup;

  return {
    entity: source.entityId,
    ...(source.kind === "entity_attribute" && source.path?.length
      ? { attribute: source.path.join(".") }
      : {}),
    forced: true,
    label: source.label,
    ...(source.unit !== undefined ? { unit: source.unit } : {}),
    ...(group !== undefined ? { group } : {}),
    ...(scalePreference ? { scalePreference } : {}),
  };
}

export function buildRuntimeSnapshotSeries(input: Pick<RuntimeConfigSnapshotInput,
  | "config"
  | "entities"
  | "targetSources"
  | "selectedSources"
  | "pendingSources"
  | "removedConfigSourceIds"
  | "scalePreferences"
>): SeriesConfig[] {
  const configured = input.config?.series?.length
    ? input.config.series.map(cloneSeries)
    : (input.config?.defaultEntities?.length ? input.config.defaultEntities : input.entities ?? [])
      .map((entity) => ({ entity, forced: true }));
  const removed = new Set(input.removedConfigSourceIds);
  const candidates = [
    ...configured.filter((series) => !removed.has(seriesId(series))),
    ...input.targetSources.map(sourceToSeries),
    ...input.selectedSources.map(sourceToSeries),
    ...input.pendingSources.map(sourceToSeries),
  ];
  const seen = new Set<string>();
  const result: SeriesConfig[] = [];

  for (const candidate of candidates) {
    const id = seriesId(candidate);
    if (seen.has(id)) continue;
    seen.add(id);

    const cloned = cloneSeries(candidate);
    const runtimePreference = input.scalePreferences[id];
    const preference = runtimePreference === "primary" || runtimePreference === "secondary"
      ? runtimePreference
      : cloned.scalePreference;

    if (preference === "primary" || preference === "secondary") {
      cloned.scalePreference = preference;
    } else {
      delete cloned.scalePreference;
    }
    result.push(cloned);
  }

  return result;
}

function validRange(range: DateRange, now: number): DateRange | undefined {
  const start = range.start.getTime();
  const end = Math.min(range.end.getTime(), now);
  return Number.isFinite(start) && Number.isFinite(end) && end > start
    ? { start: new Date(start), end: new Date(end) }
    : undefined;
}

export function buildRuntimeSnapshotRange(input: Pick<RuntimeConfigSnapshotInput,
  "rollingRelativeRange" | "viewRangeZoomed" | "hours" | "viewRange" | "loadedRange" | "now"
>): BetterHistorySnapshotRange {
  const hours = typeof input.hours === "number" && Number.isFinite(input.hours) && input.hours > 0
    ? input.hours
    : 24;
  if (input.rollingRelativeRange && !input.viewRangeZoomed) {
    return { mode: "relative", hours };
  }

  const now = input.now ?? Date.now();
  const range = validRange(input.viewRange, now)
    ?? validRange(input.loadedRange, now)
    ?? { start: new Date(now - 24 * 60 * 60 * 1000), end: new Date(now) };

  return { mode: "absolute", startDate: range.start, endDate: range.end };
}

function validLineMode(mode: BetterHistoryLineMode | undefined): BetterHistoryLineMode | undefined {
  return mode === "stair" || mode === "line" || mode === "column" ? mode : undefined;
}

export function buildRuntimeConfigSnapshot(input: RuntimeConfigSnapshotInput): BetterHistoryRuntimeConfigSnapshot {
  return {
    series: buildRuntimeSnapshotSeries(input),
    range: buildRuntimeSnapshotRange(input),
    lineMode: validLineMode(input.runtimeLineMode)
      ?? validLineMode(input.config?.lineMode)
      ?? validLineMode(input.lineMode)
      ?? "stair",
    importedData: input.importedData,
  };
}

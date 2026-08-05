import { entityStateSource, type HistorySource } from "./history.js";
import type { HomeAssistant } from "../types/ha.js";

export type HistoryTargetValue = string | string[];

export interface HistoryTargetSelection {
  entity_id?: HistoryTargetValue;
  device_id?: HistoryTargetValue;
  area_id?: HistoryTargetValue;
  floor_id?: HistoryTargetValue;
  label_id?: HistoryTargetValue;
}

export interface NormalizedHistoryTargetSelection {
  entity_id?: string[];
  device_id?: string[];
  area_id?: string[];
  floor_id?: string[];
  label_id?: string[];
}

const TARGET_KEYS = ["entity_id", "label_id", "floor_id", "area_id", "device_id"] as const;
const GROUP_TARGET_KEYS = ["label_id", "floor_id", "area_id", "device_id"] as const;

interface ResolutionCache {
  selectionKey: string;
  entities: HomeAssistant["entities"];
  devices: HomeAssistant["devices"];
  areas: HomeAssistant["areas"];
  candidates: string[];
  explicitCount: number;
}

let resolutionCache: ResolutionCache | undefined;

function normalizedValues(value: HistoryTargetValue | undefined): string[] | undefined {
  const values = (Array.isArray(value) ? value : value === undefined ? [] : [value])
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  const unique = [...new Set(values)];
  return unique.length > 0 ? unique : undefined;
}

export function normalizeTargetSelection(value: HistoryTargetSelection | null | undefined): NormalizedHistoryTargetSelection {
  const normalized: NormalizedHistoryTargetSelection = {};
  for (const key of TARGET_KEYS) {
    const values = normalizedValues(value?.[key]);
    if (values) normalized[key] = values;
  }
  return normalized;
}

export function targetSelectionIsEmpty(value: HistoryTargetSelection | null | undefined): boolean {
  return TARGET_KEYS.every((key) => normalizedValues(value?.[key]) === undefined);
}

export function explicitTargetEntityIds(value: HistoryTargetSelection | null | undefined): string[] {
  return normalizeTargetSelection(value).entity_id ?? [];
}

export function groupedTargetWasRemoved(
  previous: HistoryTargetSelection | null | undefined,
  next: HistoryTargetSelection | null | undefined,
): boolean {
  const normalizedPrevious = normalizeTargetSelection(previous);
  const normalizedNext = normalizeTargetSelection(next);
  return GROUP_TARGET_KEYS.some((key) => {
    const nextIds = new Set(normalizedNext[key] ?? []);
    return (normalizedPrevious[key] ?? []).some((id) => !nextIds.has(id));
  });
}

function registryCandidates(
  hass: HomeAssistant,
  selection: NormalizedHistoryTargetSelection,
): { candidates: string[]; explicitCount: number } {
  const selectionKey = TARGET_KEYS.map((key) => `${key}:${(selection[key] ?? []).join(",")}`).join("|");
  if (
    resolutionCache?.selectionKey === selectionKey
    && resolutionCache.entities === hass.entities
    && resolutionCache.devices === hass.devices
    && resolutionCache.areas === hass.areas
  ) {
    return resolutionCache;
  }

  const entityIds = new Set(selection.entity_id ?? []);
  const labelIds = new Set(selection.label_id ?? []);
  const floorIds = new Set(selection.floor_id ?? []);
  const areaIds = new Set(selection.area_id ?? []);
  const deviceIds = new Set(selection.device_id ?? []);
  const explicitCount = entityIds.size;
  const areas = Object.values(hass.areas ?? {}).filter((entry) => entry !== undefined);
  const devices = Object.values(hass.devices ?? {}).filter((entry) => entry !== undefined);
  const entities = Object.values(hass.entities ?? {}).filter((entry) => entry !== undefined);

  for (const labelId of labelIds) {
    for (const area of areas) if ((area.labels ?? []).includes(labelId)) areaIds.add(area.area_id);
    for (const device of devices) if ((device.labels ?? []).includes(labelId)) deviceIds.add(device.id);
    for (const entity of entities) if ((entity.labels ?? []).includes(labelId)) entityIds.add(entity.entity_id);
  }
  for (const floorId of floorIds) {
    for (const area of areas) if (area.floor_id === floorId) areaIds.add(area.area_id);
  }
  for (const areaId of areaIds) {
    for (const device of devices) if (device.area_id === areaId) deviceIds.add(device.id);
    for (const entity of entities) if (entity.area_id === areaId) entityIds.add(entity.entity_id);
  }
  for (const deviceId of deviceIds) {
    for (const entity of entities) if (entity.device_id === deviceId) entityIds.add(entity.entity_id);
  }

  const result = { selectionKey, entities: hass.entities, devices: hass.devices, areas: hass.areas, candidates: [...entityIds], explicitCount };
  resolutionCache = result;
  return result;
}

export function resolveTargetEntityIds(
  hass: HomeAssistant,
  value: HistoryTargetSelection | null | undefined,
): string[] {
  const selection = normalizeTargetSelection(value);
  const { candidates, explicitCount } = registryCandidates(hass, selection);
  return candidates.filter((entityId, index) => index < explicitCount || hass.states[entityId] !== undefined);
}

export function targetEntitySources(
  hass: HomeAssistant,
  value: HistoryTargetSelection | null | undefined,
): HistorySource[] {
  return resolveTargetEntityIds(hass, value)
    .map((entityId) => hass.states[entityId])
    .filter((entity) => entity !== undefined)
    .map(entityStateSource)
    .filter((source): source is HistorySource => source !== undefined);
}

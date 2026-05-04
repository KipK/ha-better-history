import { attributeSource, entityStateSource, type HistorySource } from "./history.js";
import type { BetterHistoryConfig, ResolvedConfig, ResolvedSeries, SeriesConfig } from "../types/config.js";
import type { HomeAssistant } from "../types/ha.js";
import type { HistoryValueType } from "./value-type.js";

export function resolvedSeriesToSource(s: ResolvedSeries): HistorySource {
  return {
    id: s.id,
    kind: s.attribute ? "entity_attribute" : "entity_state",
    entityId: s.entity,
    label: s.label,
    path: s.attribute,
    valueType: s.valueType,
    unit: s.unit
  };
}

const DEFAULT_HOURS = 24;
const PALETTE = ["#ff9800", "#42a5f5", "#66bb6a", "#ec407a", "#ab47bc", "#26a69a"];

function paletteColor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

function normalizeAttribute(attribute: string | string[] | undefined): string[] | undefined {
  if (attribute === undefined) return undefined;

  return Array.isArray(attribute) ? attribute : attribute.split(".");
}

function seriesId(entity: string, attribute?: string[]): string {
  return attribute ? `attr:${entity}:${attribute.join(".")}` : `state:${entity}`;
}

function resolveValueType(hass: HomeAssistant | undefined, entity: string, attribute?: string[]): HistoryValueType {
  const hassEntity = hass?.states[entity];

  if (!hassEntity) return "number";

  if (!attribute) {
    return entityStateSource(hassEntity)?.valueType ?? "string";
  }

  return attributeSource(hassEntity, attribute)?.valueType ?? "string";
}

function resolveLabel(hass: HomeAssistant | undefined, entity: string, attribute?: string[], label?: string): string {
  if (label) return label;
  if (attribute) return attribute.join(".");

  const friendly = hass?.states[entity]?.attributes.friendly_name;

  return typeof friendly === "string" && friendly !== "" ? friendly : entity;
}

function resolveUnit(hass: HomeAssistant | undefined, entity: string, attribute?: string[], override?: string): string | undefined {
  if (override !== undefined) return override || undefined;
  if (attribute) return undefined;

  const unit = hass?.states[entity]?.attributes.unit_of_measurement;

  return typeof unit === "string" && unit !== "" ? unit : undefined;
}

function scaleGroupKey(id: string, unit: string | undefined, scaleGroup: string | undefined, vt: HistoryValueType): string {
  if (scaleGroup) return `group:${scaleGroup}`;
  if (vt === "number" && unit) return `unit:${unit}`;

  return `series:${id}`;
}

function seriesFromConfig(cfg: SeriesConfig, index: number, hass: HomeAssistant | undefined): ResolvedSeries {
  const attribute = normalizeAttribute(cfg.attribute);
  const id = seriesId(cfg.entity, attribute);
  const vt = resolveValueType(hass, cfg.entity, attribute);
  const unit = resolveUnit(hass, cfg.entity, attribute, cfg.unit);

  return {
    id,
    entity: cfg.entity,
    attribute,
    label: resolveLabel(hass, cfg.entity, attribute, cfg.label),
    color: cfg.color ?? paletteColor(index),
    unit,
    scaleGroupKey: scaleGroupKey(id, unit, cfg.scaleGroup, vt),
    scaleMode: cfg.scaleMode ?? "auto",
    scaleMin: cfg.scaleMin,
    scaleMax: cfg.scaleMax,
    valueType: vt
  };
}

function seriesFromEntityId(entityId: string, index: number, hass: HomeAssistant | undefined): ResolvedSeries | undefined {
  const hassEntity = hass?.states[entityId];

  if (!hassEntity) {
    const id = `state:${entityId}`;

    return {
      id,
      entity: entityId,
      label: entityId,
      color: paletteColor(index),
      scaleGroupKey: `series:${id}`,
      scaleMode: "auto",
      valueType: "number"
    };
  }

  const source = entityStateSource(hassEntity);

  if (!source) return undefined;

  return {
    id: source.id,
    entity: entityId,
    label: source.label,
    color: paletteColor(index),
    unit: source.unit,
    scaleGroupKey: scaleGroupKey(source.id, source.unit, undefined, source.valueType),
    scaleMode: "auto",
    valueType: source.valueType
  };
}

export interface ResolveConfigOpts {
  config?: BetterHistoryConfig;
  entities?: string[];
  hours?: number;
  startDate?: Date;
  endDate?: Date;
  showDatePicker?: boolean;
  showEntityPicker?: boolean;
  showLegend?: boolean;
  showTooltip?: boolean;
  width?: string;
  height?: string;
  language?: string;
  hass?: HomeAssistant;
}

export function resolveConfig(opts: ResolveConfigOpts): ResolvedConfig {
  const { config, hass } = opts;

  const endDate = config?.endDate ?? opts.endDate ?? new Date();
  const hours = config?.hours ?? opts.hours ?? DEFAULT_HOURS;
  const startDate = config?.startDate ?? opts.startDate ?? new Date(endDate.getTime() - hours * 3600000);

  let series: ResolvedSeries[];

  if (config?.series && config.series.length > 0) {
    series = config.series.map((cfg, index) => seriesFromConfig(cfg, index, hass));
  } else {
    const entityIds = config?.defaultEntities ?? opts.entities ?? [];

    series = entityIds
      .map((entityId, index) => seriesFromEntityId(entityId, index, hass))
      .filter((s): s is ResolvedSeries => s !== undefined);
  }

  return {
    startDate,
    endDate,
    showDatePicker: config?.showDatePicker ?? opts.showDatePicker ?? false,
    showEntityPicker: config?.showEntityPicker ?? opts.showEntityPicker ?? false,
    showLegend: config?.showLegend ?? opts.showLegend ?? true,
    showTooltip: config?.showTooltip ?? opts.showTooltip ?? true,
    width: config?.width ?? opts.width ?? "100%",
    height: config?.height ?? opts.height,
    language: opts.language ?? hass?.locale?.language ?? hass?.language,
    series,
    disableClimateOverlay: config?.disableClimateOverlay ?? false
  };
}

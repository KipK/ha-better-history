import { attributeSource, entityStateSource, type HistorySource } from "./history.js";
import { paletteColor, CLIMATE_ATTR_COLORS } from "../render/colors.js";
import type { AttributeUnitMap, BetterHistoryConfig, BetterHistoryLineMode, ResolvedConfig, ResolvedSeries, SeriesConfig } from "../types/config.js";
import type { HomeAssistant } from "../types/ha.js";
import type { HistoryValueType } from "./value-type.js";
import { isAttributeTemperatureUnit, unitForAttributePath } from "./attribute-units.js";

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
const DEFAULT_LINE_WIDTH = "2.5";

const CLIMATE_LINE_ATTRIBUTES = ["current_temperature", "temperature", "hvac_action"];

const TEMPERATURE_UNIT_RE = /°[CF]|[CFK]$/;

function isTemperatureUnit(unit: string): boolean {
  return TEMPERATURE_UNIT_RE.test(unit);
}

function isManualBoundedSeries(series: ResolvedSeries): boolean {
  return series.scaleMode === "manual" && (series.scaleMin !== undefined || series.scaleMax !== undefined);
}

function truncateDate(d: Date): Date {
  return new Date(Math.floor(d.getTime() / 1000) * 1000);
}

function normalizeAttribute(attribute: string | string[] | undefined): string[] | undefined {
  if (attribute === undefined) return undefined;

  return Array.isArray(attribute) ? attribute : attribute.split(".");
}

function normalizeLineMode(mode: BetterHistoryLineMode | undefined): BetterHistoryLineMode {
  return mode === "line" || mode === "column" ? mode : "stair";
}

function normalizeLineWidth(lineWidth: number | string | undefined): string {
  if (typeof lineWidth === "number") {
    return Number.isFinite(lineWidth) && lineWidth >= 0 ? String(lineWidth) : DEFAULT_LINE_WIDTH;
  }

  if (typeof lineWidth === "string" && lineWidth.trim() !== "") {
    return lineWidth.trim();
  }

  return DEFAULT_LINE_WIDTH;
}

function seriesId(entity: string, attribute?: string[]): string {
  return attribute ? `attr:${entity}:${attribute.join(".")}` : `state:${entity}`;
}

function attributeDisplayName(attribute: string[]): string {
  return attribute[attribute.length - 1] ?? "";
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
  if (attribute) return attributeDisplayName(attribute);

  const friendly = hass?.states[entity]?.attributes.friendly_name;

  return typeof friendly === "string" && friendly !== "" ? friendly : entity;
}

function resolveUnit(
  hass: HomeAssistant | undefined,
  entity: string,
  attribute?: string[],
  override?: string,
  attributeUnits?: AttributeUnitMap
): string | undefined {
  if (override !== undefined) return override || undefined;
  if (attribute) return unitForAttributePath(attribute, attributeUnits);

  const unit = hass?.states[entity]?.attributes.unit_of_measurement;

  return typeof unit === "string" && unit !== "" ? unit : undefined;
}

function scaleGroupKey(id: string, unit: string | undefined, scaleGroup: string | undefined, vt: HistoryValueType): string {
  if (scaleGroup) return `group:${scaleGroup}`;
  if (vt === "number" && unit) return `unit:${unit}`;

  return `series:${id}`;
}

function seriesFromConfig(
  cfg: SeriesConfig,
  index: number,
  hass: HomeAssistant | undefined,
  attributeUnits?: AttributeUnitMap,
  defaultLineMode?: BetterHistoryLineMode,
  defaultLineWidth?: number | string
): ResolvedSeries {
  const attribute = normalizeAttribute(cfg.attribute);
  const id = seriesId(cfg.entity, attribute);
  const vt = resolveValueType(hass, cfg.entity, attribute);
  const unit = resolveUnit(hass, cfg.entity, attribute, cfg.unit, attributeUnits);

  return {
    id,
    entity: cfg.entity,
    attribute,
    forced: cfg.forced ?? true,
    label: resolveLabel(hass, cfg.entity, attribute, cfg.label),
    color: cfg.color ?? paletteColor(index),
    unit,
    scaleGroupKey: scaleGroupKey(id, unit, cfg.scaleGroup, vt),
    scaleMode: cfg.scaleMode ?? "auto",
    scaleMin: cfg.scaleMin,
    scaleMax: cfg.scaleMax,
    lineMode: normalizeLineMode(cfg.lineMode ?? defaultLineMode),
    lineWidth: normalizeLineWidth(cfg.lineWidth ?? defaultLineWidth),
    valueType: vt
  };
}

function seriesFromEntityId(
  entityId: string,
  index: number,
  hass: HomeAssistant | undefined,
  defaultLineMode?: BetterHistoryLineMode,
  defaultLineWidth?: number | string
): ResolvedSeries | undefined {
  const hassEntity = hass?.states[entityId];

  if (!hassEntity) {
    const id = `state:${entityId}`;

    return {
      id,
      entity: entityId,
      forced: true,
      label: entityId,
      color: paletteColor(index),
      scaleGroupKey: `series:${id}`,
      scaleMode: "auto",
      lineMode: normalizeLineMode(defaultLineMode),
      lineWidth: normalizeLineWidth(defaultLineWidth),
      valueType: "number"
    };
  }

  const source = entityStateSource(hassEntity);

  if (!source) return undefined;

  return {
    id: source.id,
    entity: entityId,
    forced: true,
    label: source.label,
    color: paletteColor(index),
    unit: source.unit,
    scaleGroupKey: scaleGroupKey(source.id, source.unit, undefined, source.valueType),
    scaleMode: "auto",
    lineMode: normalizeLineMode(defaultLineMode),
    lineWidth: normalizeLineWidth(defaultLineWidth),
    valueType: source.valueType
  };
}

function climateTemperatureUnit(entityId: string, hass: HomeAssistant | undefined): string | undefined {
  const entity = hass?.states[entityId];
  if (!entity) return undefined;
  const attr = entity.attributes;
  const tempUnit = attr.temperature_unit;
  if (typeof tempUnit === "string" && tempUnit !== "") return tempUnit;
  const uom = attr.unit_of_measurement;
  if (typeof uom === "string" && uom !== "") return uom;
  return undefined;
}

function expandClimateSeries(
  s: ResolvedSeries,
  nextColor: () => number,
  hass: HomeAssistant | undefined
): ResolvedSeries[] {
  if (s.attribute) return [s];
  if (!s.entity.startsWith("climate.")) return [s];
  if (!hass?.states[s.entity]) return [s];

  const tempUnit = climateTemperatureUnit(s.entity, hass);

  const attributeSeries = CLIMATE_LINE_ATTRIBUTES.map((attrName): ResolvedSeries => {
    const attribute = [attrName];
    const id = seriesId(s.entity, attribute);
    const vt = resolveValueType(hass, s.entity, attribute);
    const color = CLIMATE_ATTR_COLORS[attrName] ?? paletteColor(nextColor());
    const attrUnit = (attrName === "current_temperature" || attrName === "temperature") ? tempUnit : undefined;
    const scaleGroup = attrName === "hvac_action" ? undefined : "temperature";

    return {
      id,
      entity: s.entity,
      attribute,
      forced: s.forced,
      label: attrName,
      color,
      unit: attrUnit,
      scaleGroupKey: scaleGroupKey(id, attrUnit, scaleGroup, vt),
      scaleMode: "auto" as const,
      lineMode: s.lineMode,
      lineWidth: s.lineWidth,
      valueType: vt
    };
  });

  return [s, ...attributeSeries];
}

function resolvedTemperatureUnit(series: ResolvedSeries[]): string | undefined {
  return series.find((s) => s.scaleGroupKey === "group:temperature" && s.unit && isTemperatureUnit(s.unit))?.unit
    ?? series.find((s) => s.unit && isTemperatureUnit(s.unit))?.unit;
}

function normalizeTemperatureUnitSeries(series: ResolvedSeries[]): ResolvedSeries[] {
  const tempUnit = resolvedTemperatureUnit(series);
  const hasTempGroup = series.some((s) => s.scaleGroupKey === "group:temperature");

  return series.map((s) => {
    const semanticTemperature = isAttributeTemperatureUnit(s.unit);
    const unit = semanticTemperature && tempUnit ? tempUnit : s.unit;
    let scaleGroupKey = semanticTemperature && unit && s.scaleGroupKey === "unit:temperature"
      ? `unit:${unit}`
      : s.scaleGroupKey;

    if (
      hasTempGroup
      && s.valueType === "number"
      && unit
      && isTemperatureUnit(unit)
      && scaleGroupKey.startsWith("unit:")
      && !isManualBoundedSeries(s)
    ) {
      scaleGroupKey = "group:temperature";
    }

    return unit !== s.unit || scaleGroupKey !== s.scaleGroupKey
      ? { ...s, unit, scaleGroupKey }
      : s;
  });
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
  showGrid?: boolean;
  showScale?: boolean;
  width?: string;
  height?: string;
  lineMode?: BetterHistoryLineMode;
  lineWidth?: number | string;
  backgroundColor?: string;
  title?: string;
  titleFontFamily?: string;
  titleFontSize?: string;
  titleColor?: string;
  language?: string;
  hass?: HomeAssistant;
  attributeUnits?: AttributeUnitMap;
}

export function resolveConfig(opts: ResolveConfigOpts): ResolvedConfig {
  const { config, hass } = opts;

  const attributeUnits = opts.attributeUnits ?? config?.attributeUnits;

  const endDate = config?.endDate ?? opts.endDate ?? new Date();
  const hours = config?.hours ?? opts.hours ?? DEFAULT_HOURS;
  const startDate = config?.startDate ?? opts.startDate ?? new Date(endDate.getTime() - hours * 3600000);
  const lineMode = config?.lineMode ?? opts.lineMode;
  const lineWidth = config?.lineWidth ?? opts.lineWidth;

  let series: ResolvedSeries[];

  if (config?.series && config.series.length > 0) {
    series = config.series.map((cfg, index) => seriesFromConfig(cfg, index, hass, attributeUnits, lineMode, lineWidth));
  } else {
    const entityIds = config?.defaultEntities ?? opts.entities ?? [];

    series = entityIds
      .map((entityId, index) => seriesFromEntityId(entityId, index, hass, lineMode, lineWidth))
      .filter((s): s is ResolvedSeries => s !== undefined);
  }

  let nextColorIndex = series.length;

  series = series.flatMap((s) => expandClimateSeries(s, () => nextColorIndex++, hass));

  series = normalizeTemperatureUnitSeries(series);

  return {
    startDate: truncateDate(startDate),
    endDate: truncateDate(endDate),
    showDatePicker: config?.showDatePicker ?? opts.showDatePicker ?? false,
    showEntityPicker: config?.showEntityPicker ?? opts.showEntityPicker ?? false,
    showLegend: config?.showLegend ?? opts.showLegend ?? true,
    showTooltip: config?.showTooltip ?? opts.showTooltip ?? true,
    showGrid: config?.showGrid ?? opts.showGrid ?? true,
    showScale: config?.showScale ?? opts.showScale ?? true,
    width: config?.width ?? opts.width ?? "100%",
    height: config?.height ?? opts.height,
    backgroundColor: config?.backgroundColor ?? opts.backgroundColor,
    title: config?.title ?? opts.title,
    titleFontFamily: config?.titleFontFamily ?? opts.titleFontFamily,
    titleFontSize: config?.titleFontSize ?? opts.titleFontSize,
    titleColor: config?.titleColor ?? opts.titleColor,
    language: opts.language ?? hass?.locale?.language ?? hass?.language,
    series,
    disableClimateOverlay: config?.disableClimateOverlay ?? false
  };
}

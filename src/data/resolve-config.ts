import { attributeSource, entityStateSource, type HistorySource } from "./history.js";
import { paletteColor, CLIMATE_ATTR_COLORS } from "../render/colors.js";
import type { AttributeUnitMap, BetterHistoryConfig, BetterHistoryLineMode, ResolvedConfig, ResolvedSeries, SeriesConfig } from "../types/config.js";
import type { HomeAssistant } from "../types/ha.js";
import type { HistoryValueType } from "./value-type.js";
import { isAttributeTemperatureUnit, unitForAttributePath } from "./attribute-units.js";
import { isSameTemperatureUnit, isTemperatureUnit } from "./temperature-units.js";
import { isUnavailableState } from "./format.js";

export function resolvedSeriesToSource(s: ResolvedSeries): HistorySource {
  return {
    id: s.id,
    kind: s.attribute ? "entity_attribute" : "entity_state",
    entityId: s.entity,
    label: s.label,
    path: s.attribute,
    valueType: s.valueType,
    unit: s.unit,
    scalePreference: s.scalePreference
  };
}

const DEFAULT_HOURS = 24;
const DEFAULT_LINE_WIDTH = "2.5";
export const DEFAULT_POINT_RADIUS = 2.5;

const CLIMATE_LINE_ATTRIBUTES = ["current_temperature", "temperature", "hvac_action"];

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

export function normalizePointRadius(pointRadius: unknown): number {
  if (typeof pointRadius !== "number" || !Number.isFinite(pointRadius) || pointRadius <= 0) {
    return DEFAULT_POINT_RADIUS;
  }

  return Math.min(8, Math.max(1, pointRadius));
}

function normalizeScalePreference(preference: SeriesConfig["scalePreference"]): "auto" | "primary" | "secondary" {
  return preference === "primary" || preference === "secondary" ? preference : "auto";
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

function configuredValueIsUnavailable(
  hass: HomeAssistant | undefined,
  entity: string,
  attribute?: string[]
): boolean {
  const hassEntity = hass?.states[entity];
  if (!hassEntity) return true;
  if (!attribute) return isUnavailableState(hassEntity.state);

  const value = attribute.reduce<unknown>(
    (current, key) => typeof current === "object" && current !== null
      ? (current as Record<string, unknown>)[key]
      : undefined,
    hassEntity.attributes
  );

  return isUnavailableState(value);
}

function hasConfiguredNumericIntent(cfg: SeriesConfig): boolean {
  const hasUnit = typeof cfg.unit === "string" && cfg.unit.trim() !== "";
  const hasFiniteBound = (typeof cfg.scaleMin === "number" && Number.isFinite(cfg.scaleMin))
    || (typeof cfg.scaleMax === "number" && Number.isFinite(cfg.scaleMax));

  return hasUnit || hasFiniteBound;
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

function isClimateTemperatureAttribute(entity: string, attribute: string[] | undefined): boolean {
  const attrName = attribute?.length === 1 ? attribute[0] : undefined;

  return entity.startsWith("climate.") && (attrName === "current_temperature" || attrName === "temperature");
}

function isResolvedClimateTemperatureSeries(series: ResolvedSeries): boolean {
  return isClimateTemperatureAttribute(series.entity, series.attribute);
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
  const resolvedValueType = resolveValueType(hass, cfg.entity, attribute);
  const vt = configuredValueIsUnavailable(hass, cfg.entity, attribute) && hasConfiguredNumericIntent(cfg)
    ? "number"
    : resolvedValueType;
  const unit = resolveUnit(hass, cfg.entity, attribute, cfg.unit, attributeUnits);
  const group = cfg.group ?? cfg.scaleGroup;
  const scaleGroup = group ?? (isClimateTemperatureAttribute(cfg.entity, attribute) ? "temperature" : undefined);

  return {
    id,
    entity: cfg.entity,
    attribute,
    forced: cfg.forced ?? true,
    label: resolveLabel(hass, cfg.entity, attribute, cfg.label),
    color: cfg.color ?? paletteColor(index),
    unit,
    scaleGroupKey: scaleGroupKey(id, unit, scaleGroup, vt),
    scaleMode: cfg.scaleMode ?? "auto",
    scaleMin: cfg.scaleMin,
    scaleMax: cfg.scaleMax,
    scalePreference: normalizeScalePreference(cfg.scalePreference),
    lineMode: normalizeLineMode(cfg.lineMode ?? defaultLineMode),
    lineWidth: normalizeLineWidth(cfg.lineWidth ?? defaultLineWidth),
    showPoints: cfg.showPoints === true,
    pointRadius: normalizePointRadius(cfg.pointRadius),
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
      scalePreference: "auto",
      lineMode: normalizeLineMode(defaultLineMode),
      lineWidth: normalizeLineWidth(defaultLineWidth),
      showPoints: false,
      pointRadius: DEFAULT_POINT_RADIUS,
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
    scalePreference: "auto",
    lineMode: normalizeLineMode(defaultLineMode),
    lineWidth: normalizeLineWidth(defaultLineWidth),
    showPoints: false,
    pointRadius: DEFAULT_POINT_RADIUS,
    valueType: source.valueType
  };
}

function climateTemperatureUnit(entityId: string, hass: HomeAssistant | undefined): string | undefined {
  const entity = hass?.states[entityId];
  const attr = entity?.attributes;
  const tempUnit = attr?.temperature_unit;
  if (typeof tempUnit === "string" && tempUnit !== "") return tempUnit;
  const uom = attr?.unit_of_measurement;
  if (typeof uom === "string" && uom !== "") return uom;
  const systemTempUnit = hass?.config?.unit_system?.temperature;
  return typeof systemTempUnit === "string" && systemTempUnit !== "" ? systemTempUnit : undefined;
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
  const inheritedScaleGroup = s.scaleGroupKey.startsWith("group:") ? s.scaleGroupKey.slice("group:".length) : undefined;

  const attributeSeries = CLIMATE_LINE_ATTRIBUTES.map((attrName): ResolvedSeries => {
    const attribute = [attrName];
    const id = seriesId(s.entity, attribute);
    const vt = resolveValueType(hass, s.entity, attribute);
    const color = CLIMATE_ATTR_COLORS[attrName] ?? paletteColor(nextColor());
    const attrUnit = (attrName === "current_temperature" || attrName === "temperature") ? tempUnit : undefined;
    const scaleGroup = attrName === "hvac_action" ? undefined : inheritedScaleGroup ?? "temperature";

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
      scalePreference: s.scalePreference,
      lineMode: s.lineMode,
      lineWidth: s.lineWidth,
      showPoints: s.showPoints,
      pointRadius: s.pointRadius,
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
    const climateTemperature = isResolvedClimateTemperatureSeries(s);
    const unit = tempUnit && (semanticTemperature || isSameTemperatureUnit(s.unit, tempUnit) || (s.unit === undefined && climateTemperature)) ? tempUnit : s.unit;
    let scaleGroupKey = s.scaleGroupKey;

    if (unit && scaleGroupKey.startsWith("unit:")) {
      const scaleUnit = scaleGroupKey.slice("unit:".length);
      if (semanticTemperature && scaleUnit === "temperature") {
        scaleGroupKey = `unit:${unit}`;
      } else if (isSameTemperatureUnit(scaleUnit, unit)) {
        scaleGroupKey = `unit:${unit}`;
      }
    }

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
  autoScaleSplit?: boolean;
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
    autoScaleSplit: config?.autoScaleSplit ?? opts.autoScaleSplit ?? true,
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

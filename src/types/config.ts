import type { HistoryValueType } from "../data/value-type.js";

export type AttributeUnitMap = Record<string, string>;
export type BetterHistoryLineMode = "stair" | "line" | "column";

export interface SeriesConfig {
  entity: string;
  attribute?: string | string[];
  forced?: boolean;
  label?: string;
  color?: string;
  unit?: string;
  scaleGroup?: string;
  scaleMode?: "auto" | "manual";
  scaleMin?: number;
  scaleMax?: number;
  lineMode?: BetterHistoryLineMode;
  lineWidth?: number | string;
}

export interface BetterHistoryConfig {
  hours?: number;
  startDate?: Date;
  endDate?: Date;
  showDatePicker?: boolean;
  showEntityPicker?: boolean;
  showImportButton?: boolean;
  showLegend?: boolean;
  showTooltip?: boolean;
  width?: string;
  height?: string;
  lineMode?: BetterHistoryLineMode;
  lineWidth?: number | string;
  backgroundColor?: string;
  title?: string;
  titleFontFamily?: string;
  titleFontSize?: string;
  titleColor?: string;
  series?: SeriesConfig[];
  defaultEntities?: string[];
  disableClimateOverlay?: boolean;
  debugPerformance?: boolean;
  attributeUnits?: AttributeUnitMap;
}

export interface ResolvedSeries {
  id: string;
  entity: string;
  attribute?: string[];
  forced: boolean;
  label: string;
  color: string;
  unit?: string;
  scaleGroupKey: string;
  scaleMode: "auto" | "manual";
  scaleMin?: number;
  scaleMax?: number;
  lineMode: BetterHistoryLineMode;
  lineWidth: string;
  valueType: HistoryValueType;
}

export interface ResolvedConfig {
  startDate: Date;
  endDate: Date;
  showDatePicker: boolean;
  showEntityPicker: boolean;
  showLegend: boolean;
  showTooltip: boolean;
  width: string;
  height: string | undefined;
  backgroundColor: string | undefined;
  title: string | undefined;
  titleFontFamily: string | undefined;
  titleFontSize: string | undefined;
  titleColor: string | undefined;
  language: string | undefined;
  series: ResolvedSeries[];
  disableClimateOverlay: boolean;
}

import type { HistoryValueType } from "../data/value-type.js";

export interface SeriesConfig {
  entity: string;
  attribute?: string | string[];
  label?: string;
  color?: string;
  unit?: string;
  scaleGroup?: string;
  scaleMode?: "auto" | "manual";
  scaleMin?: number;
  scaleMax?: number;
}

export interface BetterHistoryConfig {
  hours?: number;
  startDate?: Date;
  endDate?: Date;
  showDatePicker?: boolean;
  showEntityPicker?: boolean;
  showLegend?: boolean;
  showTooltip?: boolean;
  width?: string;
  height?: string;
  series?: SeriesConfig[];
  defaultEntities?: string[];
  disableClimateOverlay?: boolean;
  debugPerformance?: boolean;
}

export interface ResolvedSeries {
  id: string;
  entity: string;
  attribute?: string[];
  label: string;
  color: string;
  unit?: string;
  scaleGroupKey: string;
  scaleMode: "auto" | "manual";
  scaleMin?: number;
  scaleMax?: number;
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
  language: string | undefined;
  series: ResolvedSeries[];
  disableClimateOverlay: boolean;
}

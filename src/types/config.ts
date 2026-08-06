import type { HistoryValueType } from "../data/value-type.js";

export type AttributeUnitMap = Record<string, string>;
export type BetterHistoryLineMode = "stair" | "line" | "column";
export type ScalePreference = "auto" | "primary" | "secondary";

export interface SeriesConfig {
  entity: string;
  attribute?: string | string[];
  forced?: boolean;
  label?: string;
  color?: string;
  unit?: string;
  group?: string;
  /** @deprecated Use `group` instead. */
  scaleGroup?: string;
  scaleMode?: "auto" | "manual";
  scaleMin?: number;
  scaleMax?: number;
  scalePreference?: ScalePreference;
  lineMode?: BetterHistoryLineMode;
  lineWidth?: number | string;
  showPoints?: boolean;
  pointRadius?: number;
}

export interface BetterHistoryConfig {
  hours?: number;
  startDate?: Date;
  endDate?: Date;
  showDatePicker?: boolean;
  showEntityPicker?: boolean;
  showImportButton?: boolean;
  showExportButton?: boolean;
  showTimeRangeSelector?: boolean;
  showLineModeButtons?: boolean;
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
  series?: SeriesConfig[];
  defaultEntities?: string[];
  disableClimateOverlay?: boolean;
  debugPerformance?: boolean;
  attributeUnits?: AttributeUnitMap;
}

export type BetterHistorySnapshotRange =
  | {
      mode: "relative";
      hours: number;
    }
  | {
      mode: "absolute";
      startDate: Date;
      endDate: Date;
    };

export interface BetterHistoryRuntimeConfigSnapshot {
  series: SeriesConfig[];
  range: BetterHistorySnapshotRange;
  lineMode: BetterHistoryLineMode;
  importedData: boolean;
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
  scalePreference: ScalePreference;
  lineMode: BetterHistoryLineMode;
  lineWidth: string;
  showPoints: boolean;
  pointRadius: number;
  valueType: HistoryValueType;
}

export interface ResolvedConfig {
  startDate: Date;
  endDate: Date;
  showDatePicker: boolean;
  showEntityPicker: boolean;
  showLegend: boolean;
  showTooltip: boolean;
  showGrid: boolean;
  showScale: boolean;
  autoScaleSplit: boolean;
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

import { PALETTE } from "./colors.js";
import { numericScalesFor, plotBottomFor, type NumericScale } from "./scales.js";
import { displayNumericPoints } from "./downsample.js";
import type { HistoryPoint } from "../data/history.js";
import type { HistoryValueType } from "../data/value-type.js";

export const CHART_WIDTH = 720;
export const PLOT_LEFT = 40;
export const PLOT_RIGHT = 680;
export const PLOT_WIDTH = PLOT_RIGHT - PLOT_LEFT;
export const PLOT_TOP = 18;
export const SEGMENT_ROW_HEIGHT = 14;
export const SEGMENT_HEIGHT = 9;

export interface RenderableSeries {
  id: string;
  label: string;
  color: string;
  scaleGroupKey: string;
  scaleMode: "auto" | "manual";
  scaleMin?: number;
  scaleMax?: number;
  valueType: HistoryValueType;
  points: HistoryPoint[];
}

export interface NumericLineRenderData {
  id: string;
  color: string;
  points: string;
}

export interface SegmentRenderData {
  id: string;
  x: number;
  y: number;
  width: number;
  fill: string;
}

export interface YAxisLabelRenderData {
  y: number;
  value: string;
}

export interface ChartRenderData {
  visibleSeries: RenderableSeries[];
  timeBounds: { start: number; end: number };
  numericScales: NumericScale[];
  plotBottom: number;
  chartHeight: number;
  numericLines: NumericLineRenderData[];
  segments: SegmentRenderData[];
  yAxisLabels: YAxisLabelRenderData[];
}

export function xFor(time: number, bounds: { start: number; end: number }): number {
  return PLOT_LEFT + ((time - bounds.start) / (bounds.end - bounds.start)) * PLOT_WIDTH;
}

export function yFor(value: number, scale: NumericScale): number {
  const span = scale.max - scale.min;

  if (span < 1e-6) return scale.top + scale.height / 2;

  return scale.top + scale.height - ((value - scale.min) / span) * scale.height;
}

export function scaleFor(series: RenderableSeries, scales: NumericScale[]): NumericScale | undefined {
  return scales.find((s) => s.ids.has(series.id));
}

export function stateRanges(
  series: RenderableSeries,
  bounds: { start: number; end: number }
): Array<{ start: number; end: number; value: number | string | boolean }> {
  return series.points.flatMap((point, i) => {
    const start = Math.max(point.time, bounds.start);
    const end = Math.min(series.points[i + 1]?.time ?? bounds.end, bounds.end);

    return end > start ? [{ start, end, value: point.value }] : [];
  });
}

const INACTIVE_STATES = new Set(["off", "idle", "none", "false"]);

function segmentFill(
  value: number | string | boolean,
  seriesColor: string,
  valueColorMap: Map<string, string>,
  paletteOffset: number
): string {
  if (typeof value === "boolean") {
    return value ? seriesColor : "var(--better-history-muted-color, var(--secondary-text-color, #888))";
  }

  const str = String(value);

  if (INACTIVE_STATES.has(str.toLowerCase())) {
    return "var(--better-history-muted-color, var(--secondary-text-color, #888))";
  }

  if (!valueColorMap.has(str)) {
    valueColorMap.set(str, PALETTE[(paletteOffset + valueColorMap.size) % PALETTE.length]);
  }

  return valueColorMap.get(str)!;
}

function chartHeightFor(plotBottom: number, segmentCount: number): number {
  return plotBottom + 34 + Math.max(segmentCount - 1, 0) * SEGMENT_ROW_HEIGHT;
}

function buildNumericLines(
  visibleSeries: RenderableSeries[],
  scales: NumericScale[],
  bounds: { start: number; end: number }
): NumericLineRenderData[] {
  return visibleSeries.flatMap((series) => {
    if (series.valueType !== "number") return [];

    const scale = scaleFor(series, scales);

    if (!scale) return [];

    const pts = displayNumericPoints(series.points, bounds, PLOT_LEFT, PLOT_WIDTH)
      .map((p) => `${xFor(p.time, bounds).toFixed(1)},${yFor(p.value, scale).toFixed(1)}`)
      .join(" ");

    return [{ id: series.id, color: series.color, points: pts }];
  });
}

function buildSegments(
  visibleSeries: RenderableSeries[],
  plotBottom: number,
  bounds: { start: number; end: number }
): SegmentRenderData[] {
  const top = plotBottom + 10;
  let rowIndex = 0;

  return visibleSeries.flatMap((series, seriesIndex) => {
    if (series.valueType === "number") return [];

    const y = top + rowIndex * SEGMENT_ROW_HEIGHT;
    rowIndex += 1;

    const valueColorMap = new Map<string, string>();
    const ranges = stateRanges(series, bounds);

    const merged = ranges.reduce<Array<{ start: number; end: number; fill: string }>>((acc, range) => {
      const fill = segmentFill(range.value, series.color, valueColorMap, seriesIndex);
      const prev = acc[acc.length - 1];

      if (prev && prev.fill === fill && Math.abs(prev.end - range.start) < 1) {
        prev.end = range.end;
      } else {
        acc.push({ start: range.start, end: range.end, fill });
      }

      return acc;
    }, []);

    return merged.map((seg, i) => {
      const x = xFor(seg.start, bounds);
      const width = Math.max(xFor(seg.end, bounds) - x, 1);

      return { id: `${series.id}:${i}`, x, y, width, fill: seg.fill };
    });
  });
}

function buildYAxisLabels(scales: NumericScale[]): YAxisLabelRenderData[] {
  return scales.flatMap((scale) =>
    [
      { y: scale.top + scale.height, v: scale.min },
      { y: scale.top + scale.height / 2, v: (scale.min + scale.max) / 2 },
      { y: scale.top, v: scale.max }
    ].map(({ y, v }) => ({ y, value: v.toFixed(scale.precision) }))
  );
}

export function buildChartData(
  visibleSeries: RenderableSeries[],
  timeBounds: { start: number; end: number }
): ChartRenderData {
  const numericScales = numericScalesFor(visibleSeries);
  const plotBottom = plotBottomFor(numericScales.length);
  const segmentCount = visibleSeries.filter((s) => s.valueType !== "number").length;

  return {
    visibleSeries,
    timeBounds,
    numericScales,
    plotBottom,
    chartHeight: chartHeightFor(plotBottom, segmentCount),
    numericLines: buildNumericLines(visibleSeries, numericScales, timeBounds),
    segments: buildSegments(visibleSeries, plotBottom, timeBounds),
    yAxisLabels: buildYAxisLabels(numericScales)
  };
}

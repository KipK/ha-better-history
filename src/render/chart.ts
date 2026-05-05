import { PALETTE } from "./colors.js";
import { numericScalesFor, plotBottomFor, GRAPH_TOP, GRAPH_HEIGHT, PLOT_PADDING, type NumericScale } from "./scales.js";
import { displayNumericPoints } from "./downsample.js";
import { buildClimateHeatingAreas, type HeatingAreaRenderData } from "./climate-overlay.js";
import type { HistoryPoint } from "../data/history.js";
import type { HistoryValueType } from "../data/value-type.js";

export const CHART_WIDTH = 720;
export const PLOT_LEFT = 40;
export const PLOT_RIGHT = 680;
export const PLOT_WIDTH = PLOT_RIGHT - PLOT_LEFT;
export const PLOT_TOP = 18;
export const SEGMENT_ROW_HEIGHT = 14;
export const SEGMENT_HEIGHT = 9;
const X_AXIS_LABEL_SPACE = 16;

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

export interface XAxisLabelRenderData {
  x: number;
  label: string;
  bold?: boolean;
}

export interface ChartRenderData {
  allSeries: RenderableSeries[];
  visibleSeries: RenderableSeries[];
  timeBounds: { start: number; end: number };
  numericScales: NumericScale[];
  plotBottom: number;
  chartHeight: number;
  numericLines: NumericLineRenderData[];
  segments: SegmentRenderData[];
  heatingAreas: HeatingAreaRenderData[];
  yAxisLabels: YAxisLabelRenderData[];
  xAxisLabels: XAxisLabelRenderData[];
}

export interface GraphGroup {
  series: RenderableSeries[];
  allSeries: RenderableSeries[];
  scale?: NumericScale;
  svgHeight: number;
  canvasHeight: number;
  lines: NumericLineRenderData[];
  segments: SegmentRenderData[];
  yLabels: YAxisLabelRenderData[];
  xLabels: XAxisLabelRenderData[];
  heatingAreas: HeatingAreaRenderData[];
}

export function xFor(time: number, bounds: { start: number; end: number }): number {
  return PLOT_LEFT + ((time - bounds.start) / (bounds.end - bounds.start)) * PLOT_WIDTH;
}

export function yFor(value: number, scale: NumericScale): number {
  const span = scale.max - scale.min;

  if (span < 1e-6) return scale.top + scale.height / 2;

  const drawHeight = scale.height - 2 * PLOT_PADDING;

  return scale.top + PLOT_PADDING + drawHeight - ((value - scale.min) / span) * drawHeight;
}

export function scaleFor(series: RenderableSeries, scales: NumericScale[]): NumericScale | undefined {
  return scales.find((s) => s.ids.has(series.id));
}

export function stateRanges(
  series: RenderableSeries,
  bounds: { start: number; end: number }
): Array<{ start: number; end: number; value: number | string | boolean }> {
  const now = Date.now();
  return series.points.flatMap((point, i) => {
    const start = Math.max(point.time, bounds.start);
    const end = Math.min(series.points[i + 1]?.time ?? bounds.end, bounds.end, now);

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

    const pts = toStepPath(
      displayNumericPoints(series.points, bounds, PLOT_LEFT, PLOT_WIDTH),
      bounds,
      scale
    );

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
  return scales.flatMap((scale) => {
    const drawHeight = scale.height - 2 * PLOT_PADDING;

    return scale.ticks.map((v) => ({
      y: scale.top + PLOT_PADDING + drawHeight - ((v - scale.min) / (scale.max - scale.min)) * drawHeight,
      value: formatTickValue(v, scale.precision)
    }));
  });
}

function toStepPath(
  pts: Array<{ time: number; value: number }>,
  bounds: { start: number; end: number },
  scale: NumericScale
): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) {
    return `${xFor(pts[0].time, bounds).toFixed(1)},${yFor(pts[0].value, scale).toFixed(1)}`;
  }

  const result: string[] = [];

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const xa = xFor(a.time, bounds).toFixed(1);
    const ya = yFor(a.value, scale).toFixed(1);
    const xb = xFor(b.time, bounds).toFixed(1);
    const yb = yFor(b.value, scale).toFixed(1);

    if (i === 0) {
      result.push(`${xa},${ya}`);
    }
    result.push(`${xb},${ya}`);
    result.push(`${xb},${yb}`);
  }

  return result.join(" ");
}

function formatTickValue(value: number, precision: number): string {
  if (precision <= 0 && Number.isInteger(value)) return String(value);

  let formatted = value.toFixed(precision);

  formatted = formatted.replace(/\.?0+$/, "");

  return formatted;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const TIME_TICK_STEPS = [
  10 * MINUTE, 15 * MINUTE, 20 * MINUTE, 30 * MINUTE,
  HOUR, 2 * HOUR, 3 * HOUR, 4 * HOUR, 6 * HOUR, 8 * HOUR, 12 * HOUR,
  DAY, 2 * DAY, 3 * DAY, 7 * DAY, 14 * DAY, 30 * DAY, 60 * DAY, 90 * DAY
];

function timeTickStep(span: number, maxTicks: number): number {
  for (const step of TIME_TICK_STEPS) {
    if (span / step <= maxTicks) return step;
  }

  return TIME_TICK_STEPS[TIME_TICK_STEPS.length - 1];
}

function computeTimeTicks(start: number, end: number, maxTicks = 12): Array<{ time: number; bold: boolean }> {
  const span = end - start;

  if (span <= 0) return [];

  const step = timeTickStep(span, maxTicks);
  const ticks: Array<{ time: number; bold: boolean }> = [];
  const anchor = Math.ceil(start / step) * step;

  for (let t = anchor; t < end; t += step) {
    const d = new Date(t);

    ticks.push({ time: t, bold: d.getHours() === 0 && d.getMinutes() === 0 });
  }

  return ticks;
}

function formatTimeTick(time: number, span: number): string {
  const d = new Date(time);
  const daySpan = span / DAY;

  if (daySpan > 88) {
    const month = d.toLocaleString("default", { month: "short" });
    const year = d.getFullYear();

    return d.getMonth() === 0 ? `${month} ${year}` : month;
  }

  if (daySpan > 35) {
    const month = d.toLocaleString("default", { month: "short" });
    const day = d.getDate();

    return `${day} ${month}`;
  }

  if (daySpan > 7) {
    return `${d.getDate()}/${d.getMonth() + 1}`;
  }

  if (daySpan > 2) {
    return d.toLocaleString("default", { weekday: "short" });
  }

  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");

  if (daySpan > 0.5) return `${h}:${m}`;

  const s = String(d.getSeconds()).padStart(2, "0");

  return `${h}:${m}:${s}`;
}

export function buildChartData(
  allSeries: RenderableSeries[],
  visibleSeries: RenderableSeries[],
  timeBounds: { start: number; end: number },
  disableClimateOverlay = false,
  maxXTicks = 12
): ChartRenderData {
  const numericScales = numericScalesFor(allSeries);
  const plotBottom = plotBottomFor(numericScales.length);
  const segmentCount = allSeries.filter((s) => s.valueType !== "number").length;
  const timeTicks = computeTimeTicks(timeBounds.start, timeBounds.end, maxXTicks);
  const span = timeBounds.end - timeBounds.start;

  return {
    allSeries,
    visibleSeries,
    timeBounds,
    numericScales,
    plotBottom,
    chartHeight: chartHeightFor(plotBottom, segmentCount),
    numericLines: buildNumericLines(visibleSeries, numericScales, timeBounds),
    segments: buildSegments(visibleSeries, plotBottom, timeBounds),
    heatingAreas: disableClimateOverlay ? [] : buildClimateHeatingAreas(visibleSeries, numericScales, timeBounds),
    yAxisLabels: buildYAxisLabels(numericScales),
    xAxisLabels: timeTicks.map((t) => ({
      x: xFor(t.time, timeBounds),
      label: formatTimeTick(t.time, span),
      bold: t.bold
    }))
  };
}

function buildGroupNumericLines(
  series: RenderableSeries[],
  scale: NumericScale,
  bounds: { start: number; end: number }
): NumericLineRenderData[] {
  const localScale: NumericScale = { ...scale, top: GRAPH_TOP };

  return series
    .filter((s) => s.valueType === "number")
    .map((s) => {
      const pts = toStepPath(
        displayNumericPoints(s.points, bounds, PLOT_LEFT, PLOT_WIDTH),
        bounds,
        localScale
      );

      return { id: s.id, color: s.color, points: pts };
    });
}

function buildGroupSegments(
  series: RenderableSeries[],
  segmentStartY: number,
  bounds: { start: number; end: number }
): SegmentRenderData[] {
  const nonNumeric = series.filter((s) => s.valueType !== "number");

  return nonNumeric.flatMap((s, seriesIndex) => {
    const y = segmentStartY + seriesIndex * SEGMENT_ROW_HEIGHT;
    const valueColorMap = new Map<string, string>();
    const ranges = stateRanges(s, bounds);

    const merged = ranges.reduce<Array<{ start: number; end: number; fill: string }>>((acc, range) => {
      const fill = segmentFill(range.value, s.color, valueColorMap, seriesIndex);
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

      return { id: `${s.id}:${i}`, x, y, width, fill: seg.fill };
    });
  });
}

function buildGroupYLabels(scale: NumericScale): YAxisLabelRenderData[] {
  const drawHeight = scale.height - 2 * PLOT_PADDING;

  return scale.ticks.map((v) => ({
    y: GRAPH_TOP + PLOT_PADDING + drawHeight - ((v - scale.min) / (scale.max - scale.min)) * drawHeight,
    value: formatTickValue(v, scale.precision)
  }));
}

function offsetPointsY(points: string, yOffset: number): string {
  if (yOffset === 0) return points;

  return points
    .split(" ")
    .map((coord) => {
      const [x, y] = coord.split(",");
      return `${x},${(parseFloat(y) + yOffset).toFixed(1)}`;
    })
    .join(" ");
}

export function buildGraphGroups(data: ChartRenderData, maxXTicks = 12): GraphGroup[] {
  const groups: GraphGroup[] = [];
  const bounds = data.timeBounds;
  const allNonNumeric = data.allSeries.filter((s) => s.valueType !== "number");
  const visibleNonNumeric = data.visibleSeries.filter((s) => s.valueType !== "number");
  const span = bounds.end - bounds.start;
  const timeTicks = computeTimeTicks(bounds.start, bounds.end, maxXTicks);
  const xLabels: XAxisLabelRenderData[] = timeTicks.map((t) => ({
    x: xFor(t.time, bounds),
    label: formatTimeTick(t.time, span),
    bold: t.bold
  }));

  for (let i = 0; i < data.numericScales.length; i++) {
    const scale = data.numericScales[i];
    const visibleNumeric = data.visibleSeries.filter((s) => scale.ids.has(s.id));
    const visibleGroup = i === 0 ? [...visibleNumeric, ...visibleNonNumeric] : visibleNumeric;
    const allGroup = i === 0
      ? [...data.allSeries.filter((s) => scale.ids.has(s.id)), ...allNonNumeric]
      : data.allSeries.filter((s) => scale.ids.has(s.id));

    const segSeries = visibleGroup.filter((s) => s.valueType !== "number");
    const segCount = visibleGroup.filter((s) => s.valueType !== "number").length;
    const segArea = segCount > 0 ? 10 + segCount * SEGMENT_ROW_HEIGHT : 0;
    const svgHeight = GRAPH_TOP + GRAPH_HEIGHT + segArea + 18;
    const canvasHeight = svgHeight + X_AXIS_LABEL_SPACE;
    const yOffset = GRAPH_TOP - scale.top;

    groups.push({
      series: visibleGroup,
      allSeries: allGroup,
      scale,
      svgHeight,
      canvasHeight,
      lines: buildGroupNumericLines(visibleGroup, scale, bounds),
      segments: buildGroupSegments(segSeries, GRAPH_TOP + GRAPH_HEIGHT + 10, bounds),
      yLabels: buildGroupYLabels(scale),
      xLabels,
      heatingAreas: i === 0
        ? data.heatingAreas.map((a) => ({ id: a.id, points: offsetPointsY(a.points, yOffset) }))
        : []
    });
  }

  return groups;
}

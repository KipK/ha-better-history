import { graphColor, graphColorKey, PALETTE } from "./colors.js";
import { numericScalesFor, plotBottomFor, GRAPH_TOP, GRAPH_HEIGHT, PLOT_PADDING, computeNiceTicks, tickPrecision, type NumericScale } from "./scales.js";
import { displayNumericPoints } from "./downsample.js";
import { buildClimateHeatingAreas, type HeatingAreaRenderData } from "./climate-overlay.js";
import type { HistoryPoint } from "../data/history.js";
import type { HistoryValueType } from "../data/value-type.js";
import type { BetterHistoryLineMode } from "../types/config.js";

export const CHART_WIDTH = 720;
export const PLOT_LEFT = 40;
export const PLOT_RIGHT = 680;
export const PLOT_WIDTH = PLOT_RIGHT - PLOT_LEFT;
export const PLOT_TOP = 18;
export const SEGMENT_ROW_HEIGHT = 14;
export const SEGMENT_HEIGHT = 9;
export const X_AXIS_LABEL_SPACE = 16;

export interface RenderableSeries {
  id: string;
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
  points: HistoryPoint[];
}

export interface NumericLineRenderData {
  id: string;
  color: string;
  points: string;
  pathLength: number;
  lineWidth: string;
}

interface NumericLineRenderOptions {
  extendStairToEnd: boolean;
}

interface NumericColumnRenderOptions {
  extendColumnToEnd: boolean;
}

export interface NumericColumnRenderData {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
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
  extendStairToEnd: boolean;
  numericScales: NumericScale[];
  plotBottom: number;
  chartHeight: number;
  numericLines: NumericLineRenderData[];
  numericColumns: NumericColumnRenderData[];
  segments: SegmentRenderData[];
  heatingAreas: HeatingAreaRenderData[];
  yAxisLabels: YAxisLabelRenderData[];
  xAxisLabels: XAxisLabelRenderData[];
}

export interface GraphGroup {
  series: RenderableSeries[];
  allSeries: RenderableSeries[];
  scale?: NumericScale;
  scales: NumericScale[];
  graphHeight: number;
  svgHeight: number;
  canvasHeight: number;
  lines: NumericLineRenderData[];
  columns: NumericColumnRenderData[];
  segments: SegmentRenderData[];
  yLabels: YAxisLabelRenderData[];
  rightYLabels: YAxisLabelRenderData[];
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
  return seriesStateRanges(series, bounds, true);
}

function seriesStateRanges(
  series: RenderableSeries,
  bounds: { start: number; end: number },
  extendLastToEnd: boolean
): Array<{ start: number; end: number; value: number | string | boolean }> {
  const now = Date.now();
  const sorted = [...series.points].sort((left, right) => left.time - right.time);
  const startIndex = sorted.findIndex((point) => point.time >= bounds.start);
  const visibleStartIndex = startIndex === -1 ? sorted.length : startIndex;
  const points = visibleStartIndex > 0
    ? sorted.slice(visibleStartIndex - 1)
    : sorted;

  return points.flatMap((point, i) => {
    const start = Math.max(point.time, bounds.start);
    const nextTime = points[i + 1]?.time;
    const fallbackEnd = extendLastToEnd ? bounds.end : point.time;
    const end = Math.min(nextTime ?? fallbackEnd, bounds.end, now);

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
  bounds: { start: number; end: number },
  options: NumericLineRenderOptions
): NumericLineRenderData[] {
  return visibleSeries.flatMap((series) => {
    if (series.valueType !== "number" && series.valueType !== "boolean") return [];
    if (series.lineMode === "column") return [];

    const scale = scaleFor(series, scales);

    if (!scale) return [];

    const boundedPoints = numericPointsForRender(series.points, bounds, series.lineMode, options);
    const displayPoints = displayNumericPoints(boundedPoints, bounds, PLOT_LEFT, PLOT_WIDTH);
    const { points, pathLength } = series.lineMode === "line"
      ? toLinePath(displayPoints, bounds, scale)
      : toStepPath(displayPoints, bounds, scale);

    return [{ id: series.id, color: series.color, points, pathLength, lineWidth: series.lineWidth }];
  });
}

function numericPointsForRender(
  points: HistoryPoint[],
  bounds: { start: number; end: number },
  lineMode: BetterHistoryLineMode,
  options: NumericLineRenderOptions
): HistoryPoint[] {
  const numeric = points
    .map((point) => ({ time: point.time, value: Number(point.value) }))
    .filter((point) => Number.isFinite(point.value))
    .sort((left, right) => left.time - right.time);
  const bounded = numeric.filter((point) => point.time >= bounds.start && point.time <= bounds.end);

  if (lineMode === "line") {
    return linePointsForRender(numeric, bounded, bounds);
  }

  const previous = [...numeric].reverse().find((point) => point.time < bounds.start);
  const result: HistoryPoint[] = previous && (bounded.length === 0 || bounded[0].time > bounds.start)
    ? [{ time: bounds.start, value: previous.value }, ...bounded]
    : bounded;
  const last = result[result.length - 1];

  return options.extendStairToEnd && last && last.time < bounds.end
    ? [...result, { time: bounds.end, value: last.value }]
    : result;
}

function interpolatedPoint(
  before: { time: number; value: number } | undefined,
  after: { time: number; value: number } | undefined,
  time: number
): { time: number; value: number } | undefined {
  if (!before || !after || before.time === after.time) return undefined;
  if (before.time > time || after.time < time) return undefined;

  const ratio = (time - before.time) / (after.time - before.time);

  return { time, value: before.value + (after.value - before.value) * ratio };
}

function linePointsForRender(
  numeric: Array<{ time: number; value: number }>,
  bounded: Array<{ time: number; value: number }>,
  bounds: { start: number; end: number }
): Array<{ time: number; value: number }> {
  const beforeStart = [...numeric].reverse().find((point) => point.time < bounds.start);
  const afterStart = numeric.find((point) => point.time > bounds.start);
  const beforeEnd = [...numeric].reverse().find((point) => point.time < bounds.end);
  const afterEnd = numeric.find((point) => point.time > bounds.end);
  const startPoint = bounded[0]?.time === bounds.start
    ? undefined
    : interpolatedPoint(beforeStart, afterStart, bounds.start);
  const endPoint = bounded[bounded.length - 1]?.time === bounds.end
    ? undefined
    : interpolatedPoint(beforeEnd, afterEnd, bounds.end);

  return [startPoint, ...bounded, endPoint]
    .filter((point): point is { time: number; value: number } => point !== undefined);
}

function columnBaseline(scale: NumericScale): number {
  if (scale.min <= 0 && scale.max >= 0) return 0;

  return scale.min > 0 ? scale.min : scale.max;
}

function buildNumericColumns(
  visibleSeries: RenderableSeries[],
  scales: NumericScale[],
  bounds: { start: number; end: number },
  options: NumericColumnRenderOptions
): NumericColumnRenderData[] {
  return visibleSeries.flatMap((series) => {
    if ((series.valueType !== "number" && series.valueType !== "boolean") || series.lineMode !== "column") return [];

    const scale = scaleFor(series, scales);

    if (!scale) return [];

    const baselineY = yFor(columnBaseline(scale), scale);
    const ranges = seriesStateRanges(series, bounds, options.extendColumnToEnd);

    return ranges.flatMap((range, index) => {
      const value = Number(range.value);
      if (!Number.isFinite(value)) return [];

      const x = xFor(range.start, bounds);
      const endX = xFor(range.end, bounds);
      const valueY = yFor(value, scale);
      const width = Math.max(endX - x, 1);

      return [{
        id: `${series.id}:${index}`,
        x,
        y: Math.min(valueY, baselineY),
        width,
        height: Math.max(Math.abs(baselineY - valueY), 1),
        fill: series.color
      }];
    });
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
    if (series.valueType === "number" || series.valueType === "boolean") return [];

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
): { points: string; pathLength: number } {
  if (pts.length === 0) return { points: "", pathLength: 0 };
  if (pts.length === 1) {
    return {
      points: `${xFor(pts[0].time, bounds).toFixed(1)},${yFor(pts[0].value, scale).toFixed(1)}`,
      pathLength: 0
    };
  }

  const result: string[] = [];
  let length = 0;

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const xa = xFor(a.time, bounds);
    const ya = yFor(a.value, scale);
    const xb = xFor(b.time, bounds);
    const yb = yFor(b.value, scale);

    if (i === 0) {
      result.push(`${xa.toFixed(1)},${ya.toFixed(1)}`);
    }
    result.push(`${xb.toFixed(1)},${ya.toFixed(1)}`);
    result.push(`${xb.toFixed(1)},${yb.toFixed(1)}`);

    length += Math.abs(xb - xa) + Math.abs(yb - ya);
  }

  return { points: result.join(" "), pathLength: length };
}

function toLinePath(
  pts: Array<{ time: number; value: number }>,
  bounds: { start: number; end: number },
  scale: NumericScale
): { points: string; pathLength: number } {
  if (pts.length === 0) return { points: "", pathLength: 0 };

  let length = 0;
  let previous: { x: number; y: number } | undefined;
  const points = pts.map((point) => {
    const x = xFor(point.time, bounds);
    const y = yFor(point.value, scale);

    if (previous) {
      length += Math.hypot(x - previous.x, y - previous.y);
    }
    previous = { x, y };

    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return { points: points.join(" "), pathLength: length };
}

function formatTickValue(value: number, precision: number): string {
  if (precision <= 0 && Number.isInteger(value)) return String(value);
  return value.toFixed(precision);
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

function pointsForScaleBounds(points: HistoryPoint[], bounds: { start: number; end: number }): HistoryPoint[] {
  const bounded: HistoryPoint[] = [];
  let previous: HistoryPoint | undefined;

  for (const point of points) {
    if (point.time < bounds.start) {
      previous = point;
      continue;
    }

    if (point.time > bounds.end) break;

    bounded.push(point);
  }

  return previous ? [previous, ...bounded] : bounded;
}

function seriesForScaleBounds(series: RenderableSeries[], bounds: { start: number; end: number }): RenderableSeries[] {
  return series.map((item) => ({
    ...item,
    points: pointsForScaleBounds(item.points, bounds)
  }));
}

function scaleGroupKeyFor(series: RenderableSeries): string {
  return series.valueType === "boolean" ? "group:boolean" : series.scaleGroupKey;
}

function seriesForVisibleScaleBounds(
  allSeries: RenderableSeries[],
  visibleSeries: RenderableSeries[],
  bounds: { start: number; end: number }
): RenderableSeries[] {
  const visibleByGroup = new Map<string, RenderableSeries[]>();
  const allByGroup = new Map<string, RenderableSeries[]>();

  for (const series of allSeries) {
    if (series.valueType !== "number" && series.valueType !== "boolean") continue;

    const groupKey = scaleGroupKeyFor(series);
    allByGroup.set(groupKey, [...(allByGroup.get(groupKey) ?? []), series]);
  }

  for (const series of visibleSeries) {
    if (series.valueType !== "number" && series.valueType !== "boolean") continue;

    const groupKey = scaleGroupKeyFor(series);
    visibleByGroup.set(groupKey, [...(visibleByGroup.get(groupKey) ?? []), series]);
  }

  return [...allByGroup.entries()].flatMap(([groupKey, groupSeries]) =>
    seriesForScaleBounds(visibleByGroup.get(groupKey) ?? groupSeries, bounds)
  );
}

export function buildChartData(
  allSeries: RenderableSeries[],
  visibleSeries: RenderableSeries[],
  timeBounds: { start: number; end: number },
  disableClimateOverlay = false,
  maxXTicks = 12,
  extendStairToEnd = true
): ChartRenderData {
  const lineRenderOptions = { extendStairToEnd };
  const columnRenderOptions = { extendColumnToEnd: extendStairToEnd };
  const numericScales = numericScalesFor(seriesForVisibleScaleBounds(allSeries, visibleSeries, timeBounds));
  const numericGraphCount = new Set(numericScales.map((scale) => scale.graphKey)).size;
  const plotBottom = plotBottomFor(numericGraphCount);
  const segmentCount = allSeries.filter((s) => s.valueType !== "number" && s.valueType !== "boolean").length;
  const timeTicks = computeTimeTicks(timeBounds.start, timeBounds.end, maxXTicks);
  const span = timeBounds.end - timeBounds.start;

  return {
    allSeries,
    visibleSeries,
    timeBounds,
    extendStairToEnd,
    numericScales,
    plotBottom,
    chartHeight: chartHeightFor(plotBottom, segmentCount),
    numericLines: buildNumericLines(visibleSeries, numericScales, timeBounds, lineRenderOptions),
    numericColumns: buildNumericColumns(visibleSeries, numericScales, timeBounds, columnRenderOptions),
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
  scales: NumericScale[],
  bounds: { start: number; end: number },
  options: NumericLineRenderOptions,
  graphHeight: number
): NumericLineRenderData[] {
  return series
    .filter((s) => (s.valueType === "number" || s.valueType === "boolean") && s.lineMode !== "column")
    .flatMap((s) => {
      const scale = scaleFor(s, scales);

      if (!scale) return [];

      const localScale: NumericScale = { ...scale, top: GRAPH_TOP, height: graphHeight };
      const boundedPoints = numericPointsForRender(s.points, bounds, s.lineMode, options);
      const displayPoints = displayNumericPoints(boundedPoints, bounds, PLOT_LEFT, PLOT_WIDTH);
      const { points, pathLength } = s.lineMode === "line"
        ? toLinePath(displayPoints, bounds, localScale)
        : toStepPath(displayPoints, bounds, localScale);

      return { id: s.id, color: s.color, points, pathLength, lineWidth: s.lineWidth };
    });
}

function buildGroupNumericColumns(
  series: RenderableSeries[],
  scales: NumericScale[],
  bounds: { start: number; end: number },
  graphHeight: number,
  options: NumericColumnRenderOptions
): NumericColumnRenderData[] {
  return series
    .filter((s) => (s.valueType === "number" || s.valueType === "boolean") && s.lineMode === "column")
    .flatMap((s) => {
      const scale = scaleFor(s, scales);

      if (!scale) return [];

      const localScale: NumericScale = { ...scale, top: GRAPH_TOP, height: graphHeight };
      const baselineY = yFor(columnBaseline(localScale), localScale);
      const ranges = seriesStateRanges(s, bounds, options.extendColumnToEnd);

      return ranges.flatMap((range, index) => {
        const value = Number(range.value);
        if (!Number.isFinite(value)) return [];

        const x = xFor(range.start, bounds);
        const endX = xFor(range.end, bounds);
        const valueY = yFor(value, localScale);

        return [{
          id: `${s.id}:${index}`,
          x,
          y: Math.min(valueY, baselineY),
          width: Math.max(endX - x, 1),
          height: Math.max(Math.abs(baselineY - valueY), 1),
          fill: s.color
        }];
      });
    });
}

function buildGroupSegments(
  series: RenderableSeries[],
  segmentStartY: number,
  bounds: { start: number; end: number }
): SegmentRenderData[] {
  const nonNumeric = series.filter((s) => s.valueType !== "number" && s.valueType !== "boolean");

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

function yTickCount(graphHeight: number): number {
  if (graphHeight >= 160) return 5;
  if (graphHeight >= 100) return 4;
  if (graphHeight >= 64) return 3;
  return 2;
}

function buildGroupYLabels(scale: NumericScale, graphHeight: number): YAxisLabelRenderData[] {
  const drawHeight = graphHeight - 2 * PLOT_PADDING;
  const desiredCount = yTickCount(graphHeight);
  const ticks = scale.ticks.length <= desiredCount
    ? scale.ticks
    : computeNiceTicks(scale.min, scale.max, desiredCount);
  const precision = scale.ticks === ticks
    ? scale.precision
    : Math.max(scale.precision, tickPrecision(ticks));

  return ticks.map((v) => ({
    y: GRAPH_TOP + PLOT_PADDING + drawHeight - ((v - scale.min) / (scale.max - scale.min)) * drawHeight,
    value: formatTickValue(v, precision)
  }));
}

function withGraphUniqueColors(
  allSeries: RenderableSeries[],
  visibleSeries: RenderableSeries[],
  graphIndex: number
): { allSeries: RenderableSeries[]; visibleSeries: RenderableSeries[] } {
  const used = new Set<string>();
  const colorById = new Map<string, string>();

  const recoloredAll = allSeries.map((series, index) => {
    const color = graphColor(series.color, used, graphIndex * PALETTE.length + index);

    used.add(graphColorKey(color));
    colorById.set(series.id, color);

    return color === series.color ? series : { ...series, color };
  });

  return {
    allSeries: recoloredAll,
    visibleSeries: visibleSeries.map((series) => {
      const color = colorById.get(series.id);

      return color && color !== series.color ? { ...series, color } : series;
    })
  };
}

export function buildGraphGroups(data: ChartRenderData, maxXTicks = 12, graphHeight = GRAPH_HEIGHT): GraphGroup[] {
  const groups: GraphGroup[] = [];
  const bounds = data.timeBounds;
  const allNonNumeric = data.allSeries.filter((s) => s.valueType !== "number" && s.valueType !== "boolean");
  const visibleNonNumeric = data.visibleSeries.filter((s) => s.valueType !== "number" && s.valueType !== "boolean");
  const span = bounds.end - bounds.start;
  const timeTicks = computeTimeTicks(bounds.start, bounds.end, maxXTicks);
  const xLabels: XAxisLabelRenderData[] = timeTicks.map((t) => ({
    x: xFor(t.time, bounds),
    label: formatTimeTick(t.time, span),
    bold: t.bold
  }));

  if (data.numericScales.length === 0 && allNonNumeric.length > 0) {
    const segSeries = visibleNonNumeric;
    const segCount = segSeries.length;
    const segmentStartY = GRAPH_TOP + graphHeight + X_AXIS_LABEL_SPACE + 6;
    const segArea = segCount > 0 ? X_AXIS_LABEL_SPACE + 6 + segCount * SEGMENT_ROW_HEIGHT : 0;
    const svgHeight = GRAPH_TOP + graphHeight + segArea + 18;
    const canvasHeight = svgHeight + X_AXIS_LABEL_SPACE;

    const colored = withGraphUniqueColors(allNonNumeric, visibleNonNumeric, 0);

    groups.push({
      series: colored.visibleSeries,
      allSeries: colored.allSeries,
      scales: [],
      graphHeight,
      svgHeight,
      canvasHeight,
      lines: [],
      columns: [],
      segments: buildGroupSegments(colored.visibleSeries, segmentStartY, bounds),
      yLabels: [],
      rightYLabels: [],
      xLabels,
      heatingAreas: []
    });
  }

  const graphKeys = [...new Set(data.numericScales.map((scale) => scale.graphKey))];

  for (let i = 0; i < graphKeys.length; i++) {
    const graphKey = graphKeys[i];
    const graphScales = data.numericScales.filter((scale) => scale.graphKey === graphKey);
    const leftScale = graphScales.find((scale) => scale.axis === "left") ?? graphScales[0];
    const rightScale = graphScales.find((scale) => scale.axis === "right");
    const graphIds = new Set(graphScales.flatMap((scale) => [...scale.ids]));
    const allNumericGraph = data.allSeries.filter((s) =>
      (s.valueType === "number" || s.valueType === "boolean") &&
      scaleGroupKeyFor(s) === graphKey
    );
    const visibleNumeric = data.visibleSeries.filter((s) => graphIds.has(s.id));
    const visibleGroup = i === 0 ? [...visibleNumeric, ...visibleNonNumeric] : visibleNumeric;
    const allGroup = i === 0
      ? [...allNumericGraph, ...allNonNumeric]
      : allNumericGraph;
    const colored = withGraphUniqueColors(allGroup, visibleGroup, i);

    const segSeries = colored.visibleSeries.filter((s) => s.valueType !== "number" && s.valueType !== "boolean");
    const segCount = segSeries.length;
    const segmentStartY = GRAPH_TOP + graphHeight + X_AXIS_LABEL_SPACE + 6;
    const segArea = segCount > 0 ? X_AXIS_LABEL_SPACE + 6 + segCount * SEGMENT_ROW_HEIGHT : 0;
    const svgHeight = GRAPH_TOP + graphHeight + segArea + 18;
    const canvasHeight = svgHeight + X_AXIS_LABEL_SPACE;
    const yLabels = buildGroupYLabels(leftScale, graphHeight);
    const rightYLabels = rightScale ? buildGroupYLabels(rightScale, graphHeight) : [];
    const localScales = graphScales.map((scale) => ({ ...scale, top: GRAPH_TOP, height: graphHeight }));
    const localLeftScale = localScales.find((scale) => scale.axis === "left") ?? localScales[0];

    groups.push({
      series: colored.visibleSeries,
      allSeries: colored.allSeries,
      scale: localLeftScale,
      scales: localScales,
      graphHeight,
      svgHeight,
      canvasHeight,
      lines: buildGroupNumericLines(colored.visibleSeries, localScales, bounds, {
        extendStairToEnd: data.extendStairToEnd
      }, graphHeight),
      columns: buildGroupNumericColumns(colored.visibleSeries, localScales, bounds, graphHeight, {
        extendColumnToEnd: data.extendStairToEnd
      }),
      segments: buildGroupSegments(segSeries, segmentStartY, bounds),
      yLabels,
      rightYLabels,
      xLabels,
      heatingAreas: data.heatingAreas.length > 0
        ? buildClimateHeatingAreas(data.visibleSeries, localScales, bounds)
        : []
    });
  }

  return groups;
}

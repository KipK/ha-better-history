import type { HistoryPoint } from "../data/history.js";
import type { HistoryValueType } from "../data/value-type.js";
import { canonicalUnitKey, isTemperatureUnit } from "../data/temperature-units.js";

export interface NumericScale {
  ids: Set<string>;
  graphKey: string;
  sourceGraphKey: string;
  axis: "left" | "right";
  min: number;
  max: number;
  precision: number;
  top: number;
  height: number;
  ticks: number[];
}

// Structural subset of RenderableSeries — avoids circular import with chart.ts.
interface ScaleInput {
  id: string;
  unit?: string;
  scaleGroupKey: string;
  scaleMode: "auto" | "manual";
  scaleMin?: number;
  scaleMax?: number;
  scalePreference: "auto" | "primary" | "secondary";
  valueType: HistoryValueType;
  points: HistoryPoint[];
}

export const GRAPH_TOP = 28;
export const GRAPH_HEIGHT = 180;
export const GRAPH_GAP = 34;
export const GRAPH_STEP = GRAPH_HEIGHT + GRAPH_GAP;
export const GRAPH_BOTTOM_PADDING = 18;
export const PLOT_PADDING = 5;

export function valuePrecision(value: number): number {
  if (!Number.isFinite(value) || Number.isInteger(value)) return 0;

  const text = value.toString().toLowerCase();

  if (text.includes("e-")) {
    const [coefficient, exponent] = text.split("e-");
    const coefficientDecimals = coefficient.split(".")[1]?.length ?? 0;

    return Math.min(coefficientDecimals + Number(exponent), 4);
  }

  return Math.min(text.split(".")[1]?.length ?? 0, 4);
}

export function roundToPrecision(value: number, precision: number): number {
  const factor = 10 ** precision;

  return Math.round(value * factor) / factor;
}

export function computeNiceTicks(min: number, max: number, desiredCount: number = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [min, max];

  const span = Math.abs(max - min);

  if (span < 1e-10) {
    return [min];
  }

  const maxTicks = Math.max(desiredCount, 2);
  const step = niceStep(span / (maxTicks - 1));
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const tolerance = step * 1e-8;

  const ticks: number[] = [];

  for (let v = niceMin; v <= niceMax + tolerance; v += step) {
    ticks.push(roundTick(v, step));
  }

  return ticks;
}

function niceStep(approx: number): number {
  if (approx <= 0) return 1;

  const exp = Math.floor(Math.log10(Math.abs(approx)));
  const f = approx / Math.pow(10, exp);
  let nf: number;

  if (f < 1.5) nf = 1;
  else if (f < 3) nf = 2;
  else if (f < 7) nf = 5;
  else nf = 10;

  return nf * Math.pow(10, exp);
}

function roundTick(value: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(Math.abs(step) || 1)) + 1);

  return parseFloat(value.toFixed(decimals));
}

export function tickPrecision(ticks: number[]): number {
  let maxDecimals = 0;

  for (const t of ticks) {
    const s = String(t);
    const dot = s.indexOf(".");
    if (dot !== -1) {
      maxDecimals = Math.max(maxDecimals, s.length - dot - 1);
    }
  }

  return maxDecimals;
}

export function paddedRange(min: number, max: number, precision: number): { min: number; max: number } {
  const span = max - min;

  if (span < 1e-6) {
    const padding = Math.max(Math.abs(max) * 0.05, 1);

    return {
      min: roundToPrecision(min - padding, precision),
      max: roundToPrecision(max + padding, precision)
    };
  }

  const minPadding = Math.max(span * 0.08, 10 ** -precision);
  const factor = 10 ** precision;
  const padding = Math.ceil(minPadding * factor) / factor;

  return {
    min: roundToPrecision(min - padding, precision),
    max: roundToPrecision(max + padding, precision)
  };
}

export function plotBottomFor(numericScaleCount: number): number {
  const n = Math.max(numericScaleCount, 1);

  return GRAPH_TOP + (n - 1) * GRAPH_STEP + GRAPH_HEIGHT + GRAPH_BOTTOM_PADDING;
}

type SeriesRange = {
  id: string;
  unit?: string;
  min: number;
  max: number;
  precision: number;
  scalePreference: "auto" | "primary" | "secondary";
  order: number;
};

type GroupAccum = {
  key: string;
  series: SeriesRange[];
};

const AUTO_SPLIT_MIN_RATIO = 0.1;
const AUTO_SPLIT_SPAN_RATIO = 12;
const AUTO_SPLIT_GAIN_RATIO = 2.5;

function rangeSpan(series: SeriesRange): number {
  return Math.max(series.max - series.min, 1e-9);
}

function rangeCenter(series: SeriesRange): number {
  return (series.min + series.max) / 2;
}

function logValue(value: number): number {
  return Math.log10(Math.max(Math.abs(value), 1e-9));
}

function rangeDistance(a: SeriesRange, b: SeriesRange): number {
  const spanDistance = Math.abs(logValue(rangeSpan(a)) - logValue(rangeSpan(b)));
  const centerDistance = Math.abs(logValue(rangeCenter(a)) - logValue(rangeCenter(b)));
  const unitPenalty = unitKey(a.unit) !== unitKey(b.unit) ? 2 : 0;

  return spanDistance + centerDistance * 0.6 + unitPenalty;
}

function unitKey(unit: string | undefined): string {
  return canonicalUnitKey(unit);
}

function isTemperatureSeriesGroup(series: SeriesRange[]): boolean {
  return series.length > 0 && series.every((item) => isTemperatureUnit(item.unit));
}

function shouldSplitGroup(series: SeriesRange[]): boolean {
  if (series.length < 2) return false;

  const min = Math.min(...series.map((s) => s.min));
  const max = Math.max(...series.map((s) => s.max));
  const globalSpan = Math.max(max - min, 1e-9);
  const spans = series.map((s) => s.max - s.min).filter((span) => span > 1e-6);

  if (spans.length < 2) return false;

  const minSpan = Math.min(...spans);
  const maxSpan = Math.max(...spans);
  const smallSeries = spans.find((span) => span / globalSpan <= AUTO_SPLIT_MIN_RATIO);
  if (smallSeries === undefined) return false;

  const gain = globalSpan / smallSeries;

  return gain >= AUTO_SPLIT_GAIN_RATIO
    && (maxSpan / Math.max(minSpan, 1e-9) >= AUTO_SPLIT_SPAN_RATIO || globalSpan / minSpan >= AUTO_SPLIT_SPAN_RATIO);
}

function pickAxisAnchors(series: SeriesRange[]): [SeriesRange, SeriesRange] {
  let bestLeft = series[0];
  let bestRight = series[1];
  let bestScore = -Infinity;

  for (let i = 0; i < series.length; i++) {
    for (let j = i + 1; j < series.length; j++) {
      const score = rangeDistance(series[i], series[j]);

      if (score > bestScore) {
        bestScore = score;
        bestLeft = series[i];
        bestRight = series[j];
      }
    }
  }

  return bestLeft.order <= bestRight.order ? [bestLeft, bestRight] : [bestRight, bestLeft];
}

export interface NumericScalesOptions {
  autoScaleSplit?: boolean;
}

function splitSameUnitSeries(series: SeriesRange[], autoScaleSplit: boolean): [SeriesRange[], SeriesRange[]] {
  const forcedLeft = series.filter((item) => item.scalePreference === "primary");
  const forcedRight = series.filter((item) => item.scalePreference === "secondary");
  const auto = series.filter((item) => item.scalePreference === "auto");

  if (forcedRight.length > 0 && forcedRight.length < series.length) {
    return [[...forcedLeft, ...auto], forcedRight];
  }
  if (forcedLeft.length > 0) return [series, []];

  if (!autoScaleSplit || !shouldSplitGroup(series)) return [series, []];

  const [leftAnchor, rightAnchor] = pickAxisAnchors(series);
  const left: SeriesRange[] = [];
  const right: SeriesRange[] = [];

  for (const item of series) {
    if (item.id === leftAnchor.id) {
      left.push(item);
    } else if (item.id === rightAnchor.id) {
      right.push(item);
    } else if (rangeDistance(item, leftAnchor) <= rangeDistance(item, rightAnchor)) {
      left.push(item);
    } else {
      right.push(item);
    }
  }

  return [left, right];
}

function splitGroupSeries(series: SeriesRange[], autoScaleSplit: boolean): [SeriesRange[], SeriesRange[]] {
  const unitGroups = groupByUnit(series);

  if (unitGroups.length >= 2) {
    return [unitGroups[0].series, unitGroups[1].series];
  }

  return splitSameUnitSeries(series, autoScaleSplit);
}

function groupByUnit(series: SeriesRange[]): Array<{ unit: string; series: SeriesRange[] }> {
  const groups: Array<{ unit: string; series: SeriesRange[] }> = [];

  for (const item of series) {
    const unit = unitKey(item.unit);
    const group = groups.find((entry) => entry.unit === unit);

    if (group) {
      group.series.push(item);
    } else {
      groups.push({ unit, series: [item] });
    }
  }

  return groups;
}

function splitGraphUnits(series: SeriesRange[]): SeriesRange[][] {
  const unitGroups = groupByUnit(series);

  if (unitGroups.length <= 2) return [series];

  const result: SeriesRange[][] = [];

  for (let i = 0; i < unitGroups.length; i += 2) {
    result.push(unitGroups.slice(i, i + 2).flatMap((group) => group.series));
  }

  return result;
}

function scaleFromSeries(
  graphKey: string,
  sourceGraphKey: string,
  axis: "left" | "right",
  series: SeriesRange[],
  top: number
): NumericScale {
  const min = Math.min(...series.map((s) => s.min));
  const max = Math.max(...series.map((s) => s.max));
  const precision = Math.max(...series.map((s) => s.precision));
  const range = paddedRange(min, max, precision);
  const ticks = computeNiceTicks(range.min, range.max);

  return {
    ids: new Set(series.map((s) => s.id)),
    graphKey,
    sourceGraphKey,
    axis,
    min: range.min,
    max: range.max,
    precision: Math.max(precision, tickPrecision(ticks)),
    ticks,
    top,
    height: GRAPH_HEIGHT
  };
}

export function numericScalesFor(series: ScaleInput[], options: NumericScalesOptions = {}): NumericScale[] {
  const autoScaleSplit = options.autoScaleSplit ?? true;
  const groups: GroupAccum[] = [];

  for (const [order, s] of series.entries()) {
    if (s.valueType !== "number" && s.valueType !== "boolean") continue;

    const values = s.points.map((p) => Number(p.value)).filter((v) => Number.isFinite(v));
    const fallbackMin = s.scaleMode === "manual" && s.scaleMin !== undefined ? s.scaleMin : 0;
    const fallbackMax = s.scaleMode === "manual" && s.scaleMax !== undefined ? s.scaleMax : 1;
    let dataMin = s.valueType === "boolean"
      ? 0
      : values.length > 0
        ? Math.min(...values)
        : Math.min(fallbackMin, fallbackMax);
    let dataMax = s.valueType === "boolean"
      ? 1
      : values.length > 0
        ? Math.max(...values)
        : Math.max(fallbackMin, fallbackMax);
    const prec = s.valueType === "boolean" || values.length === 0 ? 0 : Math.max(...values.map((v) => valuePrecision(v)));

    const groupKey = s.valueType === "boolean" ? "group:boolean" : s.scaleGroupKey;

    let group = groups.find((g) => g.key === groupKey);

    if (!group) {
      group = { key: groupKey, series: [] };
      groups.push(group);
    }

    if (s.scaleMode === "manual") {
      if (s.scaleMin !== undefined) dataMin = Math.min(dataMin, s.scaleMin);
      if (s.scaleMax !== undefined) dataMax = Math.max(dataMax, s.scaleMax);
    }

    group.series.push({
      id: s.id,
      unit: s.unit,
      min: dataMin,
      max: dataMax,
      precision: prec,
      scalePreference: s.scalePreference,
      order
    });
  }

  let graphOffset = 0;

  return groups.flatMap((group) => {
    const unitGraphs = group.key === "group:boolean" ? [group.series] : splitGraphUnits(group.series);

    return unitGraphs.flatMap((graphSeries, graphIndex) => {
      const graphKey = graphIndex === 0 ? group.key : `${group.key}::unit-graph:${graphIndex + 1}`;
      const allowAutoScaleSplit = autoScaleSplit && group.key !== "group:temperature" && !isTemperatureSeriesGroup(graphSeries);
      const [left, right] = group.key === "group:boolean" ? [graphSeries, []] : splitGroupSeries(graphSeries, allowAutoScaleSplit);
      const top = GRAPH_TOP + graphOffset++ * GRAPH_STEP;
      const leftScale = scaleFromSeries(graphKey, group.key, "left", left, top);

      return right.length > 0
        ? [leftScale, scaleFromSeries(graphKey, group.key, "right", right, top)]
        : [leftScale];
    });
  });
}

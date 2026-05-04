import type { HistoryPoint } from "../data/history.js";
import type { HistoryValueType } from "../data/value-type.js";

export interface NumericScale {
  ids: Set<string>;
  min: number;
  max: number;
  precision: number;
  top: number;
  height: number;
}

// Structural subset of RenderableSeries — avoids circular import with chart.ts.
interface ScaleInput {
  id: string;
  scaleGroupKey: string;
  scaleMode: "auto" | "manual";
  scaleMin?: number;
  scaleMax?: number;
  valueType: HistoryValueType;
  points: HistoryPoint[];
}

export const GRAPH_TOP = 28;
export const GRAPH_HEIGHT = 180;
export const GRAPH_GAP = 34;
export const GRAPH_STEP = GRAPH_HEIGHT + GRAPH_GAP;
export const GRAPH_BOTTOM_PADDING = 18;

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

export function paddedRange(min: number, max: number, precision: number): { min: number; max: number } {
  const span = max - min;

  if (span < 1e-6) {
    const padding = Math.max(Math.abs(max) * 0.05, 1);

    return {
      min: roundToPrecision(min - padding, precision),
      max: roundToPrecision(max + padding, precision)
    };
  }

  const padding = span * 0.08;

  return {
    min: roundToPrecision(min - padding, precision),
    max: roundToPrecision(max + padding, precision)
  };
}

export function plotBottomFor(numericScaleCount: number): number {
  const n = Math.max(numericScaleCount, 1);

  return GRAPH_TOP + (n - 1) * GRAPH_STEP + GRAPH_HEIGHT + GRAPH_BOTTOM_PADDING;
}

export function numericScalesFor(series: ScaleInput[]): NumericScale[] {
  type GroupAccum = {
    key: string;
    ids: string[];
    min: number;
    max: number;
    precision: number;
    manualMin?: number;
    manualMax?: number;
  };

  const groups: GroupAccum[] = [];

  for (const s of series) {
    if (s.valueType !== "number" || s.points.length === 0) continue;

    const values = s.points.map((p) => Number(p.value)).filter((v) => Number.isFinite(v));

    if (values.length === 0) continue;

    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    const prec = Math.max(...values.map((v) => valuePrecision(v)));

    let group = groups.find((g) => g.key === s.scaleGroupKey);

    if (group) {
      group.ids.push(s.id);
      group.min = Math.min(group.min, dataMin);
      group.max = Math.max(group.max, dataMax);
      group.precision = Math.max(group.precision, prec);
    } else {
      group = { key: s.scaleGroupKey, ids: [s.id], min: dataMin, max: dataMax, precision: prec };
      groups.push(group);
    }

    if (s.scaleMode === "manual") {
      if (s.scaleMin !== undefined) {
        group.manualMin = group.manualMin !== undefined ? Math.min(group.manualMin, s.scaleMin) : s.scaleMin;
      }

      if (s.scaleMax !== undefined) {
        group.manualMax = group.manualMax !== undefined ? Math.max(group.manualMax, s.scaleMax) : s.scaleMax;
      }
    }
  }

  return groups.map((group, index) => {
    let autoMin = group.min;
    let autoMax = group.max;

    if (group.manualMin !== undefined) autoMin = Math.min(autoMin, group.manualMin);
    if (group.manualMax !== undefined) autoMax = Math.max(autoMax, group.manualMax);

    const range = paddedRange(autoMin, autoMax, group.precision);

    return {
      ids: new Set(group.ids),
      min: range.min,
      max: range.max,
      precision: group.precision,
      top: GRAPH_TOP + index * GRAPH_STEP,
      height: GRAPH_HEIGHT
    };
  });
}

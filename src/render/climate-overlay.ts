import { PLOT_LEFT, PLOT_WIDTH, type RenderableSeries } from "./chart.js";
import { type NumericScale, PLOT_PADDING } from "./scales.js";

export interface HeatingAreaRenderData {
  id: string;
  points: string;
}

function xFor(time: number, bounds: { start: number; end: number }): number {
  return PLOT_LEFT + ((time - bounds.start) / (bounds.end - bounds.start)) * PLOT_WIDTH;
}

function yFor(value: number, scale: NumericScale): number {
  const span = scale.max - scale.min;
  if (span < 1e-6) return scale.top + scale.height / 2;
  const drawHeight = scale.height - 2 * PLOT_PADDING;
  return scale.top + PLOT_PADDING + drawHeight - ((value - scale.min) / span) * drawHeight;
}

function temperatureAt(
  points: Array<{ time: number; value: number }>,
  time: number
): number | undefined {
  if (points.length === 0) return undefined;
  if (time <= points[0].time) return points[0].value;

  const last = points[points.length - 1];
  if (time >= last.time) return last.value;

  for (let i = 0; i < points.length - 1; i++) {
    const left = points[i];
    const right = points[i + 1];
    if (time >= left.time && time <= right.time) {
      const span = right.time - left.time;
      return span <= 0 ? left.value : left.value + ((time - left.time) / span) * (right.value - left.value);
    }
  }

  return undefined;
}

function detectClimatePairs(
  visibleSeries: RenderableSeries[]
): { tempId: string; hvacId: string } | undefined {
  const pairs = new Map<string, { temp?: string; hvac?: string }>();

  for (const s of visibleSeries) {
    if (!s.id.startsWith("attr:")) continue;
    const parts = s.id.split(":");
    if (parts.length < 3) continue;
    const entityId = parts[1];
    const attrPath = parts.slice(2).join(":");

    if (!pairs.has(entityId)) {
      pairs.set(entityId, {});
    }

    const entry = pairs.get(entityId)!;

    if (attrPath === "current_temperature" || attrPath === "temperature") {
      entry.temp = s.id;
    } else if (attrPath === "hvac_action") {
      entry.hvac = s.id;
    }
  }

  for (const [, entry] of pairs) {
    if (entry.temp && entry.hvac) return { tempId: entry.temp, hvacId: entry.hvac };
  }

  return undefined;
}

export function buildClimateHeatingAreas(
  visibleSeries: RenderableSeries[],
  scales: NumericScale[],
  bounds: { start: number; end: number }
): HeatingAreaRenderData[] {
  const pair = detectClimatePairs(visibleSeries);
  if (!pair) return [];

  const tempSeries = visibleSeries.find((s) => s.id === pair.tempId);
  const hvacSeries = visibleSeries.find((s) => s.id === pair.hvacId);
  if (!tempSeries || !hvacSeries) return [];

  const scale = scales.find((s) => s.ids.has(tempSeries.id));
  if (!scale) return [];

  const tempPoints = tempSeries.points
    .map((p) => ({ time: p.time, value: Number(p.value) }))
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => a.time - b.time);

  if (tempPoints.length === 0) return [];

  const heatingRanges = stateRangesFromPoints(hvacSeries.points, bounds)
    .filter((r) => r.value === "heating")
    .reduce<Array<{ start: number; end: number }>>((acc, range) => {
      const prev = acc[acc.length - 1];
      if (prev && Math.abs(prev.end - range.start) < 1) {
        prev.end = range.end;
      } else {
        acc.push({ start: range.start, end: range.end });
      }
      return acc;
    }, []);

  return heatingRanges.flatMap(({ start, end }, index) => {
    const topPoints = [
      { time: start, value: temperatureAt(tempPoints, start) },
      ...tempPoints.filter((c) => c.time > start && c.time < end),
      { time: end, value: temperatureAt(tempPoints, end) }
    ].filter((c): c is { time: number; value: number } => c.value !== undefined);

    if (topPoints.length === 0) return [];

    const bottom = scale.top + scale.height;
    const polygonPoints = [
      `${xFor(start, bounds).toFixed(1)},${bottom.toFixed(1)}`,
      ...topPoints.map((c) => `${xFor(c.time, bounds).toFixed(1)},${yFor(c.value, scale).toFixed(1)}`),
      `${xFor(end, bounds).toFixed(1)},${bottom.toFixed(1)}`
    ].join(" ");

    return [{ id: `${hvacSeries.id}:heat:${index}`, points: polygonPoints }];
  });
}

function stateRangesFromPoints(
  points: Array<{ time: number; value: number | string | boolean }>,
  bounds: { start: number; end: number }
): Array<{ start: number; end: number; value: number | string | boolean }> {
  return points.flatMap((point, i) => {
    const start = Math.max(point.time, bounds.start);
    const end = Math.min(points[i + 1]?.time ?? bounds.end, bounds.end);
    return end > start ? [{ start, end, value: point.value }] : [];
  });
}

import type { HistoryPoint } from "../data/history.js";

export function displayNumericPoints(
  points: HistoryPoint[],
  bounds: { start: number; end: number },
  plotLeft: number,
  plotWidth: number
): Array<{ time: number; value: number }> {
  const numeric = points
    .map((p) => ({ time: p.time, value: Number(p.value) }))
    .filter((p) => Number.isFinite(p.value));

  const maxPoints = plotWidth * 4;

  if (numeric.length <= maxPoints) return numeric;

  const buckets = new Map<number, Array<{ time: number; value: number; index: number }>>();

  numeric.forEach((p, index) => {
    const bucket = Math.floor(plotLeft + ((p.time - bounds.start) / (bounds.end - bounds.start)) * plotWidth);
    const arr = buckets.get(bucket);

    if (arr) {
      arr.push({ ...p, index });
    } else {
      buckets.set(bucket, [{ ...p, index }]);
    }
  });

  const selected = new Map<number, { time: number; value: number; index: number }>();

  for (const bp of buckets.values()) {
    const first = bp[0];
    const last = bp[bp.length - 1];
    const min = bp.reduce((c, p) => (p.value < c.value ? p : c), first);
    const max = bp.reduce((c, p) => (p.value > c.value ? p : c), first);

    for (const p of [first, min, max, last]) {
      selected.set(p.index, p);
    }
  }

  return [...selected.values()]
    .sort((a, b) => a.index - b.index)
    .map(({ time, value }) => ({ time, value }));
}

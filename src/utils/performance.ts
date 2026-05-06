export type PerformanceDetails = Record<string, number | string | boolean | undefined>;

export function performanceNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function logPerformance(enabled: boolean, event: string, details: PerformanceDetails): void {
  if (!enabled) return;

  console.debug("[ha-better-history][perf]", event, details);
}

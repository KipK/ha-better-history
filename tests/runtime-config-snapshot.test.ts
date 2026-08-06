import { describe, expect, it } from "vitest";
import {
  buildRuntimeConfigSnapshot,
  buildRuntimeSnapshotRange,
  buildRuntimeSnapshotSeries,
  type RuntimeConfigSnapshotInput,
} from "../src/data/runtime-config-snapshot.js";
import type { HistorySource } from "../src/data/history.js";

function source(
  id: string,
  entityId: string,
  path?: string[],
  extra: Partial<HistorySource> = {},
): HistorySource {
  return {
    id,
    entityId,
    kind: path ? "entity_attribute" : "entity_state",
    path,
    label: extra.label ?? entityId,
    valueType: "number",
    ...extra,
  };
}

function seriesInput(
  overrides: Partial<Parameters<typeof buildRuntimeSnapshotSeries>[0]> = {},
): Parameters<typeof buildRuntimeSnapshotSeries>[0] {
  return {
    targetSources: [],
    selectedSources: [],
    pendingSources: [],
    removedConfigSourceIds: [],
    scalePreferences: {},
    ...overrides,
  };
}

function snapshotInput(overrides: Partial<RuntimeConfigSnapshotInput> = {}): RuntimeConfigSnapshotInput {
  const end = new Date("2026-08-06T12:00:00.000Z");
  return {
    targetSources: [],
    selectedSources: [],
    pendingSources: [],
    removedConfigSourceIds: [],
    scalePreferences: {},
    rollingRelativeRange: true,
    viewRangeZoomed: false,
    hours: 24,
    viewRange: { start: new Date(end.getTime() - 24 * 60 * 60 * 1000), end },
    loadedRange: { start: new Date(end.getTime() - 24 * 60 * 60 * 1000), end },
    importedData: false,
    now: end.getTime(),
    ...overrides,
  };
}

describe("runtime config snapshot series", () => {
  it("prioritizes configured series over default entities and public entities", () => {
    expect(buildRuntimeSnapshotSeries(seriesInput({
      config: { series: [{ entity: "sensor.series" }], defaultEntities: ["sensor.default"] },
      entities: ["sensor.public"],
    }))).toEqual([{ entity: "sensor.series" }]);
  });

  it("converts default entities and then falls back to public entities", () => {
    expect(buildRuntimeSnapshotSeries(seriesInput({
      config: { defaultEntities: ["sensor.default"] },
      entities: ["sensor.public"],
    }))).toEqual([{ entity: "sensor.default", forced: true }]);
    expect(buildRuntimeSnapshotSeries(seriesInput({ entities: ["sensor.public"] })))
      .toEqual([{ entity: "sensor.public", forced: true }]);
  });

  it("filters removed configured series", () => {
    expect(buildRuntimeSnapshotSeries(seriesInput({
      config: { series: [{ entity: "sensor.keep" }, { entity: "sensor.remove" }] },
      removedConfigSourceIds: ["state:sensor.remove"],
    }))).toEqual([{ entity: "sensor.keep" }]);
  });

  it("converts state and nested attribute sources with configurable metadata", () => {
    const result = buildRuntimeSnapshotSeries(seriesInput({ selectedSources: [
      source("state:sensor.a", "sensor.a", undefined, { label: "State", unit: "°C", group: "room" }),
      source("attr:sensor.a:nested.value", "sensor.a", ["nested", "value"], { label: "Nested" }),
    ] }));
    expect(result).toEqual([
      { entity: "sensor.a", forced: true, label: "State", unit: "°C", group: "room" },
      { entity: "sensor.a", attribute: "nested.value", forced: true, label: "Nested" },
    ]);
  });

  it("deduplicates while preserving config, targets, manual, pending order", () => {
    const duplicate = source("state:sensor.config", "sensor.config");
    const result = buildRuntimeSnapshotSeries(seriesInput({
      config: { series: [{ entity: "sensor.config" }] },
      targetSources: [duplicate, source("state:sensor.target", "sensor.target")],
      selectedSources: [source("state:sensor.manual", "sensor.manual")],
      pendingSources: [source("state:sensor.pending", "sensor.pending")],
    }));
    expect(result.map((item) => item.entity)).toEqual([
      "sensor.config", "sensor.target", "sensor.manual", "sensor.pending",
    ]);
  });

  it("applies runtime axis preferences and omits auto", () => {
    const result = buildRuntimeSnapshotSeries(seriesInput({
      config: { series: [
        { entity: "sensor.primary", scalePreference: "auto" },
        { entity: "sensor.secondary", scalePreference: "primary" },
      ] },
      scalePreferences: { "state:sensor.secondary": "secondary" },
    }));
    expect(result).toEqual([
      { entity: "sensor.primary" },
      { entity: "sensor.secondary", scalePreference: "secondary" },
    ]);
  });

  it("returns deep-enough clones that cannot mutate inputs", () => {
    const configured = { entity: "sensor.a", attribute: ["nested", "value"] };
    const selected = source("state:sensor.b", "sensor.b", undefined, { label: "Original" });
    const result = buildRuntimeSnapshotSeries(seriesInput({
      config: { series: [configured] },
      selectedSources: [selected],
    }));
    result[0].entity = "sensor.changed";
    (result[0].attribute as string[])[0] = "changed";
    result[1].label = "Changed";
    expect(configured).toEqual({ entity: "sensor.a", attribute: ["nested", "value"] });
    expect(selected.label).toBe("Original");
  });
});

describe("runtime config snapshot range", () => {
  it("keeps an unzoomed rolling range relative", () => {
    expect(buildRuntimeSnapshotRange(snapshotInput({ hours: 6 })))
      .toEqual({ mode: "relative", hours: 6 });
  });

  it("uses absolute picker and zoom ranges", () => {
    const fixed = snapshotInput({ rollingRelativeRange: false });
    const zoomed = snapshotInput({ viewRangeZoomed: true });
    expect(buildRuntimeSnapshotRange(fixed)).toEqual({
      mode: "absolute", startDate: fixed.viewRange.start, endDate: fixed.viewRange.end,
    });
    expect(buildRuntimeSnapshotRange(zoomed)).toEqual({
      mode: "absolute", startDate: zoomed.viewRange.start, endDate: zoomed.viewRange.end,
    });
  });

  it("falls back to 24 hours for invalid relative hours", () => {
    expect(buildRuntimeSnapshotRange(snapshotInput({ hours: Number.NaN })))
      .toEqual({ mode: "relative", hours: 24 });
  });
});

describe("runtime config snapshot", () => {
  it("prioritizes runtime mode and falls back invalid modes to stair", () => {
    expect(buildRuntimeConfigSnapshot(snapshotInput({
      runtimeLineMode: "column", config: { lineMode: "line" }, lineMode: "stair",
    })).lineMode).toBe("column");
    expect(buildRuntimeConfigSnapshot(snapshotInput({
      runtimeLineMode: "invalid" as "line",
      config: { lineMode: "invalid" as "line" },
      lineMode: "invalid" as "line",
    })).lineMode).toBe("stair");
  });

  it("propagates imported data state", () => {
    expect(buildRuntimeConfigSnapshot(snapshotInput({ importedData: true })).importedData).toBe(true);
  });
});

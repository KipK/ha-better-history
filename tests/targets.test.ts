import { describe, expect, it } from "vitest";
import {
  normalizeTargetSelection,
  groupedTargetWasRemoved,
  resolveTargetEntityIds,
  targetEntitySources,
} from "../src/data/targets.js";
import { sourceSetLoadSignature } from "../src/data/history.js";
import type { HomeAssistant } from "../src/types/ha.js";

function hassFixture(): HomeAssistant {
  const states = Object.fromEntries([
    "sensor.explicit",
    "sensor.device_a",
    "sensor.area_direct",
    "sensor.floor_device",
    "sensor.label_direct",
    "sensor.overlap",
  ].map((entityId) => [entityId, {
    entity_id: entityId,
    state: entityId === "sensor.device_a" ? "unavailable" : "1",
    attributes: entityId === "sensor.device_a" ? { unit_of_measurement: "°C" } : {},
  }]));

  return {
    states,
    entities: {
      explicit: { entity_id: "sensor.explicit" },
      deviceA: { entity_id: "sensor.device_a", device_id: "device-a" },
      areaDirect: { entity_id: "sensor.area_direct", area_id: "area-a" },
      floorDevice: { entity_id: "sensor.floor_device", device_id: "device-floor" },
      labelDirect: { entity_id: "sensor.label_direct", labels: ["label-a"] },
      overlap: { entity_id: "sensor.overlap", device_id: "device-a", area_id: "area-a", labels: ["label-a"] },
      missing: { entity_id: "sensor.missing", device_id: "device-a" },
    },
    devices: {
      deviceA: { id: "device-a", area_id: "area-a", labels: ["label-a"] },
      deviceFloor: { id: "device-floor", area_id: "area-floor" },
    },
    areas: {
      areaA: { area_id: "area-a", labels: ["label-a"] },
      areaFloor: { area_id: "area-floor", floor_id: "floor-a" },
    },
  };
}

describe("history targets", () => {
  it("normalizes without mutating the input", () => {
    const input = { entity_id: ["sensor.a", "", "sensor.a"], area_id: " area-a " };
    const snapshot = structuredClone(input);
    expect(normalizeTargetSelection(input)).toEqual({ entity_id: ["sensor.a"], area_id: ["area-a"] });
    expect(input).toEqual(snapshot);
  });

  it("resolves explicit entities, including temporarily missing states", () => {
    expect(resolveTargetEntityIds(hassFixture(), { entity_id: ["sensor.explicit", "sensor.missing"] }))
      .toEqual(["sensor.explicit", "sensor.missing"]);
  });

  it("resolves devices and ignores registry entities without states", () => {
    expect(resolveTargetEntityIds(hassFixture(), { device_id: "device-a" }))
      .toEqual(["sensor.device_a", "sensor.overlap"]);
  });

  it("resolves areas through devices and direct entity assignments", () => {
    expect(resolveTargetEntityIds(hassFixture(), { area_id: "area-a" }))
      .toEqual(["sensor.area_direct", "sensor.overlap", "sensor.device_a"]);
  });

  it("resolves floors through their areas", () => {
    expect(resolveTargetEntityIds(hassFixture(), { floor_id: "floor-a" }))
      .toEqual(["sensor.floor_device"]);
  });

  it("resolves labels recursively with stable first-insertion deduplication", () => {
    expect(resolveTargetEntityIds(hassFixture(), { label_id: "label-a" }))
      .toEqual(["sensor.label_direct", "sensor.overlap", "sensor.area_direct", "sensor.device_a"]);
  });

  it("tolerates absent targets and registries", () => {
    expect(resolveTargetEntityIds({ states: {} }, { area_id: "missing" })).toEqual([]);
    expect(resolveTargetEntityIds({ states: {} }, undefined)).toEqual([]);
  });

  it("reuses entity state classification", () => {
    const source = targetEntitySources(hassFixture(), { entity_id: "sensor.device_a" })[0];
    expect(source?.valueType).toBe("number");
  });

  it("keeps the same source signature after equivalent expansion", () => {
    const hass = hassFixture();
    const grouped = targetEntitySources(hass, { device_id: "device-a" });
    const expanded = targetEntitySources(hass, { entity_id: ["sensor.device_a", "sensor.overlap"] });
    expect(sourceSetLoadSignature(grouped)).toBe(sourceSetLoadSignature(expanded));
  });

  it("distinguishes grouped expansion from direct entity selection", () => {
    expect(groupedTargetWasRemoved({}, { entity_id: "sensor.explicit" })).toBe(false);
    expect(groupedTargetWasRemoved(
      { device_id: "device-a" },
      { entity_id: ["sensor.device_a", "sensor.overlap"] },
    )).toBe(true);
  });
});

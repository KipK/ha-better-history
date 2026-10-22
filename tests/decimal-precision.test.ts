import { describe, expect, it, vi } from "vitest";
import { formatNumericValue, normalizeDecimals, numberFormatLanguage, parseDecimals, resolveDecimals } from "../src/data/decimal-precision.js";
import type { HomeAssistant } from "../src/types/ha.js";
import { sourceSetLoadSignature, type HistorySeries } from "../src/data/history.js";
import { buildRuntimeSnapshotSeries } from "../src/data/runtime-config-snapshot.js";
import { TooltipController } from "../src/controllers/tooltip-controller.js";

const hass: HomeAssistant = {
  states: {}, callService: async () => {},
  entities: { "sensor.room": { entity_id: "sensor.room", display_precision: 2 } },
};

describe("decimal precision", () => {
  it.each([0, 1, 4, 20])("accepts integer precision %s", (value) => {
    expect(normalizeDecimals(value)).toBe(value);
    expect(parseDecimals(String(value))).toBe(value);
  });

  it.each([-1, 1.5, 21, NaN, Infinity, "2", null, undefined])("ignores invalid precision %s", (value) => {
    expect(normalizeDecimals(value)).toBeUndefined();
  });

  it("restores automatic mode when cleared", () => {
    expect(parseDecimals(" ")).toBeUndefined();
    expect(resolveDecimals(hass, "sensor.room", false, parseDecimals(""))).toBe(2);
  });

  it("prioritizes explicit zero and never inherits state precision for attributes", () => {
    expect(resolveDecimals(hass, "sensor.room", false)).toBe(2);
    expect(resolveDecimals(hass, "sensor.room", false, 0)).toBe(0);
    expect(resolveDecimals(hass, "sensor.room", true)).toBeUndefined();
    expect(resolveDecimals(hass, "sensor.room", true, 3)).toBe(3);
    expect(resolveDecimals(undefined, "sensor.missing", false)).toBeUndefined();
  });

  it("formats numbers with localized separators while preserving unconfigured and nonnumeric values", () => {
    expect(formatNumericValue(19.364, 2, "fr")).toBe("19,36");
    expect(formatNumericValue(19.364, 0, "en")).toBe("19");
    expect(formatNumericValue(19, 2, "en")).toBe("19.00");
    expect(formatNumericValue(19.364)).toBe("19.364");
    expect(formatNumericValue("unavailable", 2)).toBe("unavailable");
    expect(formatNumericValue(true, 2)).toBe("true");
    expect(formatNumericValue(-0.001, 2, "en")).toBe("0.00");
    expect(formatNumericValue(1.25, 1, "invalid_locale")).toBe("1.3");
  });

  it("honors HA's numeric locale independently from the UI language", () => {
    expect(numberFormatLanguage({ ...hass, locale: { language: "en", number_format: "space_comma" } })).toBe("fr");
    expect(numberFormatLanguage({ ...hass, locale: { language: "fr", number_format: "none" } })).toBe("en-US");
    expect(numberFormatLanguage({ ...hass, locale: { number_format: "system" } })).toBeUndefined();
  });

  it("keeps presentation metadata out of history signatures and preserves zero in snapshots", () => {
    const source = { id: "state:sensor.room", entityId: "sensor.room", kind: "entity_state" as const, valueType: "number" as const, label: "Room" };
    expect(sourceSetLoadSignature([source])).toBe(sourceSetLoadSignature([{ ...source, decimals: 0 }]));
    const result = buildRuntimeSnapshotSeries({
      targetSources: [{ ...source, decimals: 0 }], selectedSources: [], pendingSources: [],
      removedConfigSourceIds: [], scalePreferences: {},
    });
    expect(result[0].decimals).toBe(0);
  });

  it("refreshes tooltip metadata with the same history reference and point timestamp", () => {
    const host = { addController: vi.fn(), requestUpdate: vi.fn(), dispatchEvent: vi.fn() };
    const controller = new TooltipController(host);
    const fetched: HistorySeries[] = [{ source: {
      id: "state:sensor.room", entityId: "sensor.room", kind: "entity_state", valueType: "number", label: "Room",
    }, points: [{ time: 500, value: 19.364 }] }];
    const pointer = {
      x: 360, y: 100, viewportTop: 0, viewportBottom: 500,
      activeLeft: 40, activeTop: 0, activeWidth: 640, activeHeight: 300,
      activeIds: new Set(["state:sensor.room"]), activeKey: "room", touchLike: false,
    };
    const internals = controller as unknown as { _pendingPoint: typeof pointer; _apply(): void };
    const series = { id: "state:sensor.room", label: "Room", color: "blue", decimals: 2 };
    controller.sync([series], fetched, [], 300, { start: 0, end: 1000 }, "en");
    internals._pendingPoint = pointer;
    internals._apply();
    expect(controller.tooltip?.values[0].value).toBe("19.36");
    controller.sync([{ ...series, decimals: 0 }], fetched, [], 300, { start: 0, end: 1000 }, "en");
    internals._apply();
    expect(controller.tooltip?.values[0].value).toBe("19");
    controller.sync([series], fetched, [], 300, { start: 0, end: 1000 }, "fr");
    internals._apply();
    expect(controller.tooltip?.values[0].value).toBe("19,36");
    expect(fetched[0].points[0].value).toBe(19.364);
  });
});

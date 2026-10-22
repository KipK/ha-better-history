import { afterEach, describe, expect, it, vi } from "vitest";
import { HaBetterHistory } from "../src/ha-better-history.js";
import type { HistorySeries, HistorySource } from "../src/data/history.js";
import type { DataController } from "../src/controllers/data-controller.js";
import type { RenderableSeries } from "../src/render/chart.js";
import type { PropertyValues } from "lit";

interface Internals {
  _selectedTargets: { entity_id?: string[] };
  _selectedSources: HistorySource[];
  _sourceSettingsSourceId?: string;
  _targetDecimals: Record<string, number>;
  _data: DataController;
  _buildRenderSeries(): RenderableSeries[];
  _updateTargetDecimals(entityId: string, value: string): void;
  _updateSourceSettings(patch: Partial<HistorySource>): void;
  _onTargetSelectionChanged(value: unknown, openAttributes?: boolean): void;
  _parseImportedSeries(series: unknown[]): { series: HistorySeries[] };
  _exportData(): void;
  willUpdate(changed: PropertyValues): void;
}

function setup() {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  const component = new HaBetterHistory();
  Object.defineProperty(component, "renderRoot", { value: { querySelector: () => null } });
  component.startDate = new Date("2026-01-01T00:00:00Z");
  component.endDate = new Date("2026-01-02T00:00:00Z");
  component.hass = {
    states: { "sensor.room": { entity_id: "sensor.room", state: "19.364", attributes: { unit_of_measurement: "°C" } } },
    entities: { "sensor.room": { entity_id: "sensor.room", display_precision: 2 } },
    callService: async () => {},
  };
  const internals = component as unknown as Internals;
  internals._selectedTargets = { entity_id: ["sensor.room"] };
  const fetch = vi.spyOn(internals._data, "fetch").mockImplementation(() => {});
  const add = vi.spyOn(internals._data, "addSources").mockImplementation(() => {});
  const remove = vi.spyOn(internals._data, "removeSources").mockImplementation(() => {});
  internals.willUpdate(new Map([["startDate", undefined], ["endDate", undefined]]));
  fetch.mockClear();
  return { component, internals, fetch, add, remove };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("runtime decimal overrides", () => {
  it("edits direct entities without changing target intent, bounds, or fetching history", () => {
    const { component, internals, fetch, add, remove } = setup();
    internals._updateTargetDecimals("sensor.room", "0");
    internals.willUpdate(new Map([["_targetDecimals", {}]]));
    expect(internals._selectedTargets).toEqual({ entity_id: ["sensor.room"] });
    expect(internals._buildRenderSeries()[0].decimals).toBe(0);
    expect(component.getRuntimeConfigSnapshot().series[0].decimals).toBe(0);
    internals._updateTargetDecimals("sensor.room", "");
    internals.willUpdate(new Map([["_targetDecimals", {}]]));
    expect(internals._buildRenderSeries()[0].decimals).toBeUndefined();
    expect(component.getRuntimeConfigSnapshot().series[0]).not.toHaveProperty("decimals");
    expect(fetch).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("updates nested attributes without refetching and drops overrides when a target is removed", () => {
    const { component, internals, fetch, add } = setup();
    const source: HistorySource = {
      id: "attr:sensor.room:nested.value", entityId: "sensor.room", kind: "entity_attribute",
      path: ["nested", "value"], label: "Value", valueType: "number",
    };
    internals._selectedSources = [source];
    internals.willUpdate(new Map([["_selectedSources", []]]));
    fetch.mockClear(); add.mockClear();
    internals._sourceSettingsSourceId = source.id;
    internals._updateSourceSettings({ decimals: 3 });
    internals.willUpdate(new Map([["_selectedSources", []]]));
    expect(component.getRuntimeConfigSnapshot().series.find((s) => s.attribute === "nested.value")?.decimals).toBe(3);
    expect(fetch).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    internals._updateTargetDecimals("sensor.room", "0");
    internals._onTargetSelectionChanged({ entity_id: [] }, false);
    expect(internals._targetDecimals).toEqual({});
  });

  it("preserves decimal precision and raw points through JSON export/import", async () => {
    const { internals } = setup();
    internals._updateTargetDecimals("sensor.room", "0");
    internals._data.series = [{
      source: { id: "state:sensor.room", kind: "entity_state", entityId: "sensor.room", label: "Room", valueType: "number" },
      points: [{ time: Date.parse("2026-01-01T12:00:00Z"), value: 19.364 }],
    }];
    let blob: Blob | undefined;
    vi.stubGlobal("URL", { createObjectURL: (value: Blob) => { blob = value; return "blob:test"; }, revokeObjectURL: vi.fn() });
    vi.stubGlobal("document", { createElement: () => ({ click: vi.fn() }) });
    internals._exportData();
    const payload = JSON.parse(await blob!.text());
    expect(payload.series[0].decimals).toBe(0);
    expect(payload.series[0].points[0].value).toBe(19.364);
    const imported = internals._parseImportedSeries(payload.series);
    expect(imported.series[0].source.decimals).toBe(0);
    expect(imported.series[0].points[0].value).toBe(19.364);
    delete payload.series[0].decimals;
    expect(internals._parseImportedSeries(payload.series).series[0].source.decimals).toBeUndefined();
  });
});

import "./mock-ha-components.ts";
import "../src/define.ts";

const NOW = Date.now();
const H24 = 24 * 3600 * 1000;

function sine(entityId: string, unit: string, min: number, max: number, periodMs: number, offset: number = 0) {
  const points: Array<{ lu: number; s: string; a: Record<string, unknown> }> = [];
  const steps = 120;
  for (let i = 0; i <= steps; i++) {
    const t = NOW - H24 + (i / steps) * H24;
    const v = min + ((Math.sin((t / periodMs) * 2 * Math.PI + offset) + 1) / 2) * (max - min);
    points.push({ lu: t / 1000, s: v.toFixed(2), a: { unit_of_measurement: unit } });
  }
  return { [entityId]: points };
}

function states(entityId: string, values: string[], durationMs: number) {
  const points: Array<{ lu: number; s: string }> = [];
  let t = NOW - H24;
  for (let i = 0; i < 40; i++) {
    const v = values[i % values.length];
    points.push({ lu: t / 1000, s: v });
    t += durationMs + (Math.random() - 0.5) * durationMs * 0.4;
  }
  return { [entityId]: points };
}

function makeMockHass(historyData: Record<string, unknown>, hassStates: Record<string, unknown> = {}) {
  return {
    states: { ...hassStates },
    locale: { language: "en" },
    localize(key: string) { return key.split(".").pop() || key; },
    config: { time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    callWS(msg: Record<string, unknown>) {
      if (msg.type === "history/history_during_period") {
        const result: Record<string, unknown> = {};
        for (const id of msg.entity_ids as string[]) {
          if (historyData[id]) result[id] = historyData[id];
        }
        return Promise.resolve(result);
      }
      return Promise.resolve({});
    },
    callService: () => Promise.resolve(),
  };
}

type CElement = HTMLElement & { hass?: unknown; entities?: string[]; config?: Record<string, unknown> };
type HistoryFixtureElement = CElement & {
  updateComplete: Promise<unknown>;
  _resolved?: { series: Array<{ id: string; valueType: string }> };
};

function c(id: string): CElement {
  return document.getElementById(id) as CElement;
}

// Chart 1 — entities shortcut (temperature + humidity)
const data1 = { ...sine("sensor.temperature", "°C", 18, 24, 3 * 3600 * 1000), ...sine("sensor.humidity", "%", 40, 65, 5 * 3600 * 1000, 1.2) };
const c1 = c("c1");
c1.hass = makeMockHass(data1, {
  "sensor.temperature": { entity_id: "sensor.temperature", state: "21.5", attributes: { friendly_name: "Temperature", unit_of_measurement: "°C" } },
  "sensor.humidity":    { entity_id: "sensor.humidity",    state: "55",   attributes: { friendly_name: "Humidity",    unit_of_measurement: "%" } },
});
c1.entities = ["sensor.temperature", "sensor.humidity"];

// Chart 2 — explicit series with scaleGroup
const data2 = { ...sine("climate.living", "°C", 19, 22, 4 * 3600 * 1000), ...sine("sensor.outdoor_temp", "°C", 5, 14, 8 * 3600 * 1000, 0.7), ...states("binary_sensor.window", ["on", "off"], 45 * 60 * 1000) };
const c2 = c("c2");
c2.hass = makeMockHass(data2, {
  "climate.living":        { entity_id: "climate.living",        state: "heat", attributes: { friendly_name: "Living room", current_temperature: 20.1, unit_of_measurement: "°C" } },
  "sensor.outdoor_temp":   { entity_id: "sensor.outdoor_temp",   state: "9.3",  attributes: { friendly_name: "Outdoor temp", unit_of_measurement: "°C" } },
  "binary_sensor.window":  { entity_id: "binary_sensor.window",  state: "off",  attributes: { friendly_name: "Window" } },
});
c2.config = {
  series: [
    { entity: "climate.living",       attribute: "current_temperature", label: "Indoor",  color: "#42a5f5", scaleGroup: "temp" },
    { entity: "sensor.outdoor_temp",                                    label: "Outdoor", color: "#66bb6a", scaleGroup: "temp" },
    { entity: "binary_sensor.window",                                   label: "Window open" },
  ],
};

// Chart 3 — with date picker (mock)
const data3 = { ...sine("sensor.power", "W", 0, 2000, 2 * 3600 * 1000) };
const c3 = c("c3");
c3.hass = makeMockHass(data3, { "sensor.power": { entity_id: "sensor.power", state: "1050", attributes: { friendly_name: "Power", unit_of_measurement: "W" } } });
c3.entities = ["sensor.power"];

// Chart 4 — with entity picker (mock)
const data4 = { ...sine("sensor.energy", "kWh", 0, 10, 6 * 3600 * 1000) };
const c4 = c("c4");
c4.hass = makeMockHass(data4, {
  "sensor.energy":       { entity_id: "sensor.energy",       state: "4.2",  attributes: { friendly_name: "Energy",      unit_of_measurement: "kWh" } },
  "sensor.temperature":  { entity_id: "sensor.temperature",  state: "21.5", attributes: { friendly_name: "Temperature", unit_of_measurement: "°C" } },
});
c4.config = { defaultEntities: ["sensor.energy", "sensor.temperature"], series: [{ entity: "sensor.energy", label: "Energy" }] };

// Chart 5 — climate heating overlay
function heatingStates() {
  const points: Array<{ lu: number; s: string; a: Record<string, unknown> }> = [];
  const steps = 120;
  const periodMs = 3 * 3600 * 1000;
  for (let i = 0; i <= steps; i++) {
    const t = NOW - H24 + (i / steps) * H24;
    const temp = 19 + ((Math.sin((t / periodMs) * 2 * Math.PI) + 1) / 2) * 4;
    const heating = Math.sin((t / periodMs) * 2 * Math.PI) > 0;
    points.push({ lu: t / 1000, s: heating ? "heating" : "idle", a: { current_temperature: temp, hvac_action: heating ? "heating" : "idle" } });
  }
  return { "climate.room": points };
}
const heatingHistory = heatingStates();
const c5 = c("c5");
c5.hass = {
  states: { "climate.room": { entity_id: "climate.room", state: "heat", attributes: { friendly_name: "Living room", current_temperature: 20.5, temperature: 21, hvac_action: "heating" } } },
  locale: { language: "en" },
  localize(key: string) { return key.split(".").pop() || key; },
  config: { time_zone: "UTC" },
  callWS(msg: Record<string, unknown>) {
    if (msg.type === "history/history_during_period") {
      const result: Record<string, unknown> = {};
      for (const id of msg.entity_ids as string[]) {
        if (heatingHistory[id]) result[id] = heatingHistory[id];
      }
      return Promise.resolve(result);
    }
    return Promise.resolve({});
  },
  callService: () => Promise.resolve(),
};
c5.config = {
  series: [
    { entity: "climate.room", attribute: "current_temperature", label: "Current temp", color: "#42a5f5" },
    { entity: "climate.room", attribute: "hvac_action", label: "State", color: "#ab47bc" },
  ],
};

// Chart 6 — scaleMode: manual
const data6 = { ...sine("sensor.pressure", "hPa", 980, 1030, 12 * 3600 * 1000) };
const c6 = c("c6");
c6.hass = makeMockHass(data6, { "sensor.pressure": { entity_id: "sensor.pressure", state: "1013", attributes: { friendly_name: "Pressure", unit_of_measurement: "hPa" } } });
c6.config = { series: [{ entity: "sensor.pressure", label: "Pressure", scaleMode: "manual" as const, scaleMin: 960, scaleMax: 1040 }] };

// Chart 7 — unavailable numeric classification and one-time type recovery
const unavailableNumericHistory = {
  ...sine("sensor.unavailable_numeric_metadata", "%", 70, 82, 8 * 3600 * 1000),
  ...sine("sensor.unavailable_numeric_config_unit", "kW", 0, 11, 6 * 3600 * 1000),
  ...sine("sensor.unavailable_numeric_config_bound", "", 20, 65, 7 * 3600 * 1000),
  ...states("sensor.unavailable_categorical", ["idle", "running"], 90 * 60 * 1000),
  ...sine("sensor.numeric_type_recovery", "", 72, 79, 5 * 3600 * 1000)
};
const unavailableInitialStates = {
  "sensor.unavailable_numeric_metadata": {
    entity_id: "sensor.unavailable_numeric_metadata",
    state: "unavailable",
    attributes: { friendly_name: "HA metadata", unit_of_measurement: "%", state_class: "measurement" }
  },
  "sensor.unavailable_numeric_config_unit": {
    entity_id: "sensor.unavailable_numeric_config_unit",
    state: "unknown",
    attributes: { friendly_name: "Configured unit" }
  },
  "sensor.unavailable_numeric_config_bound": {
    entity_id: "sensor.unavailable_numeric_config_bound",
    state: "unavailable",
    attributes: { friendly_name: "Configured bound" }
  },
  "sensor.unavailable_categorical": {
    entity_id: "sensor.unavailable_categorical",
    state: "unavailable",
    attributes: { friendly_name: "Categorical" }
  },
  "sensor.numeric_type_recovery": {
    entity_id: "sensor.numeric_type_recovery",
    state: "unavailable",
    attributes: { friendly_name: "Late numeric recovery" }
  }
};
let unavailableNumericHistoryRequestCount = 0;
const unavailableNumericHistoryRequestWaiters: Array<() => void> = [];

function createUnavailableNumericHass(statesValue: Record<string, unknown>) {
  return {
    states: statesValue,
    locale: { language: "en" },
    localize(key: string) { return key.split(".").pop() || key; },
    config: { time_zone: "UTC" },
    callWS(msg: Record<string, unknown>) {
      if (msg.type === "history/history_during_period") {
        unavailableNumericHistoryRequestCount += 1;
        unavailableNumericHistoryRequestWaiters.splice(0).forEach((resolve) => resolve());
        const result: Record<string, unknown> = {};
        for (const id of msg.entity_ids as string[]) {
          if (unavailableNumericHistory[id as keyof typeof unavailableNumericHistory]) {
            result[id] = unavailableNumericHistory[id as keyof typeof unavailableNumericHistory];
          }
        }
        return Promise.resolve(result);
      }
      return Promise.resolve({});
    },
    callService: () => Promise.resolve()
  };
}

function waitForUnavailableNumericHistoryRequests(expected: number): Promise<void> {
  if (unavailableNumericHistoryRequestCount >= expected) return Promise.resolve();

  return new Promise((resolve) => {
    unavailableNumericHistoryRequestWaiters.push(resolve);
  });
}

function waitForIdleWork(): Promise<void> {
  return new Promise((resolve) => {
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(() => resolve(), { timeout: 200 });
    } else {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }
  });
}

function resolvedValueTypes(chart: HistoryFixtureElement): Record<string, string> {
  return Object.fromEntries((chart._resolved?.series ?? []).map((series) => [series.id, series.valueType]));
}

async function runUnavailableNumericFixture(): Promise<void> {
  const chart = c("c7") as HistoryFixtureElement;
  const status = document.getElementById("c7-status") as HTMLParagraphElement;
  chart.hass = createUnavailableNumericHass(unavailableInitialStates);
  chart.config = {
    startDate: new Date(NOW - H24),
    endDate: new Date(NOW),
    series: [
      { entity: "sensor.unavailable_numeric_metadata", label: "HA metadata" },
      { entity: "sensor.unavailable_numeric_config_unit", label: "Configured unit", unit: "kW", lineMode: "column" },
      { entity: "sensor.unavailable_numeric_config_bound", label: "Configured bound", scaleMode: "manual", scaleMax: 100 },
      { entity: "sensor.unavailable_categorical", label: "Categorical" },
      { entity: "sensor.numeric_type_recovery", label: "Late numeric recovery" }
    ]
  };

  await chart.updateComplete;
  await waitForUnavailableNumericHistoryRequests(1);
  const initialTypes = resolvedValueTypes(chart);
  const initialClassificationPassed = initialTypes["state:sensor.unavailable_numeric_metadata"] === "number"
    && initialTypes["state:sensor.unavailable_numeric_config_unit"] === "number"
    && initialTypes["state:sensor.unavailable_numeric_config_bound"] === "number"
    && initialTypes["state:sensor.unavailable_categorical"] === "string"
    && initialTypes["state:sensor.numeric_type_recovery"] === "string";
  console.assert(initialClassificationPassed, "Initial unavailable series classification should match numeric hints");

  const recoveredStates = {
    ...unavailableInitialStates,
    "sensor.numeric_type_recovery": {
      entity_id: "sensor.numeric_type_recovery",
      state: "78",
      attributes: { friendly_name: "Late numeric recovery" }
    }
  };
  chart.hass = createUnavailableNumericHass(recoveredStates);
  await chart.updateComplete;
  await waitForUnavailableNumericHistoryRequests(2);
  const recoveryClassificationPassed = resolvedValueTypes(chart)["state:sensor.numeric_type_recovery"] === "number";
  console.assert(recoveryClassificationPassed, "Recovered state should resolve as numeric");

  chart.hass = createUnavailableNumericHass({
    ...recoveredStates,
    "sensor.numeric_type_recovery": {
      entity_id: "sensor.numeric_type_recovery",
      state: "79",
      attributes: { friendly_name: "Late numeric recovery" }
    }
  });
  await chart.updateComplete;
  await waitForIdleWork();

  const requestCountPassed = unavailableNumericHistoryRequestCount === 2;
  const passed = initialClassificationPassed && recoveryClassificationPassed && requestCountPassed;
  console.assert(passed, `Expected two history requests, received ${unavailableNumericHistoryRequestCount}`);
  status.dataset.result = passed ? "pass" : "fail";
  status.textContent = passed
    ? "PASS — initial load + exactly one type-change reload; stable numeric update did not refetch."
    : `FAIL — classification or reload count mismatch (requests: ${unavailableNumericHistoryRequestCount}, expected: 2).`;
}

void runUnavailableNumericFixture();

console.log("[dev] Charts configured with synthetic data");

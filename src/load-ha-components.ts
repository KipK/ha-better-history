import {
  HaComponentsLoadError,
  loadHaComponents as loadRequestedHaComponents,
} from "@kipk/load-ha-components";

const HA_COMPONENTS = [
  "ha-icon",
  "ha-button",
  "ha-icon-button",
  "ha-svg-icon",
  "ha-entity-picker",
  "ha-input-chip",
  "ha-assist-chip",
  "ha-generic-picker"
];

let loadPromise: Promise<void> | undefined;

export function ensureHaComponents(): Promise<void> {
  if (HA_COMPONENTS.every((component) => customElements.get(component))) {
    return Promise.resolve();
  }

  loadPromise ??= loadComponents(HA_COMPONENTS, "Home Assistant UI components");
  return loadPromise;
}

let dateRangePickerPromise: Promise<void> | undefined;

export function ensureDateRangePicker(): Promise<void> {
  if (customElements.get("ha-date-range-picker")) {
    return Promise.resolve();
  }

  dateRangePickerPromise ??= loadComponents(
    ["ha-date-range-picker"],
    "ha-date-range-picker",
  );
  return dateRangePickerPromise;
}

async function loadComponents(
  components: readonly string[],
  description: string,
): Promise<void> {
  try {
    await loadRequestedHaComponents(components);
  } catch (error) {
    if (error instanceof HaComponentsLoadError) {
      console.warn(
        `[ha-better-history] Failed to load ${description}. Missing: ${error.result.missing.join(", ") || "unknown"}.`,
        error.cause ?? error,
      );
    } else {
      console.warn(`[ha-better-history] Failed to load ${description}.`, error);
    }
    throw error;
  }
}

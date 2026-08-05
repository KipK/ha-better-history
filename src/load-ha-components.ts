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

  loadPromise ??= loadComponents(HA_COMPONENTS, "Home Assistant UI components")
    .catch((error) => {
      loadPromise = undefined;
      throw error;
    });
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
  ).catch((error) => {
    dateRangePickerPromise = undefined;
    throw error;
  });
  return dateRangePickerPromise;
}

let targetPickerPromise: Promise<boolean> | undefined;
let targetPickerReady = false;
let targetPickerWarningShown = false;

export function ensureTargetPicker(): Promise<boolean> {
  if (targetPickerReady || customElements.get("ha-target-picker")) {
    targetPickerReady = true;
    return Promise.resolve(true);
  }
  targetPickerPromise ??= loadTargetPicker().finally(() => {
    if (!targetPickerReady) targetPickerPromise = undefined;
  });
  return targetPickerPromise;
}

async function loadTargetPicker(): Promise<boolean> {
  try {
    await loadRequestedHaComponents(["ha-target-picker"]);
    targetPickerReady = customElements.get("ha-target-picker") !== undefined;
    if (!targetPickerReady) warnTargetPicker();
  } catch (error) {
    warnTargetPicker(error);
  }
  return targetPickerReady;
}

function warnTargetPicker(error?: unknown): void {
  if (targetPickerWarningShown) return;
  targetPickerWarningShown = true;
  if (error instanceof HaComponentsLoadError) {
    console.warn(
      `[ha-better-history] Failed to load ha-target-picker. Missing: ${error.result.missing.join(", ") || "unknown"}. Falling back to entity-only selection.`,
      error.cause ?? error,
    );
    return;
  }
  console.warn(
    "[ha-better-history] Failed to load ha-target-picker. Falling back to entity-only selection.",
    error,
  );
}

async function loadComponents(
  components: readonly string[],
  description: string,
): Promise<void> {
  try {
    await loadRequestedHaComponents(components);
    const missing = components.filter((component) => !customElements.get(component));
    if (missing.length > 0) {
      throw new Error(`Components were not registered: ${missing.join(", ")}`);
    }
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

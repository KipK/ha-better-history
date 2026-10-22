import type { HomeAssistant } from "../types/ha.js";

export const MAX_DECIMALS = 20;

export function normalizeDecimals(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_DECIMALS
    ? value
    : undefined;
}

export function parseDecimals(value: string): number | undefined {
  return value.trim() === "" ? undefined : normalizeDecimals(Number(value));
}

export function resolveDecimals(
  hass: HomeAssistant | undefined,
  entityId: string,
  attribute: boolean,
  override?: number,
): number | undefined {
  return normalizeDecimals(override)
    ?? (!attribute && entityId.startsWith("sensor.")
      ? normalizeDecimals(hass?.entities?.[entityId]?.display_precision)
      : undefined);
}

const formatters = new Map<string, Intl.NumberFormat>();

export function numberFormatLanguage(hass: HomeAssistant | undefined, language?: string): string | undefined {
  switch (hass?.locale?.number_format) {
    case "comma_decimal": return "en-US";
    case "decimal_comma": return "de";
    case "space_comma": return "fr";
    case "quote_decimal": return "de-CH";
    case "none": return "en-US";
    case "system": return undefined;
    default: return language ?? hass?.locale?.language ?? hass?.language;
  }
}

export function formatNumericValue(value: number | string | boolean, decimals?: number, language?: string): string {
  const precision = normalizeDecimals(decimals);
  if (typeof value !== "number" || !Number.isFinite(value) || precision === undefined) return String(value);

  const key = `${language ?? ""}:${precision}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    const options = { minimumFractionDigits: precision, maximumFractionDigits: precision, useGrouping: false };
    try {
      formatter = new Intl.NumberFormat(language, options);
    } catch {
      formatter = new Intl.NumberFormat("en", options);
    }
    formatters.set(key, formatter);
  }
  const rounded = formatter.format(value);
  return /^-0(?:[.,]0+)?$/.test(rounded) ? rounded.slice(1) : rounded;
}

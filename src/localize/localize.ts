import type { HomeAssistant } from "../types/ha.js";

const HA_KEYS: Record<string, string> = {
  loading: "ui.common.loading",
  empty: "ui.components.history_charts.no_history_found",
  add_target: "ui.components.target-picker.add_target",
  attributes: "ui.dialogs.more_info_control.attributes",
  back: "ui.common.back"
};

const CUSTOM_STRINGS: Record<string, Record<string, string>> = {
  en: {
    no_series: "No series configured",
    no_entity_selected: "No entity selected"
  },
  fr: {
    no_series: "Aucune série configurée",
    no_entity_selected: "Aucune entité sélectionnée"
  }
};

export function localize(hass: HomeAssistant | undefined, key: string): string {
  const haKey = HA_KEYS[key];
  if (haKey && hass?.localize) {
    return hass.localize(haKey);
  }

  const lang = hass?.locale?.language?.split("-")[0] ?? hass?.language?.split("-")[0] ?? "en";
  return CUSTOM_STRINGS[lang]?.[key] ?? CUSTOM_STRINGS["en"]?.[key] ?? key;
}

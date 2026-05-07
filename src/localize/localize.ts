import type { HomeAssistant } from "../types/ha.js";

const HA_KEYS: Record<string, string> = {
  loading: "ui.common.loading",
  empty: "ui.components.history_charts.no_history_found",
  error: "ui.components.history_charts.error",
  add_target: "ui.components.target-picker.add_target",
  attributes: "ui.dialogs.more_info_control.attributes",
  back: "ui.common.back"
};

const CUSTOM_STRINGS: Record<string, Record<string, string>> = {
  en: {
    no_series: "No series configured",
    no_entity_selected: "No entity selected",
    error_timeout: "The request timed out. Please try again.",
    tools: "Tools",
    view_range: "View range",
    reset_zoom: "Reset zoom",
    line_mode: "Display mode",
    mode_stair: "Stair",
    mode_line: "Line",
    mode_column: "Columns",
    export_data: "Export"
  },
  fr: {
    no_series: "Aucune série configurée",
    no_entity_selected: "Aucune entité sélectionnée",
    error_timeout: "La requête a expiré. Veuillez réessayer.",
    tools: "Outils",
    view_range: "Plage affichée",
    reset_zoom: "Réinitialiser le zoom",
    line_mode: "Mode d'affichage",
    mode_stair: "Escalier",
    mode_line: "Ligne",
    mode_column: "Colonnes",
    export_data: "Exporter"
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

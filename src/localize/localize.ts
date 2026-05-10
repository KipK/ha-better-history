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
    export_data: "Export",
    import_data: "Import",
    search_attributes: "Search attributes",
    no_matching_attributes: "No matching attributes",
    attribute_results_limited: "Showing first 50 matches"
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
    export_data: "Exporter",
    import_data: "Importer",
    search_attributes: "Rechercher des attributs",
    no_matching_attributes: "Aucun attribut correspondant",
    attribute_results_limited: "50 premiers résultats affichés"
  },

  cs: {
    no_series: "Není nakonfigurována žádná série",
    no_entity_selected: "Nebyla vybrána žádná entita",
    error_timeout: "Požadavek vypršel. Zkuste to prosím znovu.",
    tools: "Nástroje",
    view_range: "Rozsah zobrazení",
    reset_zoom: "Obnovit přiblížení",
    line_mode: "Režim zobrazení",
    mode_stair: "Schody",
    mode_line: "Čára",
    mode_column: "Sloupce",
    export_data: "Exportovat",
    import_data: "Importovat",
    search_attributes: "Hledat atributy",
    no_matching_attributes: "Žádné odpovídající atributy",
    attribute_results_limited: "Zobrazuje se prvních 50 shod"
  },

  de: {
    no_series: "Keine Serie konfiguriert",
    no_entity_selected: "Keine Entität ausgewählt",
    error_timeout: "Die Anfrage ist abgelaufen. Bitte erneut versuchen.",
    tools: "Werkzeuge",
    view_range: "Anzeigebereich",
    reset_zoom: "Zoom zurücksetzen",
    line_mode: "Anzeigemodus",
    mode_stair: "Stufen",
    mode_line: "Linie",
    mode_column: "Spalten",
    export_data: "Exportieren",
    import_data: "Importieren",
    search_attributes: "Attribute suchen",
    no_matching_attributes: "Keine passenden Attribute",
    attribute_results_limited: "Die ersten 50 Treffer werden angezeigt"
  },

  el: {
    no_series: "Δεν έχει ρυθμιστεί σειρά",
    no_entity_selected: "Δεν έχει επιλεγεί οντότητα",
    error_timeout: "Το αίτημα έληξε χρονικά. Παρακαλώ δοκιμάστε ξανά.",
    tools: "Εργαλεία",
    view_range: "Εύρος προβολής",
    reset_zoom: "Επαναφορά ζουμ",
    line_mode: "Λειτουργία εμφάνισης",
    mode_stair: "Σκάλα",
    mode_line: "Γραμμή",
    mode_column: "Στήλες",
    export_data: "Εξαγωγή",
    import_data: "Εισαγωγή",
    search_attributes: "Αναζήτηση χαρακτηριστικών",
    no_matching_attributes: "Δεν βρέθηκαν χαρακτηριστικά",
    attribute_results_limited: "Εμφανίζονται οι πρώτες 50 αντιστοιχίες"
  },

  it: {
    no_series: "Nessuna serie configurata",
    no_entity_selected: "Nessuna entità selezionata",
    error_timeout: "La richiesta è scaduta. Riprova.",
    tools: "Strumenti",
    view_range: "Intervallo visualizzato",
    reset_zoom: "Reimposta zoom",
    line_mode: "Modalità di visualizzazione",
    mode_stair: "Gradini",
    mode_line: "Linea",
    mode_column: "Colonne",
    export_data: "Esporta",
    import_data: "Importa",
    search_attributes: "Cerca attributi",
    no_matching_attributes: "Nessun attributo corrispondente",
    attribute_results_limited: "Mostrate le prime 50 corrispondenze"
  },

  pl: {
    no_series: "Nie skonfigurowano serii",
    no_entity_selected: "Nie wybrano encji",
    error_timeout: "Upłynął limit czasu żądania. Spróbuj ponownie.",
    tools: "Narzędzia",
    view_range: "Zakres widoku",
    reset_zoom: "Resetuj powiększenie",
    line_mode: "Tryb wyświetlania",
    mode_stair: "Schodkowy",
    mode_line: "Linia",
    mode_column: "Kolumny",
    export_data: "Eksportuj",
    import_data: "Importuj",
    search_attributes: "Szukaj atrybutów",
    no_matching_attributes: "Brak pasujących atrybutów",
    attribute_results_limited: "Pokazano pierwsze 50 wyników"
  },

  ru: {
    no_series: "Серии не настроены",
    no_entity_selected: "Сущность не выбрана",
    error_timeout: "Время ожидания запроса истекло. Повторите попытку.",
    tools: "Инструменты",
    view_range: "Диапазон просмотра",
    reset_zoom: "Сбросить масштаб",
    line_mode: "Режим отображения",
    mode_stair: "Ступени",
    mode_line: "Линия",
    mode_column: "Столбцы",
    export_data: "Экспорт",
    import_data: "Импорт",
    search_attributes: "Поиск атрибутов",
    no_matching_attributes: "Подходящие атрибуты не найдены",
    attribute_results_limited: "Показаны первые 50 совпадений"
  },

  sk: {
    no_series: "Nie je nakonfigurovaná žiadna séria",
    no_entity_selected: "Nie je vybraná žiadna entita",
    error_timeout: "Časový limit požiadavky vypršal. Skúste to znova.",
    tools: "Nástroje",
    view_range: "Rozsah zobrazenia",
    reset_zoom: "Obnoviť priblíženie",
    line_mode: "Režim zobrazenia",
    mode_stair: "Schody",
    mode_line: "Čiara",
    mode_column: "Stĺpce",
    export_data: "Exportovať",
    import_data: "Importovať",
    search_attributes: "Hľadať atribúty",
    no_matching_attributes: "Žiadne zodpovedajúce atribúty",
    attribute_results_limited: "Zobrazuje sa prvých 50 zhôd"
  }
};

export function localize(hass: HomeAssistant | undefined, key: string): string {
  const haKey = HA_KEYS[key];
  if (haKey && hass?.localize) {
    return hass.localize(haKey);
  }

  const lang =
    hass?.locale?.language?.split("-")[0] ??
    hass?.language?.split("-")[0] ??
    "en";

  return CUSTOM_STRINGS[lang]?.[key] ?? CUSTOM_STRINGS["en"]?.[key] ?? key;
}

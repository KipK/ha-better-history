import type { HomeAssistant } from "../types/ha.js";

const HA_KEYS: Record<string, string> = {
  loading: "ui.common.loading",
  empty: "ui.components.history_charts.no_history_found",
  error: "ui.components.history_charts.error",
  add_target: "ui.components.target-picker.add_target",
  attributes: "ui.dialogs.more_info_control.attributes",
  back: "ui.common.back",
  done: "ui.common.done",
  search_entity: "ui.components.entity.entity-picker.search"
};

const CUSTOM_STRINGS: Record<string, Record<string, string>> = {
  en: {
    select_attributes: "Select attributes",
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
    done: "Done",
    search_entity: "Search entity",
    search_attributes: "Search attributes",
    attribute_unit: "Unit",
    attribute_unit_placeholder: "Auto",
    group: "Group",
    group_placeholder: "Default",
    no_matching_attributes: "No matching attributes",
    attribute_results_limited: "Showing first 50 matches"
  },

  fr: {
    select_attributes: "Sélectionner les attributs",
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
    done: "Terminé",
    search_entity: "Rechercher une entité",
    search_attributes: "Rechercher des attributs",
    attribute_unit: "Unité",
    attribute_unit_placeholder: "Auto",
    group: "Groupe",
    group_placeholder: "Défaut",
    no_matching_attributes: "Aucun attribut correspondant",
    attribute_results_limited: "50 premiers résultats affichés"
  },

  cs: {
    select_attributes: "Vybrat atributy",
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
    select_attributes: "Attribute auswählen",
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
    done: "Fertig",
    search_entity: "Entität suchen",
    search_attributes: "Attribute suchen",
    attribute_unit: "Einheit",
    attribute_unit_placeholder: "Auto",
    group: "Gruppe",
    group_placeholder: "Standard",
    no_matching_attributes: "Keine passenden Attribute",
    attribute_results_limited: "Die ersten 50 Treffer werden angezeigt"
  },

  el: {
    select_attributes: "Επιλογή χαρακτηριστικών",
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
    done: "Τέλος",
    search_entity: "Αναζήτηση οντότητας",
    search_attributes: "Αναζήτηση χαρακτηριστικών",
    attribute_unit: "Μονάδα",
    attribute_unit_placeholder: "Αυτόματο",
    group: "Ομάδα",
    group_placeholder: "Προεπιλογή",
    no_matching_attributes: "Δεν βρέθηκαν χαρακτηριστικά",
    attribute_results_limited: "Εμφανίζονται οι πρώτες 50 αντιστοιχίες"
  },

  it: {
    select_attributes: "Seleziona attributi",
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
    done: "Fatto",
    search_entity: "Cerca entità",
    search_attributes: "Cerca attributi",
    attribute_unit: "Unità",
    attribute_unit_placeholder: "Auto",
    group: "Gruppo",
    group_placeholder: "Predefinito",
    no_matching_attributes: "Nessun attributo corrispondente",
    attribute_results_limited: "Mostrate le prime 50 corrispondenze"
  },

  pl: {
    select_attributes: "Wybierz atrybuty",
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
    done: "Gotowe",
    search_entity: "Wyszukaj encję",
    search_attributes: "Szukaj atrybutów",
    attribute_unit: "Jednostka",
    attribute_unit_placeholder: "Auto",
    group: "Grupa",
    group_placeholder: "Domyślny",
    no_matching_attributes: "Brak pasujących atrybutów",
    attribute_results_limited: "Pokazano pierwsze 50 wyników"
  },

  ru: {
    select_attributes: "Выбрать атрибуты",
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
    done: "Готово",
    search_entity: "Поиск сущности",
    search_attributes: "Поиск атрибутов",
    attribute_unit: "Единица",
    attribute_unit_placeholder: "Авто",
    group: "Группа",
    group_placeholder: "По умолчанию",
    no_matching_attributes: "Подходящие атрибуты не найдены",
    attribute_results_limited: "Показаны первые 50 совпадений"
  },

  sk: {
    select_attributes: "Vybrať atribúty",
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
    done: "Hotovo",
    search_entity: "Hľadať entitu",
    search_attributes: "Hľadať atribúty",
    attribute_unit: "Jednotka",
    attribute_unit_placeholder: "Auto",
    group: "Skupina",
    group_placeholder: "Predvolené",
    no_matching_attributes: "Žiadne zodpovedajúce atribúty",
    attribute_results_limited: "Zobrazuje sa prvých 50 zhôd"
  }
};

export function localize(hass: HomeAssistant | undefined, key: string): string {
  const haKey = HA_KEYS[key];
  if (haKey && hass?.localize) {
    const localized = hass.localize(haKey);
    if (localized) return localized;
  }

  const lang =
    hass?.locale?.language?.split("-")[0] ??
    hass?.language?.split("-")[0] ??
    "en";

  return CUSTOM_STRINGS[lang]?.[key] ?? CUSTOM_STRINGS["en"]?.[key] ?? key;
}

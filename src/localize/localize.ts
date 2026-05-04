const STRINGS: Record<string, Record<string, string>> = {
  en: {
    loading: "Loading…",
    empty: "No data",
    no_series: "No series configured"
  },
  fr: {
    loading: "Chargement…",
    empty: "Aucune donnée",
    no_series: "Aucune série configurée"
  }
};

export function localize(language: string | undefined, key: string): string {
  const lang = language?.split("-")[0] ?? "en";

  return STRINGS[lang]?.[key] ?? STRINGS["en"]?.[key] ?? key;
}

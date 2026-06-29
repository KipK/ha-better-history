export const PALETTE = ["#ff9800", "#42a5f5", "#66bb6a", "#ec407a", "#ab47bc", "#26a69a"];

export const CLIMATE_ATTR_COLORS: Record<string, string> = {
  current_temperature: "#42a5f5",
  temperature: "#ff9800",
};

const LOCKED_COLORS = new Set(Object.values(CLIMATE_ATTR_COLORS));
const UNLOCKED_PALETTE = PALETTE.filter((c) => !LOCKED_COLORS.has(c));
const HA_PICKER_THEME_COLORS = new Set([
  "primary",
  "accent",
  "red",
  "pink",
  "purple",
  "deep-purple",
  "indigo",
  "blue",
  "light-blue",
  "cyan",
  "teal",
  "green",
  "light-green",
  "lime",
  "yellow",
  "amber",
  "orange",
  "deep-orange",
  "brown",
  "grey",
  "blue-grey"
]);

export function paletteColor(index: number): string {
  return UNLOCKED_PALETTE[index % UNLOCKED_PALETTE.length];
}

function colorKey(color: string): string {
  return color.trim().toLowerCase();
}

function supportsCssColor(color: string): boolean {
  return typeof CSS === "undefined" || typeof CSS.supports !== "function" || CSS.supports("color", color);
}

function normalizeGraphColor(color: string): string | undefined {
  const trimmed = color.trim();
  if (!trimmed) return undefined;

  const compactName = trimmed.replace(/[\s_-]+/g, "").toLowerCase();

  if (HA_PICKER_THEME_COLORS.has(trimmed)) {
    const fallback = compactName !== trimmed && supportsCssColor(compactName) ? compactName : trimmed;
    return `var(--${trimmed}-color, ${fallback})`;
  }

  if (supportsCssColor(trimmed)) return trimmed;
  if (compactName !== trimmed && supportsCssColor(compactName)) return compactName;

  return undefined;
}

function generatedColor(index: number): string {
  const hue = (index * 137.508) % 360;

  return `hsl(${hue.toFixed(1)} 68% 52%)`;
}

export function graphColor(preferred: string, used: Set<string>, index: number): string {
  const normalizedPreferred = normalizeGraphColor(preferred);

  if (normalizedPreferred && !used.has(colorKey(normalizedPreferred))) return normalizedPreferred;

  const candidates = [
    ...UNLOCKED_PALETTE.slice(index % UNLOCKED_PALETTE.length),
    ...UNLOCKED_PALETTE.slice(0, index % UNLOCKED_PALETTE.length),
    ...PALETTE
  ];

  for (const candidate of candidates) {
    if (!used.has(colorKey(candidate))) return candidate;
  }

  let generatedIndex = index;
  let candidate = generatedColor(generatedIndex);

  while (used.has(colorKey(candidate))) {
    generatedIndex += 1;
    candidate = generatedColor(generatedIndex);
  }

  return candidate;
}

export function graphColorKey(color: string): string {
  return colorKey(color);
}

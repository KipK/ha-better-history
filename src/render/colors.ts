export const PALETTE = ["#ff9800", "#42a5f5", "#66bb6a", "#ec407a", "#ab47bc", "#26a69a"];

export const CLIMATE_ATTR_COLORS: Record<string, string> = {
  current_temperature: "#42a5f5",
  temperature: "#ff9800",
};

const LOCKED_COLORS = new Set(Object.values(CLIMATE_ATTR_COLORS));
const UNLOCKED_PALETTE = PALETTE.filter((c) => !LOCKED_COLORS.has(c));

export function paletteColor(index: number): string {
  return UNLOCKED_PALETTE[index % UNLOCKED_PALETTE.length];
}

function colorKey(color: string): string {
  return color.trim().toLowerCase();
}

function generatedColor(index: number): string {
  const hue = (index * 137.508) % 360;

  return `hsl(${hue.toFixed(1)} 68% 52%)`;
}

export function graphColor(preferred: string, used: Set<string>, index: number): string {
  if (!used.has(colorKey(preferred))) return preferred;

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

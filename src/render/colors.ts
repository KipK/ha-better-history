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

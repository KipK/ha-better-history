export const PALETTE = ["#ff9800", "#42a5f5", "#66bb6a", "#ec407a", "#ab47bc", "#26a69a"];

export function paletteColor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

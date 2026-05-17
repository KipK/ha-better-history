export type TemperatureUnitKey = "c" | "f" | "k";

export function temperatureUnitKey(unit: string | undefined): TemperatureUnitKey | undefined {
  const value = unit?.trim().toLowerCase();
  if (!value) return undefined;
  if (value === "°c" || value === "c" || value === "celsius") return "c";
  if (value === "°f" || value === "f" || value === "fahrenheit") return "f";
  if (value === "k" || value === "kelvin") return "k";
  return undefined;
}

export function isTemperatureUnit(unit: string | undefined): boolean {
  return temperatureUnitKey(unit) !== undefined;
}

export function isSameTemperatureUnit(a: string | undefined, b: string | undefined): boolean {
  const left = temperatureUnitKey(a);
  const right = temperatureUnitKey(b);

  return left !== undefined && left === right;
}

export function canonicalUnitKey(unit: string | undefined): string {
  const temperature = temperatureUnitKey(unit);
  if (temperature) return `temperature:${temperature}`;
  return unit && unit.trim() !== "" ? unit : "__unitless__";
}

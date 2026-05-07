import type { AttributeUnitMap } from "../types/config.js";

export const ATTRIBUTE_UNIT_TEMPERATURE = "temperature";

export function attributePathKey(path: string[]): string {
  return path.join(".");
}

export function isAttributeTemperatureUnit(unit: string | undefined): boolean {
  return unit?.toLowerCase() === ATTRIBUTE_UNIT_TEMPERATURE;
}

export function unitForAttributePath(
  path: string[] | undefined,
  units?: AttributeUnitMap
): string | undefined {
  if (!path || !units) return undefined;
  const key = attributePathKey(path);
  const unit = units[key];
  return typeof unit === "string" && unit !== "" ? unit : undefined;
}

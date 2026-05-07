import type { AttributeUnitMap } from "../types/config.js";

export function attributePathKey(path: string[]): string {
  return path.join(".");
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

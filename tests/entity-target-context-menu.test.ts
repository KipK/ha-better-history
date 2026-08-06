import { describe, expect, it } from "vitest";
import { entityTargetChipFromEvent } from "../src/ui/entity-picker.js";

function eventWithPath(...path: unknown[]): Pick<Event, "composedPath"> {
  return { composedPath: () => path as EventTarget[] };
}

function chip(type: string, itemId: unknown): HTMLElement {
  return {
    localName: "ha-target-picker-value-chip",
    type,
    itemId,
  } as unknown as HTMLElement;
}

describe("entity target context-menu chip resolution", () => {
  it("returns the host and itemId for an entity chip", () => {
    const host = chip("entity", "sensor.kitchen");

    expect(entityTargetChipFromEvent(eventWithPath(host))).toEqual({
      host,
      entityId: "sensor.kitchen",
    });
  });

  it.each(["device", "area", "floor", "label"])("ignores a %s chip", (type) => {
    expect(entityTargetChipFromEvent(eventWithPath(chip(type, "target-id")))).toBeUndefined();
  });

  it.each(["", "   ", 42, undefined])("ignores an invalid itemId: %j", (itemId) => {
    expect(entityTargetChipFromEvent(eventWithPath(chip("entity", itemId)))).toBeUndefined();
  });

  it("ignores a chip-like element with an incomplete contract", () => {
    const incomplete = { localName: "ha-target-picker-value-chip", itemId: "sensor.kitchen" };

    expect(entityTargetChipFromEvent(eventWithPath(incomplete))).toBeUndefined();
  });

  it("finds the host after internal path elements", () => {
    const host = chip("entity", "sensor.kitchen");

    expect(entityTargetChipFromEvent(eventWithPath(
      { localName: "button" },
      { localName: "wa-tag" },
      host,
    ))?.host).toBe(host);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { entityTargetChipFromEvent, renderEntityPicker, type EntityPickerRenderOpts } from "../src/ui/entity-picker.js";
import type { TemplateResult } from "lit";

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

function templates(value: unknown): TemplateResult[] {
  if (Array.isArray(value)) return value.flatMap(templates);
  if (!value || typeof value !== "object" || !("strings" in value) || !("values" in value)) return [];
  const template = value as TemplateResult;
  return [template, ...template.values.flatMap(templates)];
}

function nativePicker(opts: EntityPickerRenderOpts): TemplateResult {
  return templates(renderEntityPicker(opts)).find((template) => template.strings.join("").includes("<ha-target-picker"))!;
}

function handler(template: TemplateResult, event: string): (value: unknown) => void {
  const index = template.strings.findIndex((part) => part.endsWith(`@${event}=`));
  return template.values[index] as (value: unknown) => void;
}

function options(): EntityPickerRenderOpts {
  const noop = () => {};
  return {
    menuOpen: false, entityPickerOpen: false, path: [], selectedSources: [], targetPickerReady: true,
    explicitTargetEntityIds: ["sensor.room"], loading: false, attributeSearch: "", getItems: () => [], getAdditionalItems: () => [],
    onEntityPickerOpened: noop, onEntityPickerClosed: noop, onEntitySelected: noop, onAttributeSearchChanged: noop,
    onSourceAdded: noop, onSourceRemoved: noop, onSourceDragStart: noop, onSourceDragOver: noop, onSourceDragEnd: noop,
    onSourceDrop: noop, onSourceSettingsOpen: noop, onSourceSettingsClose: noop, onSourceSettingsUnitChanged: noop,
    onSourceSettingsGroupChanged: noop, onBreadcrumbClick: noop, onCloseMenu: noop,
    onEntityActionsOpen: vi.fn(() => true),
  };
}

afterEach(() => vi.useRealTimers());

describe("native entity ribbon touch settings", () => {
  it("opens on long press, survives rerender, and consumes the following click", () => {
    vi.useFakeTimers();
    const opts = options();
    const target = {};
    const host = { ...chip("entity", "sensor.room"), isConnected: true };
    const event = {
      ...eventWithPath(host), currentTarget: target, button: 0, pointerType: "touch", clientX: 10, clientY: 20,
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    };
    handler(nativePicker(opts), "pointerdown")(event);
    vi.advanceTimersByTime(560);
    expect(opts.onEntityActionsOpen).toHaveBeenCalledWith("sensor.room", host, event);
    const rerendered = nativePicker(opts);
    const index = rerendered.strings.findIndex((part) => part.endsWith("@click="));
    const clickHandler = rerendered.values[index] as EventListenerObject & { capture: boolean };
    expect(clickHandler.capture).toBe(true);
    clickHandler.handleEvent(event as unknown as Event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });

  it("cancels long press when the user scrolls, including across rerenders", () => {
    vi.useFakeTimers();
    const opts = options();
    const event = {
      ...eventWithPath({ ...chip("entity", "sensor.room"), isConnected: true }), currentTarget: {},
      button: 0, pointerType: "touch", clientX: 10, clientY: 20,
    };
    handler(nativePicker(opts), "pointerdown")(event);
    handler(nativePicker(opts), "pointermove")({ ...event, clientY: 40 });
    vi.advanceTimersByTime(1000);
    expect(opts.onEntityActionsOpen).not.toHaveBeenCalled();
  });

  it("offers clearable decimals for numeric sources and rejects invalid browser input", () => {
    const opts = { ...options(), sourceSettingsSourceId: "attr:sensor.room:value", sourceSettingsNumeric: true,
      sourceSettingsDecimals: 0, onSourceSettingsDecimalsChanged: vi.fn() };
    const field = templates(renderEntityPicker(opts)).find((template) => template.strings.join("").includes('type="number"'))!;
    expect(field.values).toContain("0");
    const change = handler(field, "change");
    change({ target: { value: "", validity: { valid: true } } });
    expect(opts.onSourceSettingsDecimalsChanged).toHaveBeenCalledWith("");
    change({ target: { value: "-1", validity: { valid: false } } });
    expect(opts.onSourceSettingsDecimalsChanged).toHaveBeenCalledOnce();
  });
});

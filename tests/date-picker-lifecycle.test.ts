import { afterEach, describe, expect, it, vi } from "vitest";
import type { TemplateResult } from "lit";
import { HaBetterHistory } from "../src/ha-better-history.js";
import { renderDatePicker } from "../src/ui/date-picker.js";

interface PickerInternals {
  _datePickerOpen: boolean;
  _onDatePickerOpened(): void;
  _onDatePickerClosed(): void;
  _handleBrowserPopState(event: PopStateEvent): void;
  _onDateRangeChanged(start: Date, end: Date): void;
}

function listener(template: TemplateResult, name: string): ((event: Event) => void) | undefined {
  const index = template.strings.findIndex((part) => part.endsWith(`@${name}=`));
  return index < 0 ? undefined : template.values[index] as (event: Event) => void;
}

function interaction(...localNames: string[]): Event {
  return { composedPath: () => localNames.map((localName) => ({ localName })) } as unknown as Event;
}

function setup(parent: Record<string, unknown> = { equinox: { layer: "history-dialog" } }) {
  const entries = [{}, structuredClone(parent)];
  let index = 1;
  let pendingBacks = 0;
  const history = {
    get state() { return entries[index]; },
    pushState: vi.fn((state: Record<string, unknown>) => {
      entries.splice(index + 1);
      entries.push(structuredClone(state));
      index++;
    }),
    back: vi.fn(() => { pendingBacks++; }),
  };
  vi.stubGlobal("window", { history, location: { href: "https://example.invalid/lovelace" } });
  const component = new HaBetterHistory();
  const internals = component as unknown as PickerInternals;
  const cancel = vi.fn((_event: Event) => { internals._onDatePickerClosed(); return true; });
  const nativePicker = { dispatchEvent: cancel };
  const picker = {
    open: vi.fn(),
    shadowRoot: { querySelector: vi.fn(() => nativePicker) },
    dispatchEvent: vi.fn(),
    blur: vi.fn(),
  };
  Object.defineProperty(component, "renderRoot", { value: { querySelector: () => picker } });
  const onChange = vi.fn((start: Date, end: Date) => internals._onDateRangeChanged(start, end));
  const template = renderDatePicker({
    hass: undefined,
    startDate: new Date("2026-10-22T00:00:00Z"),
    endDate: new Date("2026-10-23T00:00:00Z"),
    onOpen: () => internals._onDatePickerOpened(),
    onClose: () => internals._onDatePickerClosed(),
    onChange,
  });
  const emit = (name: string, event: Event = interaction("ha-date-range-picker")) => {
    listener(template, name)?.(event);
  };
  const pop = (state: Record<string, unknown>) => {
    internals._handleBrowserPopState({ state } as PopStateEvent);
  };
  const flushBacks = () => {
    while (pendingBacks > 0 && index > 0) {
      pendingBacks--;
      pop(entries[--index]);
    }
  };
  return { component, internals, history, picker, cancel, onChange, emit, pop, flushBacks, parent };
}

afterEach(() => vi.unstubAllGlobals());

describe("date picker lifecycle inside a history dialog", () => {
  it("updates presets before closing and consumes duplicate native close notifications once", () => {
    const { emit, internals, onChange, history, flushBacks, parent, picker } = setup();
    emit("click");
    const startDate = new Date("2026-10-19T00:00:00Z");
    const endDate = new Date("2026-10-26T00:00:00Z");
    emit("value-changed", new CustomEvent("value-changed", { detail: { value: { startDate, endDate } } }));
    expect(onChange).toHaveBeenCalledWith(startDate, endDate);
    expect(history.back).not.toHaveBeenCalled();
    expect(internals._datePickerOpen).toBe(true);

    emit("picker-closed");
    emit("picker-closed");
    emit("click");
    expect(history.back).toHaveBeenCalledTimes(1);
    expect(history.pushState).toHaveBeenCalledTimes(1);
    flushBacks();
    expect(history.state).toEqual(parent);
    expect(internals._datePickerOpen).toBe(false);
    expect(picker.dispatchEvent).not.toHaveBeenCalled();
    expect(picker.blur).not.toHaveBeenCalled();
  });

  it("does not reopen from restored focus, but allows a new selection after popstate", () => {
    const { emit, history, flushBacks, internals } = setup();
    emit("click");
    emit("picker-closed");
    flushBacks();
    emit("focusin");
    expect(history.pushState).toHaveBeenCalledTimes(1);
    expect(internals._datePickerOpen).toBe(false);
    emit("click");
    expect(history.pushState).toHaveBeenCalledTimes(2);
  });

  it("tracks keyboard or programmatic native opening without relying on focus", () => {
    const { emit, internals, history } = setup();
    emit("wa-show");
    expect(internals._datePickerOpen).toBe(true);
    expect(history.pushState).toHaveBeenCalledTimes(1);
    emit("picker-closed");
    expect(history.back).toHaveBeenCalledTimes(1);
  });

  it("cleans up native cancellation without requiring a changed value", () => {
    const { emit, onChange, history, flushBacks, parent } = setup();
    emit("click");
    emit("picker-closed");
    flushBacks();
    expect(onChange).not.toHaveBeenCalled();
    expect(history.state).toEqual(parent);
  });

  it.each(["ha-icon-button-prev", "ha-icon-button-next"])("shifts the range without overlay history for %s", (name) => {
    const { emit, history } = setup();
    emit("click", interaction("button", name, "ha-date-range-picker"));
    emit("focusin", interaction(name));
    emit("value-changed", new CustomEvent("value-changed", { detail: {
      startDate: new Date("2026-10-21T00:00:00Z"), endDate: new Date("2026-10-22T00:00:00Z"),
    } }));
    expect(history.pushState).not.toHaveBeenCalled();
    expect(history.back).not.toHaveBeenCalled();
  });

  it.each([
    { dialog: "more-info" },
    { opensDialog: true },
    { dialogData: { entityId: "climate.room" } },
  ])("preserves HA-owned dialog history without traversing it: %j", (nativeState) => {
    const parent = { ...nativeState, equinox: { layer: "history-dialog" } };
    const { emit, history, internals } = setup(parent);
    emit("click");
    expect(internals._datePickerOpen).toBe(true);
    emit("picker-closed");
    expect(internals._datePickerOpen).toBe(false);
    expect(history.pushState).not.toHaveBeenCalled();
    expect(history.back).not.toHaveBeenCalled();
    expect(history.state).toEqual(parent);
  });

  it("closes the native picker on Back without Escape, blurring, or a second traversal", () => {
    const { emit, history, pop, parent, cancel, picker } = setup();
    emit("click");
    const forwardState = history.state;
    pop(parent);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel.mock.calls[0][0]).toMatchObject({ type: "cancel-date-picker" });
    emit("picker-closed");
    expect(history.back).not.toHaveBeenCalled();
    expect(picker.dispatchEvent).not.toHaveBeenCalled();
    expect(picker.blur).not.toHaveBeenCalled();

    pop(forwardState);
    expect(picker.open).toHaveBeenCalledTimes(1);
    expect(history.pushState).toHaveBeenCalledTimes(1);
  });

  it("ignores invalid range values", () => {
    const { emit, onChange, history } = setup();
    emit("value-changed", new CustomEvent("value-changed", { detail: { value: { startDate: "invalid" } } }));
    expect(onChange).not.toHaveBeenCalled();
    expect(history.back).not.toHaveBeenCalled();
  });
});

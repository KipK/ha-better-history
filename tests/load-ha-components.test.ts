import { beforeEach, describe, expect, it, vi } from "vitest";

const loader = vi.hoisted(() => ({ load: vi.fn<(components?: readonly string[]) => Promise<unknown>>() }));

vi.mock("@kipk/load-ha-components", () => ({
  HaComponentsLoadError: class HaComponentsLoadError extends Error {
    result = { missing: ["ha-target-picker"] };
    cause?: unknown;
  },
  loadHaComponents: loader.load,
}));

class CustomElementRegistryStub {
  private readonly entries = new Map<string, unknown>();
  get(name: string): unknown { return this.entries.get(name); }
  define(name: string, value: unknown): void { this.entries.set(name, value); }
}

describe("Home Assistant component loading", () => {
  beforeEach(() => {
    vi.resetModules();
    loader.load.mockReset();
    vi.stubGlobal("customElements", new CustomElementRegistryStub());
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("returns immediately when the target picker is registered", async () => {
    customElements.define("ha-target-picker", class {} as CustomElementConstructor);
    const { ensureTargetPicker } = await import("../src/load-ha-components.js");
    await expect(ensureTargetPicker()).resolves.toBe(true);
    expect(loader.load).not.toHaveBeenCalled();
  });

  it("loads, verifies, and shares concurrent target picker requests", async () => {
    loader.load.mockImplementation(async () => {
      customElements.define("ha-target-picker", class {} as CustomElementConstructor);
      return {};
    });
    const { ensureTargetPicker } = await import("../src/load-ha-components.js");
    await expect(Promise.all([ensureTargetPicker(), ensureTargetPicker()])).resolves.toEqual([true, true]);
    expect(loader.load).toHaveBeenCalledTimes(1);
  });

  it("falls back once and retries after failure", async () => {
    loader.load.mockRejectedValueOnce(new Error("unavailable")).mockImplementationOnce(async () => {
      customElements.define("ha-target-picker", class {} as CustomElementConstructor);
      return {};
    });
    const { ensureTargetPicker } = await import("../src/load-ha-components.js");
    await expect(ensureTargetPicker()).resolves.toBe(false);
    await expect(ensureTargetPicker()).resolves.toBe(true);
    expect(loader.load).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("returns false when loading resolves without registration", async () => {
    loader.load.mockResolvedValue({});
    const { ensureTargetPicker } = await import("../src/load-ha-components.js");
    await expect(ensureTargetPicker()).resolves.toBe(false);
  });

  it("propagates common-loader failures and retries", async () => {
    loader.load.mockRejectedValueOnce(new Error("failed")).mockImplementationOnce(async (components) => {
      for (const component of components ?? []) customElements.define(component, class {} as CustomElementConstructor);
      return {};
    });
    const { ensureHaComponents } = await import("../src/load-ha-components.js");
    await expect(ensureHaComponents()).rejects.toThrow("failed");
    await expect(ensureHaComponents()).resolves.toBeUndefined();
    expect(loader.load).toHaveBeenCalledTimes(2);
  });

  it("loads and verifies the date range picker through the shared API", async () => {
    loader.load.mockImplementation(async () => {
      customElements.define("ha-date-range-picker", class {} as CustomElementConstructor);
      return {};
    });
    const { ensureDateRangePicker } = await import("../src/load-ha-components.js");
    await expect(ensureDateRangePicker()).resolves.toBeUndefined();
    expect(loader.load).toHaveBeenCalledWith(["ha-date-range-picker"]);
  });
});

import { describe, expect, it } from "vitest";
import { buildChartData, buildGraphGroups, type RenderableSeries } from "../src/render/chart.js";
import { tickPrecision } from "../src/render/scales.js";

function series(values: number[], decimals?: number): RenderableSeries {
  return {
    id: "state:sensor.room", entity: "sensor.room", label: "Room", color: "blue", unit: "°C",
    scaleGroupKey: "temperature", scaleMode: "auto", scalePreference: "auto", lineMode: "stair",
    lineWidth: "2", showPoints: false, pointRadius: 2.5, valueType: "number", decimals,
    points: values.map((value, index) => ({ time: index * 1000, value })),
  };
}

function chart(values: number[], decimals?: number) {
  const input = series(values, decimals);
  return buildChartData([input], [input], { start: 0, end: (values.length - 1) * 1000 });
}

describe("adaptive Y-axis labels", () => {
  it("drops fractional zeros introduced by the original data precision", () => {
    const data = chart([15.364, 24.364]);
    const labels = buildGraphGroups(data)[0].yLabels;
    expect(labels.map((label) => label.value)).toContain("20");
    expect(labels.every((label) => !label.value.includes("."))).toBe(true);
    expect(data.yAxisLabels.every((label) => !label.value.includes("."))).toBe(true);
  });

  it.each([[19, 20], [19.1, 19.4], [0.0001, 0.0004], [-0.4, 0.4]])("keeps distinct readable ticks for %j", (...values) => {
    const data = chart(values);
    for (const height of [48, 80, 120, 180, 300]) {
      const labels = buildGraphGroups(data, 12, height)[0].yLabels;
      expect(labels.length).toBeGreaterThan(0);
      expect(new Set(labels.map((label) => label.value)).size).toBe(labels.length);
      expect(labels.every((label) => label.value !== "-0")).toBe(true);
      for (let i = 1; i < labels.length; i++) {
        expect(Math.abs(labels[i].y - labels[i - 1].y)).toBeGreaterThanOrEqual(36 - 1e-6);
      }
    }
  });

  it("shows fewer ticks on short graphs and fractional ticks on zoomed ranges", () => {
    const data = chart([10.364, 29.364]);
    expect(buildGraphGroups(data, 12, 60)[0].yLabels.length)
      .toBeLessThan(buildGraphGroups(data, 12, 240)[0].yLabels.length);
    const zoomed = buildGraphGroups(chart([19.1, 19.4]), 12, 240)[0].yLabels;
    expect(zoomed.some((label) => label.value.includes("."))).toBe(true);
  });

  it("keeps bounds and line geometry independent of tooltip decimals", () => {
    const original = chart([19.364, 19.497]);
    const rounded = chart([19.364, 19.497], 0);
    expect(rounded.numericScales).toEqual(original.numericScales);
    expect(rounded.numericLines).toEqual(original.numericLines);
    expect(buildGraphGroups(rounded)[0].yLabels).toEqual(buildGraphGroups(original)[0].yLabels);
  });

  it("understands scientific notation when computing tick precision", () => {
    expect(tickPrecision([0, 1e-7, 2e-7])).toBe(7);
    expect(tickPrecision([0, 1.5e-7])).toBe(8);
    expect(tickPrecision([1e+8, 2e+8])).toBe(0);
  });
});

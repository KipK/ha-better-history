# ha-better-history

Author: @KipK

Standalone web component for Home Assistant history charts. Built with **Lit 3** and **TypeScript**. Renders SVG charts with no external charting dependencies.

**Status: WIP** — API not yet stable.

## Quick start

```html
<ha-better-history></ha-better-history>

<script type="module" src="dist/define.js"></script>
<script>
  const chart = document.querySelector("ha-better-history");
  chart.hass = hass;                         // required: HomeAssistant instance
  chart.entities = ["sensor.temperature", "sensor.humidity"];
</script>
```

## Properties

All properties are camelCase in JS and kebab-case as HTML attributes (for boolean/string/number props). Object/complex props are JS-only (no attribute).

### Top-level attributes (HTML)

| Attribute            | Type      | Default   | Description                                       |
| -------------------- | --------- | --------- | ------------------------------------------------- |
| `hours`              | `number`  | `24`      | Time range in hours before `endDate`              |
| `show-date-picker`   | `boolean` | `false`   | Show `ha-date-range-picker` above the chart       |
| `show-entity-picker` | `boolean` | `false`   | Show entity picker + attribute browser            |
| `show-legend`        | `boolean` | `true`    | Legend below the chart                            |
| `show-tooltip`       | `boolean` | `true`    | Multi-series tooltip on hover                     |
| `width`              | `string`  | `"100%"`  | CSS width of the component wrapper                |
| `height`             | `string`  | —         | CSS height; if omitted, computed from graph count |
| `language`           | `string`  | HA locale | Language code for labels (`"en"`, `"fr"`, …)      |

### JS-only properties

| Property    | Type                  | Default     | Description                                |
| ----------- | --------------------- | ----------- | ------------------------------------------ |
| `hass`      | `HomeAssistant`       | —           | **Required.** The Home Assistant object    |
| `config`    | `BetterHistoryConfig` | `undefined` | Full declarative configuration             |
| `entities`  | `string[]`            | `undefined` | Shortcut: entity IDs to plot their `state` |
| `startDate` | `Date`                | `undefined` | Lower bound (overrides `hours`)            |
| `endDate`   | `Date`                | `undefined` | Upper bound (default: now)                 |

## `BetterHistoryConfig`

The `config` property accepts a `BetterHistoryConfig` object. Every field is optional — the component does something reasonable when nothing is provided.

```ts
interface BetterHistoryConfig {
  // Time window
  hours?: number;                    // default: 24
  startDate?: Date;
  endDate?: Date;

  // UI chrome
  showDatePicker?: boolean;          // default: false
  showEntityPicker?: boolean;        // default: false
  showLegend?: boolean;              // default: true
  showTooltip?: boolean;             // default: true
  width?: string;                    // default: "100%"
  height?: string;

  // Data
  series?: SeriesConfig[];           // explicit series list
  defaultEntities?: string[];        // shown in entity picker when enabled
  disableClimateOverlay?: boolean;   // default: false
}
```

### `SeriesConfig`

Each series describes what to plot and how it should be displayed.

```ts
interface SeriesConfig {
  entity: string;                    // Required: entity_id (e.g. "climate.living")
  attribute?: string | string[];     // Dotted path or array; omit = entity.state
  label?: string;                    // Legend label; default = friendly_name or attribute path
  color?: string;                    // CSS color; default = automatic palette
  unit?: string;                     // Override unit (for axis grouping and label)

  scaleGroup?: string;               // Series with same scaleGroup share a Y axis
  scaleMode?: "auto" | "manual";     // default: "auto"
  scaleMin?: number;                 // only when scaleMode = "manual"
  scaleMax?: number;                 // only when scaleMode = "manual"
}
```

## Scale grouping rules

1. **Automatic (default)**: numeric series with the **same unit** share a graph and Y axis. Series with different units (or no unit) each get their own stacked graph. Non-numeric series (string/boolean) render as **colored segment ribbons** below the numeric graphs.

2. **Explicit `scaleGroup`**: series sharing a `scaleGroup` value share the same graph and Y axis regardless of unit. Un-grouped series continue to use rule 1 among themselves.

3. **`scaleMode: "manual"`**: locks the Y axis to `[scaleMin, scaleMax]`. If the series is in a shared scale group, the manual range takes priority: the axis is extended (never contracted) to accommodate the manual range.

## Colors

If `color` is not set, the built-in palette cycles through: `#ff9800`, `#42a5f5`, `#66bb6a`, `#ec407a`, `#ab47bc`, `#26a69a`.

## Events

All events bubble and are composed.

| Event             | Detail                                             | When                                                        |
| ----------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| `range-changed`   | `{ startDate: Date, endDate: Date }`               | Date picker changes                                         |
| `series-toggled`  | `{ id: string, hidden: boolean }`                  | Legend item clicked                                         |
| `series-added`    | `{ source: HistorySource }`                        | User adds a series via entity picker                        |
| `series-removed`  | `{ sourceId: string }`                             | User removes a non-default series                           |
| `tooltip-changed` | `{ time: number, values: TooltipValue[] } \| null` | Mouse moves over chart (useful for syncing multiple charts) |

## Default behaviour (no config)

When both `config` and `entities` are undefined:

- If the element has an `entity` attribute/prop, its `state` is plotted.
- Otherwise, renders an empty slot.

When `entities` is a non-empty array:

- Plots `entity.state` for each entity ID.
- Range = 24 hours.
- Date/entity pickers OFF, legend ON, tooltip ON.

## Recipes

### Two sensors with shared temperature scale

```js
chart.config = {
  series: [
    { entity: "climate.living", attribute: "current_temperature", label: "Indoor",  scaleGroup: "temp" },
    { entity: "sensor.outdoor_temp",                              label: "Outdoor", scaleGroup: "temp" },
  ]
};
```

### Climate entity with heating area overlay

When a chart includes **both** `current_temperature` and `hvac_action` attributes from the **same** climate entity, the component automatically draws a semi-transparent area under the temperature line during `"heating"` periods.

```js
chart.config = {
  series: [
    { entity: "climate.living", attribute: "current_temperature", label: "Temperature", color: "#42a5f5" },
    { entity: "climate.living", attribute: "hvac_action",         label: "State" },
  ]
};
```

Disable with `disableClimateOverlay: true`.

### Manual Y axis range

```js
chart.config = {
  series: [
    { entity: "sensor.pressure", label: "Pressure", scaleMode: "manual", scaleMin: 960, scaleMax: 1040 }
  ]
};
```

### With date picker enabled

```html
<ha-better-history show-date-picker></ha-better-history>
<script>
  chart.addEventListener("range-changed", (e) => {
    console.log(e.detail.startDate, e.detail.endDate);
  });
</script>
```

### With entity picker enabled

```html
<ha-better-history show-entity-picker></ha-better-history>
<script>
  chart.config = {
    defaultEntities: ["climate.living", "sensor.outdoor_temp"],
    series: [
      { entity: "climate.living", attribute: "current_temperature", label: "Indoor" }
    ]
  };
</script>
```

The entity picker lets users browse entity attributes and add/remove series at runtime. Non-default series are removable via chip buttons.

## CSS custom properties

Override these on the host element to customize appearance.

| Property                        | Fallback                  |
| ------------------------------- | ------------------------- |
| `--better-history-bg`           | `--card-background-color` |
| `--better-history-text-color`   | `--primary-text-color`    |
| `--better-history-muted-color`  | `--secondary-text-color`  |
| `--better-history-border-color` | `--divider-color`         |
| `--better-history-accent-color` | `--accent-color`          |
| `--better-history-radius`       | `8px`                     |
| `--better-history-font-family`  | `inherit`                 |

## Loading / setup

**Bundled** (recommended for production):

```js
// Auto-registers <ha-better-history>
import "ha-better-history/define";
```

**Manual register** (no side-effect import):

```js
import { HaBetterHistory } from "ha-better-history";
customElements.define("ha-better-history", HaBetterHistory);
```

**Date picker / entity picker** load their required HA components lazily via `@kipk/load-ha-components`. If `show-date-picker` or `show-entity-picker` is set, the component calls `ensureDateRangePicker()` / `ensureHaComponents()` on `connectedCallback`. These must run inside a Home Assistant frontend context (where `partial-panel-resolver` is available). In a standalone dev page, loading will fail gracefully after a 10-second timeout.

## Dev page

```bash
npm install
npm run dev
```

Opens a local Vite dev server with synthetic data. No HA instance needed. See `dev/index.html`.

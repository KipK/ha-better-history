# ha-better-history

Standalone web component for Home Assistant history charts.

**Status: WIP** — API not yet stable.

See [implementation plan](plans/ha-better-history-implementation-prompt.md) for full spec.

## Basic usage

```html
<ha-better-history></ha-better-history>
<script type="module" src="dist/define.js"></script>
<script>
  const el = document.querySelector("ha-better-history");
  el.hass = hass;
  el.entities = ["sensor.temperature"];
</script>
```

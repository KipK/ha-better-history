import { css } from "lit";

export const chartStyles = css`
  :host {
    display: block;
    font-family: var(--better-history-font-family, inherit);
  }

  .chart-surface {
    position: relative;
    overflow-y: auto;
  }

  .chart-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 180px;
    padding: 40px 0;
  }

  svg {
    width: 100%;
    display: block;
    touch-action: pan-y;
  }

  .axis {
    stroke: var(--better-history-border-color, var(--divider-color, #444));
    stroke-width: 1;
  }

  .graph-separator {
    stroke: var(--better-history-border-color, var(--divider-color, #444));
    stroke-width: 1.2;
    stroke-dasharray: 3 5;
    opacity: 0.64;
  }

  .line {
    fill: none;
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }

  .segment {
    opacity: 0.7;
  }

  .climate-heating-area {
    fill: var(--better-history-accent-color, var(--accent-color, #ff9800));
    opacity: 0.22;
  }

  .y-axis-label {
    position: absolute;
    font-size: 11px;
    color: var(--better-history-muted-color, var(--secondary-text-color, #888));
    transform: translateY(-50%);
    white-space: nowrap;
    pointer-events: none;
    box-sizing: border-box;
    line-height: 1;
    z-index: 1;
  }

  .chart-tooltip-clip {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .chart-loading-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  .chart-loading-label {
    font-size: 11px;
    color: var(--better-history-muted-color, var(--secondary-text-color, #888));
    background: color-mix(in srgb, var(--better-history-bg, var(--card-background-color, #1e1e2e)) 92%, #000 8%);
    padding: 3px 10px;
    border-radius: 10px;
    border: 1px solid var(--better-history-border-color, var(--divider-color, #444));
    opacity: 0.88;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;
    font-size: 12px;
    color: var(--better-history-muted-color, var(--secondary-text-color, #888));
  }

  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    border: 0;
    background: transparent;
    color: inherit;
    padding: 0;
    font: inherit;
    cursor: pointer;
  }

  .legend-item[hidden-series] {
    opacity: 0.38;
  }

  .swatch {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex: 0 0 auto;
    box-sizing: border-box;
  }

  .legend-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 160px;
  }

  .tooltip {
    position: absolute;
    z-index: 2;
    min-width: 170px;
    width: max-content;
    max-width: min(300px, calc(100% - 16px));
    padding: 8px;
    border-radius: var(--better-history-radius, 8px);
    background: color-mix(in srgb, var(--better-history-bg, var(--card-background-color, #1e1e2e)) 88%, #000 12%);
    border: 1px solid var(--better-history-border-color, var(--divider-color, #444));
    box-shadow: 0 8px 20px rgb(0 0 0 / 28%);
    color: var(--better-history-text-color, var(--primary-text-color, #fff));
    font-size: 12px;
    pointer-events: none;
    box-sizing: border-box;
  }

  .tooltip-time {
    margin-bottom: 6px;
    color: var(--better-history-muted-color, var(--secondary-text-color, #888));
    font-size: 11px;
  }

  .tooltip-row {
    display: grid;
    grid-template-columns: 8px minmax(0, 1fr) auto;
    align-items: center;
    gap: 6px;
    margin-top: 3px;
  }

  .tooltip-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tooltip-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .empty,
  .error {
    padding: 20px;
    color: var(--better-history-muted-color, var(--secondary-text-color, #888));
    text-align: center;
    font-size: 13px;
  }

  .error {
    color: #ff6b6b;
  }

  .controls-bar {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 8px;
  }

  .controls-bar .entity-picker {
    margin-bottom: 0;
  }

  .controls-bar .entity-selected-row {
    margin-bottom: 0;
  }

  .date-picker-wrapper {
    width: fit-content;
    max-width: 100%;
    min-width: 0;
    overflow: visible;
  }

  .date-picker-wrapper ha-date-range-picker {
    display: block;
  }

  .entity-picker {
    position: relative;
    width: 170px;
    flex-shrink: 0;
    margin-bottom: 8px;
  }

  .entity-trigger {
    display: inline-grid;
    grid-template-columns: minmax(0, 1fr) 18px;
    align-items: center;
    gap: 6px;
    width: 100%;
    text-align: left;
    border: 0;
    border-radius: var(--better-history-radius, 8px);
    background: var(--better-history-bg, color-mix(in srgb, var(--card-background-color, #1e1e2e) 92%, var(--primary-text-color, #fff) 8%));
    color: var(--better-history-text-color, var(--primary-text-color, #fff));
    min-height: 30px;
    padding: 0 10px;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;
  }

  .entity-trigger[open] {
    background: var(--better-history-accent-color, var(--accent-color, #ff9800));
    color: #fff;
  }

  .entity-trigger span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .entity-trigger-arrow {
    font-size: 12px;
    line-height: 1;
  }

  .entity-menu {
    position: fixed;
    top: -9999px;
    left: -9999px;
    display: none;
    width: min(420px, calc(100vw - 48px));
    max-height: 420px;
    padding: 8px;
    overflow: hidden;
    border: 1px solid var(--better-history-border-color, var(--divider-color, #444));
    border-radius: var(--better-history-radius, 8px);
    background: var(--better-history-bg, color-mix(in srgb, var(--card-background-color, #1e1e2e) 94%, var(--primary-text-color, #fff) 6%));
    box-shadow: 0 14px 36px rgb(0 0 0 / 30%);
    box-sizing: border-box;
    z-index: 100;
  }

  .entity-menu[open] {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    gap: 8px;
  }

  .entity-menu-top {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .entity-menu-top ha-entity-picker {
    display: block;
  }

  .entity-menu-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: 0;
    background: transparent;
    color: var(--better-history-muted-color, var(--secondary-text-color, #888));
    cursor: pointer;
    font-size: 14px;
    flex-shrink: 0;
  }

  .entity-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-width: 0;
  }

  .entity-chip {
    display: inline-flex;
    align-items: center;
    height: 28px;
    padding: 0 12px;
    border: 1px solid var(--better-history-border-color, var(--divider-color, #444));
    border-radius: 16px;
    background: transparent;
    color: var(--better-history-text-color, var(--primary-text-color, #fff));
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .entity-chip[active] {
    border-color: var(--better-history-accent-color, var(--accent-color, #ff9800));
    background: color-mix(in srgb, var(--better-history-accent-color, var(--accent-color, #ff9800)) 15%, transparent);
    color: var(--better-history-accent-color, var(--accent-color, #ff9800));
  }

  .entity-chip ha-input-chip {
    --md-input-chip-container-shape: 16px;
    --md-input-chip-label-text-font: inherit;
    --md-input-chip-label-text-size: 13px;
    --md-input-chip-outline-color: var(--better-history-border-color, var(--divider-color, #444));
  }

  .entity-browser {
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .entity-breadcrumb {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    margin-bottom: 6px;
    color: var(--better-history-muted-color, var(--secondary-text-color, #888));
    font-size: 12px;
  }

  .entity-crumb {
    border: 0;
    background: transparent;
    color: inherit;
    padding: 0;
    font: inherit;
    cursor: pointer;
  }

  .entity-breadcrumb-sep {
    opacity: 0.5;
  }

  .entity-browser-list {
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  .entity-browser-entries {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .entity-browser-entry {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 8px;
    border-radius: var(--better-history-radius, 8px);
    cursor: pointer;
    font-size: 13px;
    color: var(--better-history-text-color, var(--primary-text-color, #fff));
  }

  .entity-browser-entry:hover {
    background: rgba(var(--rgb-primary-text-color, 255, 255, 255), 0.08);
  }

  .entity-browser-entry-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .entity-browser-entry-type,
  .entity-browser-entry-arrow {
    color: var(--better-history-muted-color, var(--secondary-text-color, #888));
    font-size: 11px;
    flex-shrink: 0;
  }

  .entity-browser-back {
    padding: 6px 8px;
    cursor: pointer;
    font-size: 12px;
    color: var(--better-history-accent-color, var(--accent-color, #ff9800));
    border-radius: var(--better-history-radius, 8px);
  }

  .entity-browser-back:hover {
    background: rgba(var(--rgb-primary-text-color, 255, 255, 255), 0.08);
  }

  .entity-browser-empty {
    padding: 12px;
    color: var(--better-history-muted-color, var(--secondary-text-color, #888));
    font-size: 13px;
    text-align: center;
  }

  .entity-selected-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-width: 0;
    margin-bottom: 8px;
  }

  .entity-selected-row ha-input-chip {
    flex-shrink: 0;
    --md-input-chip-container-height: 28px;
    --md-input-chip-label-text-size: 12px;
    --md-input-chip-container-shape: 16px;
    --md-input-chip-label-text-font: inherit;
    --md-input-chip-outline-color: var(--better-history-border-color, var(--divider-color, #444));
  }

  .entity-default-chip {
    display: inline-flex;
    align-items: center;
    height: 28px;
    padding: 0 12px;
    border: 1px solid var(--better-history-border-color, var(--divider-color, #444));
    border-radius: 16px;
    background: transparent;
    color: var(--better-history-text-color, var(--primary-text-color, #fff));
    font-size: 12px;
    font-family: inherit;
    white-space: nowrap;
    flex-shrink: 0;
  }
`;

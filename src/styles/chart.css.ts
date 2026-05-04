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
`;

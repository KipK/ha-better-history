import { HaBetterHistory } from "./ha-better-history.js";

export function defineHaBetterHistory(tagName = "ha-better-history"): void {
  if (!customElements.get(tagName)) {
    customElements.define(tagName, HaBetterHistory);
  }
}

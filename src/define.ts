import { HaBetterHistory } from "./ha-better-history.js";

if (!customElements.get("ha-better-history")) {
  customElements.define("ha-better-history", HaBetterHistory);
}

declare global {
  interface HTMLElementTagNameMap {
    "ha-better-history": HaBetterHistory;
  }
}

/**
 * Home Assistant's dialog manager stores `dialog`, `dialogData` or `opensDialog`
 * in `history.state` and interprets them on `popstate`. Returning to such an
 * entry with `history.back()` makes HA close (or ask to close) the parent
 * dialog, so overlay layers must not be pushed on top of it.
 */
export function haDialogOwnsHistory(state: unknown = window.history.state): boolean {
  return typeof state === "object" && state !== null
    && ("dialog" in state || "dialogData" in state || "opensDialog" in state);
}

import { LitElement, css, html, type PropertyValues, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import { chartStyles } from "../styles/chart.css.js";
import {
  renderEntityPicker,
  preloadEntityPickerComponents,
  entityPickerItems,
  filterEntityPickerItems,
} from "./entity-picker.js";
import type { HistorySource } from "../data/history.js";
import type { HassEntity, HomeAssistant } from "../types/ha.js";

const BROWSER_HISTORY_STATE_KEY = "haBetterHistory";

type BrowserHistoryLayer = "entity-picker" | "attribute-picker";

interface BrowserHistoryEntry {
  instanceId: string;
  layer: BrowserHistoryLayer;
}

export class SeriesPickerElement extends LitElement {
  static styles = [
    chartStyles,
    css`
      :host {
        display: block;
      }
    `,
  ];

  @property({ attribute: false }) hass?: HomeAssistant;
  @property({ attribute: false }) initialSources?: HistorySource[];
  @property({ type: Boolean, attribute: "browser-history" }) browserHistory = true;

  @state() private _selectedSources: HistorySource[] = [];
  @state() private _attributeMenuOpen = false;
  @state() private _entityPickerOpen = false;
  @state() private _selectedEntityId?: string;
  @state() private _entitySearch = "";
  @state() private _path: string[] = [];
  @state() private _attributeSearch = "";
  @state() private _componentsReady = false;
  @state() private _customEntityIds: string[] = [];

  private readonly _browserHistoryInstanceId = `abh-picker-${Math.random().toString(36).slice(2)}`;
  private _lastPointerDownInside = false;
  private _syncingBrowserHistory = false;
  private _selectingEntityForAttributeMenu = false;

  private readonly _handleDocumentPointerDown = (event: Event): void => {
    this._lastPointerDownInside = this._isEventInsideAttributeOverlay(event);
    if (!this._attributeMenuOpen) return;
    if (this._lastPointerDownInside) return;
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  private readonly _handleDocumentClick = (event: Event): void => {
    if (!this._attributeMenuOpen && !this._entityPickerOpen) {
      this._lastPointerDownInside = false;
      return;
    }
    const pointerWasInside = this._lastPointerDownInside;
    this._lastPointerDownInside = false;
    if (pointerWasInside) return;
    if (this._isEventInsideAttributeOverlay(event)) return;
    if (this._entityPickerOpen && !this._attributeMenuOpen) {
      this._closeBrowserHistoryLayer("entity-picker", () => {
        this._entityPickerOpen = false;
        this._entitySearch = "";
      });
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    this._closeAttributeMenu();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("pointerdown", this._handleDocumentPointerDown, true);
    document.addEventListener("click", this._handleDocumentClick, true);
    window.addEventListener("popstate", this._handleBrowserPopState);
    preloadEntityPickerComponents().then(() => {
      this._componentsReady = true;
    });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("pointerdown", this._handleDocumentPointerDown, true);
    document.removeEventListener("click", this._handleDocumentClick, true);
    window.removeEventListener("popstate", this._handleBrowserPopState);
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has("initialSources") && this.initialSources) {
      this._selectedSources = [...this.initialSources];
    }
    if (
      (changed.has("_attributeMenuOpen") && this._attributeMenuOpen) ||
      (changed.has("_entityPickerOpen") && this._entityPickerOpen)
    ) {
      void this.updateComplete.then(() => this._positionEntityMenu());
    }
  }

  private _isEventInsideAttributeOverlay(event: Event): boolean {
    const path = event.composedPath();

    const menu = this.renderRoot?.querySelector(".entity-menu[open], .entity-select-menu[open]");
    if (menu && this._pathContainsElement(path, menu)) return true;

    const trigger = this.renderRoot?.querySelector(".entity-trigger");
    if (trigger && this._pathContainsElement(path, trigger)) return true;

    for (const el of path) {
      if (el === this) break;
      if (!(el instanceof HTMLElement)) continue;
      const tag = el.localName;
      if (
        tag === "ha-generic-picker" ||
        tag === "ha-combo-box" ||
        tag === "vaadin-combo-box-overlay" ||
        tag === "mwc-menu-surface" ||
        tag === "ha-md-list" ||
        tag === "md-menu"
      ) {
        return true;
      }
    }
    return false;
  }

  private _pathContainsElement(path: EventTarget[], element: Element): boolean {
    return path.some((target) => target instanceof Node && element.contains(target));
  }

  private _positionEntityMenu(): void {
    const trigger = this.renderRoot?.querySelector(".entity-trigger") as HTMLElement | null;
    const menu = this.renderRoot?.querySelector(".entity-menu[open], .entity-select-menu[open]") as HTMLElement | null;
    if (!trigger || !menu) return;

    menu.style.top = "0";
    menu.style.left = "0";
    menu.style.right = "";
    menu.style.width = "";
    // When inside a CSS-transformed ancestor (e.g. a dialog), fixed positions
    // are relative to that ancestor. We measure the origin offset and convert.
    const originRect = menu.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    const hostRect = this.getBoundingClientRect();
    const margin = 8;

    const available = hostRect.bottom - margin - triggerRect.bottom - margin;
    menu.style.maxHeight = `${Math.min(Math.max(available, 120), 420)}px`;
    menu.style.top = `${triggerRect.bottom - originRect.top + 6}px`;

    const leftBoundaryVp = hostRect.left + margin;
    const rightBoundaryVp = hostRect.right - margin;
    const availableWidth = rightBoundaryVp - leftBoundaryVp;
    const menuWidth = Math.min(420, availableWidth);
    menu.style.width = `${menuWidth}px`;

    let leftVp: number;
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      leftVp = triggerRect.left;
      leftVp = Math.min(leftVp, rightBoundaryVp - menuWidth);
      leftVp = Math.max(leftVp, leftBoundaryVp);
    } else {
      leftVp = leftBoundaryVp;
      menu.style.width = `${availableWidth}px`;
    }
    menu.style.left = `${leftVp - originRect.left}px`;
    menu.style.right = "";
  }

  private _browserHistoryEntry(state = window.history.state): BrowserHistoryEntry | undefined {
    const entry = typeof state === "object" && state !== null
      ? (state as Record<string, unknown>)[BROWSER_HISTORY_STATE_KEY]
      : undefined;

    if (typeof entry !== "object" || entry === null) return undefined;

    const record = entry as Partial<BrowserHistoryEntry>;
    if (record.instanceId !== this._browserHistoryInstanceId) return undefined;
    if (record.layer !== "entity-picker" && record.layer !== "attribute-picker") return undefined;

    return { instanceId: record.instanceId, layer: record.layer };
  }

  private _browserHistoryState(layer: BrowserHistoryLayer): Record<string, unknown> {
    const current = typeof window.history.state === "object" && window.history.state !== null
      ? window.history.state as Record<string, unknown>
      : {};

    return {
      ...current,
      [BROWSER_HISTORY_STATE_KEY]: {
        instanceId: this._browserHistoryInstanceId,
        layer
      }
    };
  }

  private _pushBrowserHistoryLayer(layer: BrowserHistoryLayer): void {
    if (!this.browserHistory) return;
    if (this._syncingBrowserHistory) return;
    if (this._browserHistoryEntry()?.layer === layer) return;

    window.history.pushState(this._browserHistoryState(layer), "", window.location.href);
  }

  private _replaceBrowserHistoryLayer(layer: BrowserHistoryLayer): void {
    if (!this.browserHistory) return;
    if (this._syncingBrowserHistory) return;

    window.history.replaceState(this._browserHistoryState(layer), "", window.location.href);
  }

  private _closeBrowserHistoryLayer(layer: BrowserHistoryLayer, close: () => void): void {
    if (this.browserHistory && !this._syncingBrowserHistory && this._browserHistoryEntry()?.layer === layer) {
      window.history.back();
      return;
    }

    close();
  }

  private readonly _handleBrowserPopState = (event: PopStateEvent): void => {
    const entry = this._browserHistoryEntry(event.state);

    this._syncingBrowserHistory = true;
    try {
      if (!entry) {
        this._closePickerOverlay();
        return;
      }

      this._entityPickerOpen = entry.layer === "entity-picker";
      this._attributeMenuOpen = entry.layer === "attribute-picker";
      if (entry.layer !== "attribute-picker") {
        this._attributeSearch = "";
      }
    } finally {
      this._syncingBrowserHistory = false;
    }
  };

  private _pickerEntities(): HassEntity[] {
    if (!this.hass) return [];
    return this._customEntityIds
      .filter((id) => typeof id === "string" && id !== "")
      .filter((id, idx, arr) => arr.indexOf(id) === idx)
      .map((id) => this.hass?.states[id])
      .filter((e): e is HassEntity => e !== undefined);
  }

  private readonly _getItems = (): unknown[] =>
    entityPickerItems(this.hass);

  private readonly _getAdditionalItems = (search?: string): unknown[] => {
    if (!this.hass || !search?.trim()) return [];
    const pinnedIds = new Set(this._pickerEntities().map((e) => e.entity_id));
    const items = entityPickerItems(
      this.hass,
      Object.values(this.hass.states)
        .filter((entity): entity is HassEntity => entity !== undefined)
        .filter((entity) => !pinnedIds.has(entity.entity_id))
    );
    return filterEntityPickerItems(items, search);
  };

  private _onEntitySelected(entityId: string): void {
    this._selectingEntityForAttributeMenu = true;
    const knownIds = new Set(this._pickerEntities().map((e) => e.entity_id));
    if (!knownIds.has(entityId)) {
      this._customEntityIds = [...this._customEntityIds, entityId];
    }
    this._selectedEntityId = entityId;
    this._entitySearch = "";
    this._path = [];
    this._attributeSearch = "";
    this._entityPickerOpen = false;
    this._attributeMenuOpen = true;
    if (this._browserHistoryEntry()?.layer === "entity-picker") {
      this._replaceBrowserHistoryLayer("attribute-picker");
    } else {
      this._pushBrowserHistoryLayer("attribute-picker");
    }

    queueMicrotask(() => {
      this._selectingEntityForAttributeMenu = false;
    });
  }

  private _closeAttributeMenu(): void {
    this._closeBrowserHistoryLayer("attribute-picker", () => this._closePickerOverlay());
  }

  private _closePickerOverlay(): void {
    this._attributeMenuOpen = false;
    this._entityPickerOpen = false;
    this._entitySearch = "";
    this._attributeSearch = "";
    // Auto-confirm and reset when the attribute browser closes with pending sources.
    if (this._selectedSources.length > 0) {
      this._confirm();
      this._selectedSources = [];
    }
  }

  private _addSource(source: HistorySource): void {
    if (this._selectedSources.some((s) => s.id === source.id)) return;
    this._selectedSources = [...this._selectedSources, source];
  }

  private _removeSource(sourceId: string): void {
    this._selectedSources = this._selectedSources.filter((s) => s.id !== sourceId);
  }

  private _confirm(): void {
    this.dispatchEvent(
      new CustomEvent("sources-confirmed", {
        detail: { sources: [...this._selectedSources] },
        bubbles: true,
        composed: true,
      })
    );
  }

  protected override render(): TemplateResult {
    if (!this._componentsReady) return html``;

    return html`
      ${renderEntityPicker({
        hass: this.hass,
        menuOpen: this._attributeMenuOpen,
        entityPickerOpen: this._entityPickerOpen,
        selectedEntityId: this._selectedEntityId,
        entitySearch: this._entitySearch,
        path: this._path,
        selectedSources: this._selectedSources,
        draggingSourceId: undefined,
        resolved: undefined,
        loading: false,
        attributeSearch: this._attributeSearch,
        getItems: this._getItems,
        getAdditionalItems: this._getAdditionalItems,
        onEntityPickerOpened: () => {
          if (this._entityPickerOpen && !this._attributeMenuOpen) return;

          this._entityPickerOpen = true;
          this._attributeMenuOpen = false;
          this._pushBrowserHistoryLayer("entity-picker");
        },
        onEntityPickerClosed: () => {
          if (this._selectingEntityForAttributeMenu) {
            this._entityPickerOpen = false;
            return;
          }

          this._closeBrowserHistoryLayer("entity-picker", () => {
            this._entityPickerOpen = false;
          });
        },
        onEntitySelected: (entityId) => this._onEntitySelected(entityId),
        onEntitySearchChanged: (value) => {
          this._entitySearch = value;
        },
        onAttributeSearchChanged: (value) => {
          this._attributeSearch = value;
        },
        onSourceAdded: (source) => this._addSource(source),
        onSourceRemoved: (sourceId) => this._removeSource(sourceId),
        onSourceDragStart: () => {},
        onSourceDragOver: () => {},
        onSourceDragEnd: () => {},
        onSourceDrop: () => {},
        onBreadcrumbClick: (path) => {
          this._path = path;
        },
        onCloseMenu: () => this._closeAttributeMenu(),
        hideEmptyPickerState: this._pickerEntities().length === 0,
      })}
    `;
  }
}

if (!customElements.get("abh-series-picker")) {
  customElements.define("abh-series-picker", SeriesPickerElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "abh-series-picker": SeriesPickerElement;
  }
}

import { LitElement, css, html, type PropertyValues, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import { chartStyles } from "../styles/chart.css.js";
import {
  renderEntityPicker,
  preloadEntityPickerComponents,
  entityLabel,
} from "./entity-picker.js";
import type { HistorySource } from "../data/history.js";
import type { HassEntity, HomeAssistant } from "../types/ha.js";

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

  @state() private _selectedSources: HistorySource[] = [];
  @state() private _attributeMenuOpen = false;
  @state() private _entityPickerOpen = false;
  @state() private _selectedEntityId?: string;
  @state() private _path: string[] = [];
  @state() private _attributeSearch = "";
  @state() private _componentsReady = false;
  @state() private _customEntityIds: string[] = [];

  private readonly _handleDocumentPointerDown = (event: Event): void => {
    if (!this._attributeMenuOpen) return;
    if (this._isEventInsideAttributeOverlay(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  private readonly _handleDocumentClick = (event: Event): void => {
    if (!this._attributeMenuOpen) return;
    if (this._isEventInsideAttributeOverlay(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    this._closeAttributeMenu();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("pointerdown", this._handleDocumentPointerDown, true);
    document.addEventListener("click", this._handleDocumentClick, true);
    preloadEntityPickerComponents().then(() => {
      this._componentsReady = true;
    });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("pointerdown", this._handleDocumentPointerDown, true);
    document.removeEventListener("click", this._handleDocumentClick, true);
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has("initialSources") && this.initialSources) {
      this._selectedSources = [...this.initialSources];
    }
    if (changed.has("_attributeMenuOpen") && this._attributeMenuOpen) {
      void this.updateComplete.then(() => this._positionEntityMenu());
    }
  }

  private _isEventInsideAttributeOverlay(event: Event): boolean {
    const path = event.composedPath();
    const menu = this.renderRoot?.querySelector(".entity-menu");
    if (menu && path.includes(menu as EventTarget)) return true;
    for (const target of path) {
      if (!(target instanceof HTMLElement)) continue;
      const tag = target.localName;
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

  private _positionEntityMenu(): void {
    const trigger = this.renderRoot?.querySelector(".entity-trigger") as HTMLElement | null;
    const menu = this.renderRoot?.querySelector(".entity-menu") as HTMLElement | null;
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

  private _pickerEntities(): HassEntity[] {
    if (!this.hass) return [];
    return this._customEntityIds
      .filter((id) => typeof id === "string" && id !== "")
      .filter((id, idx, arr) => arr.indexOf(id) === idx)
      .map((id) => this.hass?.states[id])
      .filter((e): e is HassEntity => e !== undefined);
  }

  private readonly _getItems = (): unknown[] =>
    this._pickerEntities().map((e) => ({
      id: e.entity_id,
      primary: entityLabel(e),
      secondary: e.entity_id,
    }));

  private readonly _getAdditionalItems = (search?: string): unknown[] => {
    if (!this.hass || !search?.trim()) return [];
    const lower = search.toLowerCase();
    const pinnedIds = new Set(this._pickerEntities().map((e) => e.entity_id));
    return Object.values(this.hass.states)
      .filter((e): e is HassEntity => e !== undefined)
      .filter((e) => !pinnedIds.has(e.entity_id))
      .filter(
        (e) =>
          e.entity_id.toLowerCase().includes(lower) ||
          (typeof e.attributes.friendly_name === "string" &&
            e.attributes.friendly_name.toLowerCase().includes(lower))
      )
      .slice(0, 20)
      .map((e) => ({
        id: e.entity_id,
        primary: entityLabel(e),
        secondary: e.entity_id,
      }));
  };

  private _onEntitySelected(entityId: string): void {
    const knownIds = new Set(this._pickerEntities().map((e) => e.entity_id));
    if (!knownIds.has(entityId)) {
      this._customEntityIds = [...this._customEntityIds, entityId];
    }
    this._selectedEntityId = entityId;
    this._path = [];
    this._attributeSearch = "";
    this._entityPickerOpen = false;
    this._attributeMenuOpen = true;
  }

  private _closeAttributeMenu(): void {
    this._attributeMenuOpen = false;
    this._entityPickerOpen = false;
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
        path: this._path,
        selectedSources: this._selectedSources,
        draggingSourceId: undefined,
        resolved: undefined,
        loading: false,
        attributeSearch: this._attributeSearch,
        getItems: this._getItems,
        getAdditionalItems: this._getAdditionalItems,
        onEntityPickerOpened: () => {
          this._entityPickerOpen = true;
          this._attributeMenuOpen = false;
        },
        onEntityPickerClosed: () => {
          this._entityPickerOpen = false;
        },
        onEntitySelected: (entityId) => this._onEntitySelected(entityId),
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

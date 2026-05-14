import { html, nothing, type TemplateResult } from "lit";
import { entityStateSource, attributeSource, valueType, type HistorySource } from "../data/history.js";
import type { HistoryValueType } from "../data/value-type.js";
import type { HassEntity, HomeAssistant } from "../types/ha.js";
import type { ResolvedConfig, ResolvedSeries } from "../types/config.js";
import { ensureHaComponents } from "../load-ha-components.js";
import { localize } from "../localize/localize.js";

const ATTRIBUTE_SEARCH_DEPTH_LIMIT = 8;
const ATTRIBUTE_SEARCH_RESULT_LIMIT = 50;
const ENTITY_SEARCH_RESULT_LIMIT = 20;

export const ENTITY_PICKER_SEARCH_KEYS = [
  { name: "search_labels.entityName", weight: 10 },
  { name: "search_labels.friendlyName", weight: 8 },
  { name: "search_labels.deviceName", weight: 7 },
  { name: "search_labels.areaName", weight: 6 },
  { name: "search_labels.domainName", weight: 6 },
  { name: "search_labels.entityId", weight: 3 },
];

export interface EntityPickerComboBoxItem {
  id: string;
  primary: string;
  secondary?: string;
  sorting_label: string;
  search_labels: Record<string, string | null>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function entityLabel(entity: HassEntity): string {
  return typeof entity.attributes.friendly_name === "string" ? entity.attributes.friendly_name : entity.entity_id;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => stringValue(value) !== undefined);
}

function entityDomain(entityId: string): string {
  return entityId.split(".")[0] ?? entityId;
}

function normalizedSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function entityPickerItem(hass: HomeAssistant, entity: HassEntity): EntityPickerComboBoxItem {
  const friendlyName = entityLabel(entity);
  const entityRegistry = hass.entities?.[entity.entity_id];
  const device = entityRegistry?.device_id ? hass.devices?.[entityRegistry.device_id] : undefined;
  const areaId = entityRegistry?.area_id ?? device?.area_id;
  const area = areaId ? hass.areas?.[areaId] : undefined;
  const entityName = firstString(entityRegistry?.name_by_user, entityRegistry?.name, entityRegistry?.original_name, friendlyName) ?? entity.entity_id;
  const deviceName = firstString(device?.name_by_user, device?.name);
  const areaName = firstString(area?.name);
  const domainName = entityDomain(entity.entity_id);

  return {
    id: entity.entity_id,
    primary: friendlyName,
    secondary: entity.entity_id,
    sorting_label: [friendlyName, entity.entity_id].join("_"),
    search_labels: {
      entityName,
      friendlyName,
      deviceName: deviceName ?? null,
      areaName: areaName ?? null,
      domainName,
      entityId: entity.entity_id,
    },
  };
}

export function entityPickerItems(hass?: HomeAssistant, entities?: HassEntity[]): EntityPickerComboBoxItem[] {
  if (!hass) return [];

  const sourceEntities = entities ?? Object.values(hass.states).filter((entity): entity is HassEntity => entity !== undefined);
  return sourceEntities.map((entity) => entityPickerItem(hass, entity));
}

function wordDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > 2) return 3;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost
      );
    }

    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length] ?? 3;
}

function entitySearchTexts(item: EntityPickerComboBoxItem): string[] {
  return [
    item.primary,
    item.secondary,
    item.id,
    ...Object.values(item.search_labels).filter((value): value is string => typeof value === "string"),
  ].filter((value): value is string => typeof value === "string").map(normalizedSearchText);
}

function entityTermScore(term: string, texts: string[]): number | undefined {
  let score: number | undefined;

  for (const text of texts) {
    if (text === term) {
      score = Math.max(score ?? 0, 120);
      continue;
    }

    const words = text.split(/[\s_.-]+/).filter(Boolean);
    if (words.some((word) => word === term)) {
      score = Math.max(score ?? 0, 110);
      continue;
    }

    if (words.some((word) => word.startsWith(term))) {
      score = Math.max(score ?? 0, 95);
      continue;
    }

    if (text.includes(term)) {
      score = Math.max(score ?? 0, 80);
      continue;
    }

    if (term.length >= 4 && words.some((word) => wordDistance(term, word) <= 1)) {
      score = Math.max(score ?? 0, 65);
    }
  }

  return score;
}

export function filterEntityPickerItems(
  items: EntityPickerComboBoxItem[],
  search: string,
  limit = ENTITY_SEARCH_RESULT_LIMIT
): EntityPickerComboBoxItem[] {
  const terms = normalizedSearchText(search).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  return items
    .map((item) => {
      const texts = entitySearchTexts(item);
      let score = 0;

      for (const term of terms) {
        const termScore = entityTermScore(term, texts);
        if (termScore === undefined) return undefined;
        score += termScore;
      }

      return { item, score };
    })
    .filter((result): result is { item: EntityPickerComboBoxItem; score: number } => result !== undefined)
    .sort((left, right) => right.score - left.score || left.item.primary.localeCompare(right.item.primary))
    .slice(0, limit)
    .map((result) => result.item);
}

let componentsLoaded = false;

export async function preloadEntityPickerComponents(): Promise<void> {
  if (componentsLoaded) return;
  componentsLoaded = true;
  await ensureHaComponents();
}

interface EntityPickerRenderOpts {
  hass?: HomeAssistant;
  menuOpen: boolean;
  entityPickerOpen: boolean;
  selectedEntityId?: string;
  entitySearch?: string;
  path: string[];
  selectedSources: HistorySource[];
  draggingSourceId?: string;
  resolved?: ResolvedConfig;
  loading: boolean;
  attributeSearch: string;
  getItems: () => unknown[];
  getAdditionalItems: (search?: string) => unknown[];
  onEntityPickerOpened(): void;
  onEntityPickerClosed(): void;
  onEntitySelected(entityId: string): void;
  onEntitySearchChanged?(value: string): void;
  onAttributeSearchChanged(value: string): void;
  onSourceAdded(source: HistorySource): void;
  onSourceRemoved(sourceId: string): void;
  onSourceDragStart(sourceId: string, event: DragEvent): void;
  onSourceDragOver(sourceId: string | undefined, event: DragEvent): void;
  onSourceDragEnd(): void;
  onSourceDrop(sourceId: string | undefined, event: DragEvent): void;
  sourceSettingsSourceId?: string;
  sourceSettingsUnit?: string;
  sourceSettingsGroup?: string;
  onSourceSettingsOpen(source: HistorySource, event: Event): void;
  onSourceSettingsClose(): void;
  onSourceSettingsUnitChanged(value: string): void;
  onSourceSettingsGroupChanged(value: string): void;
  onBreadcrumbClick(path: string[]): void;
  onCloseMenu(): void;
  hideEmptyPickerState?: boolean;
}

interface AttributeSearchResult {
  key: string;
  dottedPath: string;
  valueType: HistoryValueType;
  source: HistorySource;
}

export function entityPickerAvailable(): boolean {
  return customElements.get("ha-generic-picker") !== undefined;
}

export function renderEntityPicker(opts: EntityPickerRenderOpts): TemplateResult {
  const entity = opts.selectedEntityId && opts.hass ? opts.hass.states[opts.selectedEntityId] : undefined;
  const rowSources = pickerRowSources(opts);

  return html`
    <div class="entity-picker"
      @picker-opened=${opts.onEntityPickerOpened}
      @picker-closed=${opts.onEntityPickerClosed}
    >
      <div class="entity-menu" ?open=${opts.menuOpen} @click=${(e: Event) => e.stopPropagation()}>
        <div class="entity-menu-top">
          <span class="entity-menu-title">${entity ? entityLabel(entity) : ""}</span>
          <button class="entity-menu-close" @click=${opts.onCloseMenu}>&#x2715;</button>
        </div>
        ${renderBrowser(opts)}
      </div>
      <div
        class="entity-picker-row"
        @dragover=${(e: DragEvent) => opts.onSourceDragOver(undefined, e)}
        @drop=${(e: DragEvent) => opts.onSourceDrop(undefined, e)}
      >
        ${opts.hideEmptyPickerState ? renderEmptyStateEntityTrigger(opts) : renderGenericEntityTrigger(opts)}
        ${rowSources.map((source) => renderChip(source, opts))}
      </div>
      ${opts.hideEmptyPickerState ? renderEmptyStateEntityMenu(opts) : nothing}
      ${opts.loading
        ? html`
            <div class="history-loading-indicator" role="status" aria-label=${localize(opts.hass, "loading")}>
              <span class="history-loading-spinner"></span>
              <span class="history-loading-text">${localize(opts.hass, "loading")}</span>
            </div>
          `
        : nothing}
      ${renderSourceSettingsPopup(opts)}
    </div>
  `;
}

function renderGenericEntityTrigger(opts: EntityPickerRenderOpts): TemplateResult {
  return html`
    <ha-generic-picker
      class="entity-trigger"
      .hass=${opts.hass}
      .addButtonLabel=${localize(opts.hass, "add_target")}
      .value=${""}
      .getItems=${opts.getItems}
      .emptyLabel=${""}
      .searchLabel=${localize(opts.hass, "search_entity")}
      .searchKeys=${ENTITY_PICKER_SEARCH_KEYS}
      @value-changed=${(e: CustomEvent) => {
        const entityId = (e.detail as { value: string }).value;
        if (entityId) opts.onEntitySelected(entityId);
      }}
    ></ha-generic-picker>
  `;
}

function renderEmptyStateEntityTrigger(opts: EntityPickerRenderOpts): TemplateResult {
  const label = localize(opts.hass, "add_target");

  return html`
    <ha-button
      class="entity-trigger entity-add-trigger"
      size="small"
      appearance="filled"
      @click=${opts.onEntityPickerOpened}
    >
      <ha-icon icon="mdi:playlist-plus" slot="start"></ha-icon>
      ${label}
    </ha-button>
  `;
}

function renderEmptyStateEntityMenu(opts: EntityPickerRenderOpts): TemplateResult {
  const searchLabel = localize(opts.hass, "search_entity");
  const search = opts.entitySearch ?? "";
  const items = search.trim()
    ? opts.getAdditionalItems(search).filter(isPickerItem)
    : [];

  return html`
    <div class="entity-select-menu" ?open=${opts.entityPickerOpen} @click=${(event: Event) => event.stopPropagation()}>
      <input
        class="entity-browser-search-input"
        type="search"
        .value=${search}
        placeholder=${searchLabel}
        aria-label=${searchLabel}
        @input=${(event: InputEvent) => opts.onEntitySearchChanged?.((event.target as HTMLInputElement).value)}
        @click=${(event: Event) => event.stopPropagation()}
        @keydown=${(event: Event) => event.stopPropagation()}
      />
      ${items.length > 0 ? html`
        <div class="entity-select-results">
          ${items.map((item) => html`
            <button
              class="entity-select-result"
              @click=${() => {
                opts.onEntitySearchChanged?.("");
                opts.onEntitySelected(item.id);
              }}
            >
              <span class="entity-browser-entry-label">${item.primary}</span>
              ${item.secondary ? html`<span class="entity-browser-entry-secondary">${item.secondary}</span>` : nothing}
            </button>
          `)}
        </div>
      ` : nothing}
    </div>
  `;
}

function isPickerItem(item: unknown): item is { id: string; primary: string; secondary?: string } {
  return isRecord(item) && typeof item.id === "string" && typeof item.primary === "string";
}

function entityDomainIcon(entity: HassEntity): string {
  const icon = entity.attributes.icon;
  if (typeof icon === "string" && icon) return icon;

  const domain = entity.entity_id.split(".")[0];
  const icons: Record<string, string> = {
    climate: "mdi:thermostat",
    sensor: "mdi:eye",
    binary_sensor: "mdi:radiobox-marked",
    light: "mdi:lightbulb",
    switch: "mdi:toggle-switch",
    input_boolean: "mdi:toggle-switch",
    fan: "mdi:fan",
    cover: "mdi:window-shutter",
    lock: "mdi:lock",
    media_player: "mdi:cast",
    vacuum: "mdi:robot-vacuum",
    camera: "mdi:camera",
    weather: "mdi:weather-partly-cloudy",
    device_tracker: "mdi:map-marker",
    person: "mdi:account",
    sun: "mdi:white-balance-sunny",
    alarm_control_panel: "mdi:shield",
    automation: "mdi:robot",
    script: "mdi:script-text",
    scene: "mdi:palette",
    timer: "mdi:timer",
  };
  return icons[domain] ?? "mdi:bookmark";
}

function renderChip(source: HistorySource, opts: EntityPickerRenderOpts): TemplateResult {
  const isFixed = isFixedResolvedSource(source.id, opts);
  const isSelected = isSelectedSource(source.id, opts);
  const isEntity = source.kind === "entity_state";
  const entity = opts.hass?.states[source.entityId];
  const chipClass = isEntity ? "entity-source-chip" : "attr-source-chip";
  const isDragging = opts.draggingSourceId === source.id;
  const canEditSettings = (source.kind === "entity_attribute" || source.kind === "entity_state") && isSelected && !isFixed;
  let longPressTimer: ReturnType<typeof setTimeout> | undefined;
  let longPressStart: { x: number; y: number } | undefined;
  const cancelLongPress = (): void => {
    if (longPressTimer !== undefined) {
      clearTimeout(longPressTimer);
      longPressTimer = undefined;
    }
    longPressStart = undefined;
  };
  const openSettings = (event: Event): void => {
    if (!canEditSettings) return;
    event.preventDefault();
    event.stopPropagation();
    opts.onSourceSettingsOpen(source, event);
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (!canEditSettings || event.button !== 0) return;
    longPressStart = { x: event.clientX, y: event.clientY };
    longPressTimer = setTimeout(() => {
      longPressTimer = undefined;
      openSettings(event);
    }, 560);
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (!longPressStart) return;
    if (Math.abs(event.clientX - longPressStart.x) > 8 || Math.abs(event.clientY - longPressStart.y) > 8) {
      cancelLongPress();
    }
  };

  return html`
    <div
      class="source-chip ${chipClass}"
      data-source-id=${source.id}
      draggable=${isSelected && !isFixed}
      ?dragging=${isDragging}
      @contextmenu=${openSettings}
      @pointerdown=${onPointerDown}
      @pointermove=${onPointerMove}
      @pointerup=${cancelLongPress}
      @pointercancel=${cancelLongPress}
      @pointerleave=${cancelLongPress}
      @dragstart=${(e: DragEvent) => { cancelLongPress(); if (isSelected && !isFixed) opts.onSourceDragStart(source.id, e); }}
      @dragend=${() => { cancelLongPress(); opts.onSourceDragEnd(); }}
      @dragover=${(e: DragEvent) => { if (isSelected && !isFixed) opts.onSourceDragOver(source.id, e); }}
      @drop=${(e: DragEvent) => opts.onSourceDrop(source.id, e)}
    >
      <span class="source-chip-icon">
        ${isEntity && entity
          ? html`<ha-icon .icon=${entityDomainIcon(entity)}></ha-icon>`
          : html`<ha-icon .icon=${attrValueTypeIcon(source.valueType)}></ha-icon>`}
      </span>
      <span class="source-chip-label">${source.label}</span>
      ${!isFixed
        ? html`<button
            class="source-chip-remove"
            @click=${(e: Event) => { e.preventDefault(); opts.onSourceRemoved(source.id); }}
          >&#x2715;</button>`
        : nothing}
    </div>
  `;
}

function renderSourceSettingsPopup(opts: EntityPickerRenderOpts): TemplateResult | typeof nothing {
  const sourceId = opts.sourceSettingsSourceId;
  if (!sourceId) return nothing;

  return html`
    <div
      class="source-settings-popover"
      data-source-settings-popover
      @click=${(event: Event) => event.stopPropagation()}
      @pointerdown=${(event: Event) => event.stopPropagation()}
      @keydown=${(event: KeyboardEvent) => {
        event.stopPropagation();
        if (event.key === "Escape") opts.onSourceSettingsClose();
      }}
    >
      <label class="source-settings-field">
        <span>${localize(opts.hass, "attribute_unit")}</span>
        <input
          class="source-settings-input"
          .value=${opts.sourceSettingsUnit ?? ""}
          placeholder=${localize(opts.hass, "attribute_unit_placeholder")}
          @input=${(event: InputEvent) => opts.onSourceSettingsUnitChanged((event.target as HTMLInputElement).value)}
        />
      </label>
      <label class="source-settings-field">
        <span>${localize(opts.hass, "group")}</span>
        <input
          class="source-settings-input"
          .value=${opts.sourceSettingsGroup ?? ""}
          placeholder=${localize(opts.hass, "group_placeholder")}
          @input=${(event: InputEvent) => opts.onSourceSettingsGroupChanged((event.target as HTMLInputElement).value)}
        />
      </label>
      <button class="source-settings-close" @click=${opts.onSourceSettingsClose}>
        ${localize(opts.hass, "done")}
      </button>
    </div>
  `;
}

function attrValueTypeIcon(valueType: string): string {
  switch (valueType) {
    case "number": return "mdi:chart-line";
    case "string": return "mdi:text";
    case "boolean": return "mdi:toggle-switch";
    default: return "mdi:code-tags";
  }
}

function renderBrowser(opts: EntityPickerRenderOpts): TemplateResult {
  const entity = opts.selectedEntityId && opts.hass ? opts.hass.states[opts.selectedEntityId] : undefined;
  const path = opts.path;
  const current = entity ? ((): unknown => {
    if (path.length === 0) return entity.attributes;
    let val: unknown = entity.attributes;
    for (const key of path) {
      if (!isRecord(val)) return undefined;
      val = val[key];
    }
    return val;
  })() : undefined;

  return html`
    <div class="entity-browser">
      ${renderBrowserBreadcrumb(entity, opts)}
      <div class="entity-browser-list">
        ${entity ? renderBrowserEntries(entity, path, isRecord(current) ? current : {}, opts) : html`<div class="entity-browser-empty">${localize(opts.hass, "no_entity_selected")}</div>`}
      </div>
    </div>
  `;
}

function renderBrowserBreadcrumb(
  entity: HassEntity | undefined,
  opts: EntityPickerRenderOpts
): TemplateResult {
  if (!entity || opts.path.length === 0) return html``;

  return html`
    <div class="entity-breadcrumb">
      ${opts.path.map(
        (part, index) => html`
          ${index > 0 ? html`<span class="entity-breadcrumb-sep">/</span>` : nothing}
          <button class="entity-crumb" @click=${() => opts.onBreadcrumbClick(opts.path.slice(0, index + 1))}>${part}</button>
        `
      )}
    </div>
  `;
}

function renderBrowserEntries(
  entity: HassEntity,
  path: string[],
  current: Record<string, unknown>,
  opts: EntityPickerRenderOpts
): TemplateResult {
  const entries = Object.entries(current).sort(([left], [right]) => left.localeCompare(right));
  const hasVisibleAttributes = entries.some(([key, value]) => {
    if (isRecord(value)) return true;
    const type = valueType(value);
    return type !== undefined && Boolean(attributeSource(entity, [...path, key]));
  });

  return html`
    <div class="entity-browser-entries">
      ${path.length > 0
        ? html`
            <div class="entity-browser-back" @click=${() => opts.onBreadcrumbClick(path.slice(0, -1))}>
              &#x2190; ${localize(opts.hass, "back")}
            </div>
          `
        : html`
            ${renderEntityHeader(entity, opts)}
            ${hasVisibleAttributes
              ? html`
                  <div class="entity-browser-section-title">${localize(opts.hass, "attributes")}</div>
                  ${renderAttributeSearchInput(opts)}
                `
              : nothing}
          `}
      ${path.length === 0 && opts.attributeSearch.trim()
        ? renderAttributeSearchResults(entity, opts)
        : entries.map(([key, value]) => renderTreeEntry(entity, key, value, path, opts))}
    </div>
  `;
}

function renderAttributeSearchInput(opts: EntityPickerRenderOpts): TemplateResult {
  const label = localize(opts.hass, "search_attributes");

  return html`
    <div class="entity-browser-search">
      <input
        class="entity-browser-search-input"
        type="search"
        .value=${opts.attributeSearch}
        placeholder=${label}
        aria-label=${label}
        @input=${(event: InputEvent) => opts.onAttributeSearchChanged((event.target as HTMLInputElement).value)}
        @click=${(event: Event) => event.stopPropagation()}
        @keydown=${(event: Event) => event.stopPropagation()}
      />
    </div>
  `;
}

function isSelectedSource(id: string, opts: EntityPickerRenderOpts): boolean {
  return opts.selectedSources.some((s) => s.id === id);
}

function isResolvedSource(id: string, opts: EntityPickerRenderOpts): boolean {
  return (opts.resolved?.series ?? []).some((s) => s.id === id);
}

function isFixedResolvedSource(id: string, opts: EntityPickerRenderOpts): boolean {
  return (opts.resolved?.series ?? []).some((s) => s.id === id && s.forced !== false);
}

function resolvedSeriesToPickerSource(series: ResolvedSeries): HistorySource {
  return {
    id: series.id,
    kind: series.attribute ? "entity_attribute" : "entity_state",
    entityId: series.entity,
    label: series.label,
    path: series.attribute,
    valueType: series.valueType,
    unit: series.unit
  };
}

function pickerRowSources(opts: EntityPickerRenderOpts): HistorySource[] {
  const sources = [
    ...(opts.resolved?.series ?? [])
      .filter((series) => series.forced === false)
      .map(resolvedSeriesToPickerSource),
    ...opts.selectedSources
  ];
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.id)) return false;
    seen.add(source.id);
    return true;
  });
}

function isEntityAlreadyPresent(entityId: string, opts: EntityPickerRenderOpts): boolean {
  const inSelected = opts.selectedSources.some((s) => s.entityId === entityId);
  const inResolved = (opts.resolved?.series ?? []).some((s) => s.entity === entityId);
  return inSelected || inResolved;
}

function hasConflictingClimate(entity: HassEntity, opts: EntityPickerRenderOpts): boolean {
  if (!entity.entity_id.startsWith("climate.")) return false;
  const inSelected = opts.selectedSources.some(
    (s) => s.entityId.startsWith("climate.") && s.entityId !== entity.entity_id
  );
  const inResolved = (opts.resolved?.series ?? []).some(
    (s) => s.entity.startsWith("climate.") && s.entity !== entity.entity_id
  );
  return inSelected || inResolved;
}

function renderEntityHeader(entity: HassEntity, opts: EntityPickerRenderOpts): TemplateResult | typeof nothing {
  const source = entityStateSource(entity);
  if (!source) return nothing;

  if (hasConflictingClimate(entity, opts)) {
    return html`
      <div class="entity-browser-entity entity-browser-entity--disabled">
        <span class="entity-browser-entry-label">${entity.entity_id}</span>
      </div>
    `;
  }

  if (isSelectedSource(source.id, opts)) {
    return html`
      <div class="entity-browser-entity entity-browser-entity--present entity-browser-entity--removable" @click=${() => opts.onSourceRemoved(source.id)}>
        <span class="entity-browser-entry-label">${entity.entity_id}</span>
      </div>
    `;
  }

  if (isResolvedSource(source.id, opts)) {
    if (!isFixedResolvedSource(source.id, opts)) {
      return html`
        <div class="entity-browser-entity entity-browser-entity--present entity-browser-entity--removable" @click=${() => opts.onSourceRemoved(source.id)}>
          <span class="entity-browser-entry-label">${entity.entity_id}</span>
        </div>
      `;
    }

    return html`
      <div class="entity-browser-entity entity-browser-entity--present entity-browser-entity--forced">
        <span class="entity-browser-entry-label">${entity.entity_id}</span>
      </div>
    `;
  }

  if (isEntityAlreadyPresent(entity.entity_id, opts)) {
    return html`
      <div class="entity-browser-entity entity-browser-entity--disabled">
        <span class="entity-browser-entry-label">${entity.entity_id}</span>
      </div>
    `;
  }

  return html`
    <div class="entity-browser-entity" @click=${() => opts.onSourceAdded(source)}>
      <span class="entity-browser-entry-label">${entity.entity_id}</span>
    </div>
  `;
}

function renderTreeEntry(
  entity: HassEntity,
  key: string,
  value: unknown,
  path: string[],
  opts: EntityPickerRenderOpts
): TemplateResult | typeof nothing {
  if (isRecord(value)) {
    return html`
      <div class="entity-browser-entry" @click=${() => opts.onBreadcrumbClick([...path, key])}>
        <span class="entity-browser-entry-label">${key}</span>
        <span class="entity-browser-entry-arrow">&#x203A;</span>
      </div>
    `;
  }

  const type = valueType(value);
  const fullPath = [...path, key];
  if (!type) return nothing;

  const source = attributeSource(entity, fullPath);
  if (!source) return nothing;
  return renderAttributeEntry({ label: key, source, type, opts });
}

function renderAttributeEntry(params: {
  label: string;
  source: HistorySource;
  type: HistoryValueType;
  opts: EntityPickerRenderOpts;
  secondary?: string;
}): TemplateResult {
  const { label, source, type, opts, secondary } = params;
  const content = html`
    <span class="entity-browser-entry-text">
      <span class="entity-browser-entry-label">${label}</span>
      ${secondary ? html`<span class="entity-browser-entry-secondary">${secondary}</span>` : nothing}
    </span>
    <span class="entity-browser-entry-type">${type}</span>
  `;

  if (isSelectedSource(source.id, opts)) {
    return html`
      <div class="entity-browser-entry entity-browser-entry--present entity-browser-entry--removable" @click=${() => opts.onSourceRemoved(source.id)}>
        ${content}
      </div>
    `;
  }

  if (isResolvedSource(source.id, opts)) {
    if (!isFixedResolvedSource(source.id, opts)) {
      return html`
        <div class="entity-browser-entry entity-browser-entry--present entity-browser-entry--removable" @click=${() => opts.onSourceRemoved(source.id)}>
          ${content}
        </div>
      `;
    }

    return html`
      <div class="entity-browser-entry entity-browser-entry--present entity-browser-entry--forced">
        ${content}
      </div>
    `;
  }

  return html`
    <div class="entity-browser-entry" @click=${() => opts.onSourceAdded(source)}>
      ${content}
    </div>
  `;
}

function renderAttributeSearchResults(entity: HassEntity, opts: EntityPickerRenderOpts): TemplateResult {
  const matches = flattenAttributeMatches(entity, entity.attributes, opts.attributeSearch);
  const visibleMatches = matches.slice(0, ATTRIBUTE_SEARCH_RESULT_LIMIT);

  if (visibleMatches.length === 0) {
    return html`<div class="entity-browser-search-empty">${localize(opts.hass, "no_matching_attributes")}</div>`;
  }

  return html`
    <div class="entity-browser-search-results">
      ${visibleMatches.map((result) =>
        renderAttributeEntry({
          label: result.key,
          source: result.source,
          type: result.valueType,
          opts,
          secondary: result.dottedPath
        })
      )}
      ${matches.length > visibleMatches.length
        ? html`<div class="entity-browser-search-count">${localize(opts.hass, "attribute_results_limited")}</div>`
        : nothing}
    </div>
  `;
}

function flattenAttributeMatches(
  entity: HassEntity,
  root: Record<string, unknown>,
  query: string
): AttributeSearchResult[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [];

  const results: AttributeSearchResult[] = [];

  const visit = (current: Record<string, unknown>, path: string[], depth: number): void => {
    if (depth > ATTRIBUTE_SEARCH_DEPTH_LIMIT) return;

    for (const [key, value] of Object.entries(current)) {
      const fullPath = [...path, key];

      if (isRecord(value)) {
        visit(value, fullPath, depth + 1);
        continue;
      }

      const type = valueType(value);
      const source = type ? attributeSource(entity, fullPath) : undefined;
      if (!type || !source) continue;

      const searchable = attributeSearchText(fullPath, value);
      if (!searchable.includes(normalizedQuery)) continue;

      results.push({
        key,
        dottedPath: fullPath.join("."),
        valueType: type,
        source
      });
    }
  };

  visit(root, [], 0);

  return results.sort((left, right) => {
    const leftRank = attributeSearchRank(left, normalizedQuery);
    const rightRank = attributeSearchRank(right, normalizedQuery);
    if (leftRank !== rightRank) return leftRank - rightRank;
    if (left.dottedPath.length !== right.dottedPath.length) return left.dottedPath.length - right.dottedPath.length;
    return left.dottedPath.localeCompare(right.dottedPath);
  });
}

function attributeSearchText(path: string[], value: unknown): string {
  const valueText = typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
  return [...path, path.join("."), valueText].join(" ").toLocaleLowerCase();
}

function attributeSearchRank(result: AttributeSearchResult, query: string): number {
  const key = result.key.toLocaleLowerCase();
  const dottedPath = result.dottedPath.toLocaleLowerCase();
  if (key.startsWith(query)) return 0;
  if (dottedPath.startsWith(query)) return 1;
  if (key.includes(query)) return 2;
  if (dottedPath.includes(query)) return 3;
  return 4;
}

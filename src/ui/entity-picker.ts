import { html, nothing, type TemplateResult } from "lit";
import { entityStateSource, attributeSource, valueType, type HistorySource } from "../data/history.js";
import type { HistoryValueType } from "../data/value-type.js";
import type { HassEntity, HomeAssistant } from "../types/ha.js";
import type { ResolvedConfig } from "../types/config.js";
import { ensureHaComponents } from "../load-ha-components.js";
import { localize } from "../localize/localize.js";

const ATTRIBUTE_SEARCH_DEPTH_LIMIT = 8;
const ATTRIBUTE_SEARCH_RESULT_LIMIT = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function entityLabel(entity: HassEntity): string {
  return typeof entity.attributes.friendly_name === "string" ? entity.attributes.friendly_name : entity.entity_id;
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
  onAttributeSearchChanged(value: string): void;
  onSourceAdded(source: HistorySource): void;
  onSourceRemoved(sourceId: string): void;
  onSourceDragStart(sourceId: string, event: DragEvent): void;
  onSourceDragOver(sourceId: string | undefined, event: DragEvent): void;
  onSourceDragEnd(): void;
  onSourceDrop(sourceId: string | undefined, event: DragEvent): void;
  onBreadcrumbClick(path: string[]): void;
  onCloseMenu(): void;
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
      <ha-generic-picker
        class="entity-trigger"
        .hass=${opts.hass}
        .addButtonLabel=${localize(opts.hass, "add_target")}
        .value=${""}
        .getItems=${opts.getItems}
        .getAdditionalItems=${opts.getAdditionalItems}
        @value-changed=${(e: CustomEvent) => {
          const entityId = (e.detail as { value: string }).value;
          if (entityId) opts.onEntitySelected(entityId);
        }}
      ></ha-generic-picker>
      ${opts.loading
        ? html`
            <div class="history-loading-indicator" role="status" aria-label=${localize(opts.hass, "loading")}>
              <span class="history-loading-spinner"></span>
              <span class="history-loading-text">${localize(opts.hass, "loading")}</span>
            </div>
          `
        : nothing}
      ${opts.selectedSources.length > 0 ? html`
        <div
          class="entity-row"
          @dragover=${(e: DragEvent) => opts.onSourceDragOver(undefined, e)}
          @drop=${(e: DragEvent) => opts.onSourceDrop(undefined, e)}
        >
          ${opts.selectedSources.map((source) => renderChip(source, opts))}
        </div>
      ` : nothing}
    </div>
  `;
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
  const isDefault = opts.resolved?.series.some((s) => s.id === source.id) ?? false;
  const isEntity = source.kind === "entity_state";
  const entity = opts.hass?.states[source.entityId];
  const chipClass = isEntity ? "entity-source-chip" : "attr-source-chip";
  const isDragging = opts.draggingSourceId === source.id;

  return html`
    <div
      class="source-chip ${chipClass}"
      draggable=${!isDefault}
      ?dragging=${isDragging}
      @dragstart=${(e: DragEvent) => opts.onSourceDragStart(source.id, e)}
      @dragend=${() => opts.onSourceDragEnd()}
      @dragover=${(e: DragEvent) => { if (!isDefault) opts.onSourceDragOver(source.id, e); }}
      @drop=${(e: DragEvent) => opts.onSourceDrop(source.id, e)}
    >
      <span class="source-chip-icon">
        ${isEntity && entity
          ? html`<ha-icon .icon=${entityDomainIcon(entity)}></ha-icon>`
          : html`<ha-icon .icon=${attrValueTypeIcon(source.valueType)}></ha-icon>`}
      </span>
      <span class="source-chip-label">${source.label}</span>
      ${!isDefault
        ? html`<button
            class="source-chip-remove"
            @click=${(e: Event) => { e.preventDefault(); opts.onSourceRemoved(source.id); }}
          >&#x2715;</button>`
        : nothing}
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

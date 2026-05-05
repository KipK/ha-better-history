import { html, nothing, type TemplateResult } from "lit";
import { entityStateSource, attributeSource, valueType, type HistorySource } from "../data/history.js";
import type { HassEntity, HomeAssistant } from "../types/ha.js";
import type { ResolvedConfig } from "../types/config.js";
import { ensureHaComponents } from "../load-ha-components.js";

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
  resolved?: ResolvedConfig;
  getItems: () => unknown[];
  getAdditionalItems: (search?: string) => unknown[];
  onEntityPickerOpened(): void;
  onEntityPickerClosed(): void;
  onEntitySelected(entityId: string): void;
  onSourceAdded(source: HistorySource): void;
  onSourceRemoved(sourceId: string): void;
  onBreadcrumbClick(path: string[]): void;
  onCloseMenu(): void;
}

export function entityPickerAvailable(): boolean {
  return customElements.get("ha-generic-picker") !== undefined;
}

export function renderEntityPicker(opts: EntityPickerRenderOpts): TemplateResult {
  return html`
    <div class="entity-picker"
      @picker-opened=${opts.onEntityPickerOpened}
      @picker-closed=${opts.onEntityPickerClosed}
    >
      <ha-generic-picker
        class="entity-trigger"
        .hass=${opts.hass}
        .addButtonLabel=${"Ajouter une cible"}
        .value=${""}
        .getItems=${opts.getItems}
        .getAdditionalItems=${opts.getAdditionalItems}
        @value-changed=${(e: CustomEvent) => {
          const entityId = (e.detail as { value: string }).value;
          if (entityId) opts.onEntitySelected(entityId);
        }}
      ></ha-generic-picker>
      <div class="entity-menu" ?open=${opts.menuOpen}>
        <div class="entity-menu-top">
          <button class="entity-menu-close" @click=${opts.onCloseMenu}>&#x2715;</button>
        </div>
        ${renderBrowser(opts)}
      </div>
    </div>
    ${renderSelectedSources(opts)}
  `;
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
        ${entity ? renderBrowserEntries(entity, path, isRecord(current) ? current : {}, opts) : html`<div class="entity-browser-empty">No entity selected</div>`}
      </div>
    </div>
  `;
}

function renderBrowserBreadcrumb(
  entity: HassEntity | undefined,
  opts: EntityPickerRenderOpts
): TemplateResult {
  if (!entity) return html``;

  return html`
    <div class="entity-browser-title">${entityLabel(entity)}</div>
    <div class="entity-breadcrumb">
      <button class="entity-crumb" @click=${() => opts.onBreadcrumbClick([])}>${entity.entity_id}</button>
      ${opts.path.map(
        (part, index) => html`
          <span class="entity-breadcrumb-sep">/</span>
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

  return html`
    <div class="entity-browser-entries">
      ${path.length > 0
        ? html`
            <div class="entity-browser-back" @click=${() => opts.onBreadcrumbClick(path.slice(0, -1))}>
              &#x2190; Back
            </div>
          `
        : renderStateEntry(entity, opts)}
      ${entries.map(([key, value]) => renderTreeEntry(entity, key, value, path, opts))}
    </div>
  `;
}

function renderStateEntry(entity: HassEntity, opts: EntityPickerRenderOpts): TemplateResult | typeof nothing {
  const source = entityStateSource(entity);

  if (!source) return nothing;

  return html`
    <div class="entity-browser-entry" @click=${() => opts.onSourceAdded(source)}>
      <span class="entity-browser-entry-label">state</span>
      <span class="entity-browser-entry-type">${source.valueType}</span>
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
  const source = type ? attributeSource(entity, fullPath) : undefined;

  if (!source) return nothing;

  return html`
    <div class="entity-browser-entry" @click=${() => opts.onSourceAdded(source)}>
      <span class="entity-browser-entry-label">${key}</span>
      <span class="entity-browser-entry-type">${type}</span>
    </div>
  `;
}

function renderSelectedSources(opts: EntityPickerRenderOpts): TemplateResult {
  return html`
    <div class="entity-selected-row">
      ${opts.selectedSources.map((source) => {
        const isDefault = opts.resolved?.series.some((s) => s.id === source.id) ?? false;

        if (isDefault) {
          return html`<span class="entity-default-chip">${source.label}</span>`;
        }

        return html`
          <ha-input-chip
            .label=${source.label}
            @remove=${(e: Event) => { e.preventDefault(); opts.onSourceRemoved(source.id); }}
          ></ha-input-chip>
        `;
      })}
    </div>
  `;
}

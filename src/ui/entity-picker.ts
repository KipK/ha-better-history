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
      <div class="entity-row">
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
      </div>
    </div>
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
              &#x2190; Back
            </div>
          `
        : html`
            ${renderEntityHeader(entity, opts)}
            ${hasVisibleAttributes ? html`<div class="entity-browser-section-title">Attributs</div>` : nothing}
          `}
      ${entries.map(([key, value]) => renderTreeEntry(entity, key, value, path, opts))}
    </div>
  `;
}

function isAlreadyPresent(id: string, opts: EntityPickerRenderOpts): boolean {
  const inSelected = opts.selectedSources.some((s) => s.id === id);
  const inResolved = (opts.resolved?.series ?? []).some((s) => s.id === id);
  return inSelected || inResolved;
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

  if (isAlreadyPresent(source.id, opts) || isEntityAlreadyPresent(entity.entity_id, opts)) {
    return html`
      <div class="entity-browser-entity entity-browser-entity--present">
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
  const source = type ? attributeSource(entity, fullPath) : undefined;

  if (!source) return nothing;

  if (isAlreadyPresent(source.id, opts)) {
    return html`
      <div class="entity-browser-entry entity-browser-entry--disabled">
        <span class="entity-browser-entry-label">${key}</span>
        <span class="entity-browser-entry-type">${type}</span>
      </div>
    `;
  }

  return html`
    <div class="entity-browser-entry" @click=${() => opts.onSourceAdded(source)}>
      <span class="entity-browser-entry-label">${key}</span>
      <span class="entity-browser-entry-type">${type}</span>
    </div>
  `;
}


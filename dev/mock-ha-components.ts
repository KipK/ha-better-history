/**
 * Mock Home Assistant custom elements for standalone dev.
 * Registers minimal stubs so ha-better-history pickers render in dev mode.
 */

const mockStyles = new CSSStyleSheet();
mockStyles.replaceSync(`
  :host { display: inline-block; }
  input, select { font: inherit; font-size: 12px; padding: 4px 8px; border: 1px solid #555; border-radius: 6px; background: #2a2a3e; color: #e0e0e0; }
`);

class MockDateRangePicker extends HTMLElement {
  static observedAttributes = ["start-date", "end-date"];
  private _start?: HTMLInputElement;
  private _end?: HTMLInputElement;

  get startDate(): Date | undefined {
    return this._start?.valueAsDate ?? undefined;
  }
  set startDate(d: Date | undefined) {
    if (d && this._start) this._start.valueAsDate = d;
  }

  get endDate(): Date | undefined {
    return this._end?.valueAsDate ?? undefined;
  }
  set endDate(d: Date | undefined) {
    if (d && this._end) this._end.valueAsDate = d;
  }

  connectedCallback() {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot!.adoptedStyleSheets = [mockStyles];
      this.shadowRoot!.innerHTML = `
        <input type="datetime-local" id="start" />
        <span style="margin:0 4px;color:#888;">–</span>
        <input type="datetime-local" id="end" />
      `;
    }
    this._start = this.shadowRoot!.getElementById("start") as HTMLInputElement;
    this._end   = this.shadowRoot!.getElementById("end") as HTMLInputElement;

    const emit = () => {
      this.dispatchEvent(new CustomEvent("value-changed", {
        detail: { value: { startDate: this._start?.valueAsDate, endDate: this._end?.valueAsDate } },
        bubbles: true, composed: true,
      }));
    };
    this._start!.addEventListener("change", emit);
    this._end!.addEventListener("change", emit);
  }

  attributeChangedCallback(name: string, _old: string, value: string) {
    if (name === "start-date" && this._start) {
      this._start.value = value.slice(0, 16);
    }
    if (name === "end-date" && this._end) {
      this._end.value = value.slice(0, 16);
    }
  }
}

class MockEntityPicker extends HTMLElement {
  private _select?: HTMLSelectElement;
  private _hass?: { states: Record<string, { entity_id: string; attributes: Record<string, unknown> }> };

  get hass() { return this._hass; }
  set hass(h: unknown) {
    this._hass = h as typeof this._hass;
    this._rebuild();
  }

  connectedCallback() {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot!.adoptedStyleSheets = [mockStyles];
      this.shadowRoot!.innerHTML = `<select id="pick"><option value="">Select entity…</option></select>`;
    }
    this._select = this.shadowRoot!.getElementById("pick") as HTMLSelectElement;
    this._select!.addEventListener("change", () => {
      this.dispatchEvent(new CustomEvent("value-changed", {
        detail: { value: this._select?.value ?? "" },
        bubbles: true, composed: true,
      }));
    });
    this._rebuild();
  }

  private _rebuild(): void {
    const sel = this._select;
    if (!sel || !this._hass) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">Select entity…</option>';
    for (const [id, e] of Object.entries(this._hass.states)) {
      if (!e) continue;
      const label = (e.attributes.friendly_name as string) ?? id;
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = `${label} (${id})`;
      sel.appendChild(opt);
    }
    sel.value = current;
  }

  dispatchFocusIn() {
    this.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
  }
  dispatchFocusOut() {
    this.dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true }));
  }
}

class MockIcon extends HTMLElement {
  connectedCallback() {
    this.style.display = "inline-block";
    this.style.width = "18px";
    this.textContent = this.getAttribute("icon")?.replace("mdi:", "") ?? "";
  }
}

class MockIconButton extends HTMLElement {
  connectedCallback() {
    this.style.display = "inline-flex";
    this.style.cursor = "pointer";
  }
}

class MockMdList extends HTMLElement { connectedCallback() { this.style.display = "block"; } }
class MockMdListItem extends HTMLElement {
  connectedCallback() {
    this.style.display = "flex";
    this.style.cursor = "pointer";
  }
}
class MockInputChip extends HTMLElement {
  connectedCallback() {
    this.style.display = "inline-flex";
  }
}

export function registerMockComponents() {
  const defs: [string, CustomElementConstructor][] = [
    ["ha-date-range-picker", MockDateRangePicker],
    ["ha-entity-picker", MockEntityPicker],
    ["ha-icon", MockIcon],
    ["ha-icon-button", MockIconButton],
    ["ha-md-list", MockMdList],
    ["ha-md-list-item", MockMdListItem],
    ["ha-input-chip", MockInputChip],
  ];

  for (const [tag, ctor] of defs) {
    if (!customElements.get(tag)) {
      customElements.define(tag, ctor);
    }
  }

  console.log("[dev] Mock HA components registered:", defs.map(d => d[0]).join(", "));
}

registerMockComponents();

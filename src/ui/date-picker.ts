import { html, type TemplateResult } from "lit";
import { ensureDateRangePicker } from "../load-ha-components.js";
import type { HomeAssistant } from "../types/ha.js";

export function datePickerAvailable(): boolean {
  return customElements.get("ha-date-range-picker") !== undefined;
}

export async function preloadDatePicker(): Promise<void> {
  await ensureDateRangePicker();
}

interface DatePickerRenderOptions {
  hass: HomeAssistant | undefined;
  startDate: Date;
  endDate: Date;
  onChange: (startDate: Date, endDate: Date) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

export function renderDatePicker(
  opts: DatePickerRenderOptions
): TemplateResult {
  return html`
    <div
      class="date-picker-wrapper"
      @focusin=${() => opts.onOpen?.()}
      @pointerdown=${() => opts.onOpen?.()}
      @keydown=${(event: KeyboardEvent) => {
        if (event.key === "Escape") {
          opts.onClose?.();
        }
      }}
    >
      <ha-date-range-picker
        .hass=${opts.hass}
        .startDate=${opts.startDate}
        .endDate=${opts.endDate}
        time-picker
        extended-presets
        @value-changed=${(event: CustomEvent) => {
          const detail = event.detail as {
            value?: { startDate?: unknown; endDate?: unknown };
            startDate?: unknown;
            endDate?: unknown;
          };
          const start = detail.value?.startDate ?? detail.startDate;
          const end = detail.value?.endDate ?? detail.endDate;
          if (start instanceof Date && end instanceof Date) {
            opts.onChange(start, end);
            opts.onClose?.();
          }
        }}
      ></ha-date-range-picker>
    </div>
  `;
}

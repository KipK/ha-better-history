import { html, type TemplateResult } from "lit";
import { ensureDateRangePicker } from "../load-ha-components.js";
import type { HomeAssistant } from "../types/ha.js";

export function datePickerAvailable(): boolean {
  return customElements.get("ha-date-range-picker") !== undefined;
}

export async function preloadDatePicker(): Promise<void> {
  await ensureDateRangePicker();
}

export function renderDatePicker(
  hass: HomeAssistant | undefined,
  startDate: Date,
  endDate: Date,
  onChange: (startDate: Date, endDate: Date) => void
): TemplateResult {
  return html`
    <div class="date-picker-wrapper">
      <ha-date-range-picker
        .hass=${hass}
        .startDate=${startDate}
        .endDate=${endDate}
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
            onChange(start, end);
          }
        }}
      ></ha-date-range-picker>
    </div>
  `;
}

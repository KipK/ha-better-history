import { html, type TemplateResult } from "lit";
import { ensureDateRangePicker } from "../load-ha-components.js";

export function datePickerAvailable(): boolean {
  return customElements.get("ha-date-range-picker") !== undefined;
}

export async function preloadDatePicker(): Promise<void> {
  await ensureDateRangePicker();
}

export function renderDatePicker(
  startDate: Date,
  endDate: Date,
  onChange: (startDate: Date, endDate: Date) => void
): TemplateResult {
  return html`
    <ha-date-range-picker
      .startDate=${startDate}
      .endDate=${endDate}
      time-picker
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
  `;
}

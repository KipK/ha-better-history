import { html, type TemplateResult } from "lit";
import { ensureDateRangePicker } from "../load-ha-components.js";
import type { HomeAssistant } from "../types/ha.js";

export function datePickerAvailable(): boolean {
  return customElements.get("ha-date-range-picker") !== undefined;
}

export async function preloadDatePicker(): Promise<void> {
  try {
    await ensureDateRangePicker();
  } catch {
    // The loader reports the failure; the caller uses datePickerAvailable() as fallback.
  }
}

interface DatePickerRenderOptions {
  hass: HomeAssistant | undefined;
  startDate: Date;
  endDate: Date;
  onChange: (startDate: Date, endDate: Date) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

function isRangeNavigationInteraction(event: Event): boolean {
  return event.composedPath().some((target) => {
    const localName = (target as { localName?: unknown }).localName;

    return localName === "ha-icon-button-prev" || localName === "ha-icon-button-next";
  });
}

export function renderDatePicker(
  opts: DatePickerRenderOptions
): TemplateResult {
  const onOpen = (event: Event): void => {
    if (!isRangeNavigationInteraction(event)) {
      opts.onOpen?.();
    }
  };

  return html`
    <div
      class="date-picker-wrapper"
      @focusin=${onOpen}
      @pointerdown=${onOpen}
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

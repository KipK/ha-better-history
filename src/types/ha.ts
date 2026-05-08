export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
}

export interface HomeAssistant {
  states: Record<string, HassEntity | undefined>;
  language?: string;
  locale?: {
    language?: string;
  };
  localize?(key: string): string;
  callApi?<T>(method: string, path: string, parameters?: Record<string, unknown>): Promise<T>;
  callWS?<T>(message: Record<string, unknown>): Promise<T>;
  callService(domain: string, service: string, serviceData?: Record<string, unknown>): Promise<unknown>;
}

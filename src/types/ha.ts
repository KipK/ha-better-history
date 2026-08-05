export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
}

export interface HassEntityRegistryEntry {
  entity_id: string;
  device_id?: string | null;
  area_id?: string | null;
  labels?: string[];
  name?: string | null;
  name_by_user?: string | null;
  original_name?: string | null;
}

export interface HassDeviceRegistryEntry {
  id: string;
  area_id?: string | null;
  labels?: string[];
  name?: string | null;
  name_by_user?: string | null;
}

export interface HassAreaRegistryEntry {
  area_id: string;
  floor_id?: string | null;
  labels?: string[];
  name?: string | null;
}

export interface HassFloorRegistryEntry {
  floor_id: string;
  name?: string | null;
}

export interface HomeAssistant {
  states: Record<string, HassEntity | undefined>;
  config?: {
    unit_system?: {
      temperature?: string;
    };
  };
  entities?: Record<string, HassEntityRegistryEntry | undefined>;
  devices?: Record<string, HassDeviceRegistryEntry | undefined>;
  areas?: Record<string, HassAreaRegistryEntry | undefined>;
  floors?: Record<string, HassFloorRegistryEntry | undefined>;
  language?: string;
  locale?: {
    language?: string;
  };
  localize?(key: string): string;
  callApi?<T>(method: string, path: string, parameters?: Record<string, unknown>): Promise<T>;
  callWS?<T>(message: Record<string, unknown>): Promise<T>;
  callService(domain: string, service: string, serviceData?: Record<string, unknown>): Promise<unknown>;
}

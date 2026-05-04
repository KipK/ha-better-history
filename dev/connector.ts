const HA_URL = import.meta.env.VITE_HA_URL || "http://localhost:8123";
const HA_TOKEN = import.meta.env.VITE_HA_TOKEN || "";

interface WsMessage {
  id?: number;
  type: string;
  [key: string]: unknown;
}

interface HassStates {
  [entityId: string]: {
    entity_id: string;
    state: string;
    attributes: Record<string, unknown>;
    last_changed: string;
    last_updated: string;
  } | undefined;
}

const STATES: HassStates = {};

function wsUrl(): string {
  const url = new URL(HA_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/websocket";
  return url.toString();
}

let ws: WebSocket | undefined;
let msgId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let authPromise: Promise<void> | undefined;

function send(msg: WsMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error("WebSocket not connected"));
      return;
    }
    const id = msgId++;
    msg.id = id;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify(msg));
  });
}

export async function connect(): Promise<void> {
  if (authPromise) return authPromise;

  authPromise = new Promise<void>((resolve, reject) => {
    const CONNECT_TIMEOUT = 5000;
    let timedOut = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      ws?.close();
      reject(new Error(`Connection to ${HA_URL} timed out after ${CONNECT_TIMEOUT}ms`));
    }, CONNECT_TIMEOUT);

    ws = new WebSocket(wsUrl());

    ws.onopen = () => {
      if (timedOut) return;
      console.log("[ha-connector] WebSocket opened");
    };

    ws.onmessage = (event) => {
      if (timedOut) return;
      const raw = event.data as string;
      const msg = JSON.parse(raw) as WsMessage & { id?: number; result?: unknown; error?: { message: string }; message?: string };

      if (msg.type === "auth_required" || msg.type === "auth_ok" || msg.type === "auth_invalid") {
        console.log("[ha-connector] ←", msg.type, (msg as { message?: string }).message ?? "");
      }

      if (msg.type === "auth_required") {
        console.log("[ha-connector] → auth (token:", HA_TOKEN.slice(0, 20) + "...)");
        ws!.send(JSON.stringify({ type: "auth", access_token: HA_TOKEN }));
        return;
      }

      if (msg.type === "auth_ok") {
        clearTimeout(timeoutId);
        subscribeStates().then(() => {
          resolve();
        }).catch((err) => {
          reject(new Error(`Failed to load states: ${err}`));
        });
        return;
      }

      if (msg.type === "auth_invalid") {
        clearTimeout(timeoutId);
        reject(new Error(`Invalid auth token: ${msg.message ?? "no details"}`));
        return;
      }

      if (msg.id !== undefined && pending.has(msg.id)) {
        const p = pending.get(msg.id)!;
        pending.delete(msg.id);
        if (msg.error) {
          p.reject(new Error(msg.error.message));
        } else {
          p.resolve(msg.result ?? msg);
        }
        return;
      }

      if (msg.type === "event") {
        const event = msg.event as { event_type?: string; data?: { entity_id?: string; new_state?: HassStates[string] } };
        if (event?.event_type === "state_changed" && event.data?.entity_id && event.data?.new_state) {
          STATES[event.data.entity_id] = event.data.new_state;
        }
      }
    };

    ws.onclose = () => {
      console.warn("[ha-connector] WebSocket closed");
      ws = undefined;
      authPromise = undefined;
      if (!timedOut) {
        clearTimeout(timeoutId);
        reject(new Error("WebSocket closed unexpectedly"));
      }
    };

    ws.onerror = () => {
      if (!timedOut) {
        clearTimeout(timeoutId);
        reject(new Error(`Cannot reach HA at ${HA_URL}`));
      }
    };
  });

  return authPromise;
}

function subscribeStates(): Promise<void> {
  send({ type: "subscribe_events", event_type: "state_changed" }).catch(console.error);
  return send({ type: "get_states" }).then((states) => {
    if (Array.isArray(states)) {
      for (const state of states as HassStates[string][]) {
        if (state?.entity_id) STATES[state.entity_id] = state;
      }
    }
    console.log("[ha-connector] Loaded", Object.keys(STATES).length, "states");
  });
}

export function getHass() {
  return {
    states: STATES,
    language: "en",
    locale: { language: "en" },
    callWS<T = unknown>(message: Record<string, unknown>): Promise<T> {
      return send(message as WsMessage) as Promise<T>;
    },
    async callApi<T>(method: string, path: string, parameters?: Record<string, unknown>): Promise<T> {
      const url = `${HA_URL}/api/${path}`;
      const opts: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${HA_TOKEN}`,
          "Content-Type": "application/json",
        },
      };
      if (parameters && method !== "GET") {
        opts.body = JSON.stringify(parameters);
      }
      const resp = await fetch(url, opts);
      if (!resp.ok) throw new Error(`API ${method} ${path} failed: ${resp.status}`);
      return resp.json() as Promise<T>;
    },
    callService(domain: string, service: string, serviceData?: Record<string, unknown>): Promise<unknown> {
      return this.callApi("POST", `services/${domain}/${service}`, serviceData);
    },
  };
}

// apps/api/src/webhooks/duffel.types.ts

/** Alle Event-Typen, die du abonniert hast (+ ping/testing) */
export type DuffelWebhookType =
  | "order.created"
  | "order.creation_failed"
  | "order.airline_initiated_change_detected"
  | "order_cancellation.created"
  | "order_cancellation.confirmed"
  | "payment.created"
  | "ping.triggered"
  | "testing";

/** Generisches Webhook-Event (Duffel v2) */
export interface DuffelWebhook {
  id: string;
  type: DuffelWebhookType;
  idempotency_key?: string | null;
  api_version?: string;
  live_mode?: boolean;
  created_at?: string;
  data?: {
    object?: unknown; // spezifizieren je nach type
  };
}

/** Teilmenge der Order-Felder, die wir tatsächlich nutzen */
export interface DuffelOrder {
  id: string;
  status?: string | null;
  total_amount?: string | null; // z.B. "123.45"
  total_currency?: string | null; // z.B. "EUR"
  owner?: {
    iata_code?: string | null;
    name?: string | null;
  } | null;
  live_mode?: boolean;
  offer_id?: string | null;
  documents?: DuffelDocument[] | null;
}

/** Dokumente an der Order (z. B. E-Ticket) */
export interface DuffelDocument {
  id?: string;
  type: string; // "electronic_ticket", ...
  unique_identifier?: string | null;
  url?: string | null;
}

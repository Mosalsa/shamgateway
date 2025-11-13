// src/orders/ports.ts
export type Currency = "EUR" | "USD" | "GBP" | string;

export interface PassengerDto {
  id: string;
  type: "adult" | "child" | "infant" | string;
  gender?: "m" | "f" | "x";
  title?: string; // 'mr'|'ms'|...
  given_name: string;
  family_name: string;
  born_on?: string; // YYYY-MM-DD
  email?: string;
  phone_number?: string; // E.164
}

export interface CreateTravelOrderDto {
  offerId: string;
  passengers: PassengerDto[];
  currency?: Currency; // default: offer.currency
  addons?: {
    groundTransfer?: any; // v1: optional, Preis kommt vom PriceBuilder
    courier?: any; // v1: optional
  };
  customer: { id: string; email: string; name?: string };
}

export interface PriceLine {
  code: string; // e.g. 'flight','ground','platform_fee','payment_fee'
  amount: string; // "282.07"
  currency: Currency;
  meta?: Record<string, any>;
}
export interface Pricing {
  currency: Currency;
  lines: PriceLine[];
  total: { amount: string; currency: Currency };
  flightAmount: { amount: string; currency: Currency };
}

export interface PriceBuilder {
  build(input: {
    offer: DuffelOffer;
    addons?: CreateTravelOrderDto["addons"];
    currency?: Currency;
    customerId: string;
  }): Promise<Pricing>;
}

export interface PaymentsPort {
  /** capture sofort (kein hold). */
  capture(params: {
    amount: string;
    currency: Currency;
    customerId: string;
    metadata?: Record<string, any>;
    idempotencyKey: string;
  }): Promise<{ chargeId: string; status: "succeeded" | "failed"; raw?: any }>;

  /** full refund, idempotent wenn möglich */
  refund(params: {
    chargeId: string;
    amount?: string; // full wenn leer
    reason?: string;
    idempotencyKey: string;
  }): Promise<{ refundId: string; status: "succeeded" | "failed"; raw?: any }>;
}

export interface DuffelOffer {
  id: string;
  total_amount: string;
  total_currency: Currency;
  live_mode?: boolean;
  expires_at?: string | null;
  payment_requirements?: {
    requires_instant_payment?: boolean;
    price_guarantee_expires_at?: string | null;
    payment_required_by?: string | null;
  };
  // … wir brauchen min Felder – slices/passenger rules sind für v1 nicht benötigt
}

export interface DuffelOrder {
  id: string;
  type?: "instant" | "hold" | string;
  offer_id?: string;
  total_amount?: string;
  total_currency?: Currency;
  live_mode?: boolean;
  booking_reference?: string | null;
  payment_status?: {
    awaiting_payment?: boolean;
    paid_at?: string | null;
    price_guarantee_expires_at?: string | null;
    payment_required_by?: string | null;
  };
  passengers?: any[];
  slices?: any[];
  documents?: any[];
  owner?: { iata_code?: string; name?: string };
}

export interface DuffelOrdersPort {
  getOffer(offerId: string): Promise<DuffelOffer>;
  createInstantOrder(params: {
    offerId: string;
    passengers: PassengerDto[];
    payments: [{ type: "balance"; amount: string; currency: Currency }];
    idempotencyKey: string;
  }): Promise<DuffelOrder>;
}

export interface TravelOrderRepo {
  upsertTravelOrder(data: {
    idempotencyKey: string;
    userId: string;
    customerId: string;
    offerId: string;
    state: string;
    pricingTotalAmount: string;
    currency: Currency;
    breakdown: PriceLine[];
    chargeId?: string | null;
    duffelOrderId?: string | null;
    bookingRef?: string | null;
    liveMode?: boolean;
    paidAt?: Date | null;
  }): Promise<void>;

  saveDuffelOrderSnapshot(order: DuffelOrder): Promise<void>;
  markState(
    idemKey: string,
    state: string,
    patch?: Partial<Parameters<TravelOrderRepo["upsertTravelOrder"]>[0]>
  ): Promise<void>;
}

export interface TicketsQueue {
  enqueueEticketPoll(orderId: string): Promise<void>;
}

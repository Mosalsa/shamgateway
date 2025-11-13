// src/orders/payments.adapter.ts
import { Injectable } from "@nestjs/common";
import { PaymentsPort, Currency } from "./ports";

@Injectable()
export class PaymentsAdapter implements PaymentsPort {
  async capture(params: {
    amount: string;
    currency: Currency;
    customerId: string;
    metadata?: Record<string, any>;
    idempotencyKey: string;
  }): Promise<{ chargeId: string; status: "succeeded" | "failed"; raw?: any }> {
    // TODO: echte PSP-Anbindung (Stripe PI confirm, o.ä.)
    return { chargeId: `ch_${params.idempotencyKey}`, status: "succeeded" };
  }

  async refund(params: {
    chargeId: string;
    amount?: string;
    reason?: string;
    idempotencyKey: string;
  }): Promise<{ refundId: string; status: "succeeded" | "failed"; raw?: any }> {
    // TODO: echte PSP-Refund
    return { refundId: `rf_${params.idempotencyKey}`, status: "succeeded" };
  }
}

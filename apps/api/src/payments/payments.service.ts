// apps/api/src/payments/payments.service.ts
import {
  Injectable,
  BadRequestException,
  Logger,
  InternalServerErrorException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Stripe from "stripe";
import crypto from "crypto";
import { toMinorUnits, fromMinorUnits } from "./currency.util";
import { DuffelService } from "../duffel/duffel.service";

const PAYMENTS_DEBUG = process.env.PAYMENTS_DEBUG === "1";

function safeJson(obj: unknown) {
  try {
    return JSON.stringify(obj);
  } catch {
    return "[unserializable]";
  }
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly stripe: Stripe;
  private readonly webhookSecret?: string;

  constructor(
    private readonly cfg: ConfigService,
    private readonly duffel: DuffelService
  ) {
    const key = this.cfg.get<string>("STRIPE_SECRET_KEY");
    if (!key) {
      this.logger.warn("STRIPE_SECRET_KEY not set – Stripe client disabled");
    }
    this.stripe = new Stripe(key ?? "", {
      // apiVersion: "2024-06-20",
      appInfo: { name: "shamgateway", version: "1.0.0" },
    });
    this.webhookSecret = this.cfg.get<string>("STRIPE_WEBHOOK_SECRET");
  }

  ping() {
    return { ok: true, service: "payments", ts: new Date().toISOString() };
  }

  // ------- helpers -------
  private logEvent(event: Stripe.Event) {
    const base = `Stripe event: id=${event.id} type=${event.type}`;
    if (PAYMENTS_DEBUG) {
      this.logger.debug(`${base} payload=${safeJson(event)}`);
    } else {
      this.logger.debug(base);
    }
  }

  /** holt (falls nötig) den PI, um z. B. metadata.duffel_order_id zu lesen */
  private async getPaymentIntent(
    piOrId: string | Stripe.PaymentIntent
  ): Promise<Stripe.PaymentIntent | undefined> {
    if (typeof piOrId === "string") {
      try {
        return await this.stripe.paymentIntents.retrieve(piOrId);
      } catch (e: any) {
        this.logger.error(`PI retrieve failed: ${e?.message ?? e}`);
        return undefined;
      }
    }
    return piOrId;
  }

  // ------- Create PI (frei) -------
  async createIntent(input: {
    amount: string;
    currency: string;
    order_id?: string;
    user_id?: string;
  }) {
    let amountMinor: number;
    try {
      amountMinor = toMinorUnits(input.amount, input.currency);
    } catch {
      throw new BadRequestException("Invalid amount or currency");
    }

    const idemKey = crypto
      .createHash("sha256")
      .update(
        `free:${input.order_id ?? "none"}:${input.amount}:${input.currency}`
      )
      .digest("hex");

    try {
      const intent = await this.stripe.paymentIntents.create(
        {
          amount: amountMinor,
          currency: input.currency.toLowerCase(),
          // Für reine CLI-Tests ohne Redirects optional:
          // automatic_payment_methods: { enabled: true, allow_redirects: "never" as const },
          automatic_payment_methods: { enabled: true },
          metadata: {
            ...(input.order_id ? { duffel_order_id: input.order_id } : {}),
            ...(input.user_id ? { user_id: input.user_id } : {}),
          },
        },
        { idempotencyKey: idemKey }
      );

      return {
        id: intent.id,
        client_secret: intent.client_secret,
        amount: input.amount,
        currency: input.currency.toUpperCase(),
      };
    } catch (e: any) {
      throw new InternalServerErrorException(
        `Stripe PI create failed: ${e?.message ?? "unknown"}`
      );
    }
  }

  // ------- Create PI from Duffel Order -------
  async createIntentForOrder(orderId: string, userId?: string) {
    const order = await this.duffel.getOrder(orderId);
    if (!order?.id || !order?.total_amount || !order?.total_currency) {
      throw new BadRequestException("Duffel order not found or missing totals");
    }

    let amountMinor: number;
    try {
      amountMinor = toMinorUnits(order.total_amount, order.total_currency);
    } catch {
      throw new BadRequestException("Invalid Duffel totals");
    }

    const idemKey = crypto
      .createHash("sha256")
      .update(`order:${order.id}:${order.total_amount}:${order.total_currency}`)
      .digest("hex");

    try {
      const intent = await this.stripe.paymentIntents.create(
        {
          amount: amountMinor,
          currency: order.total_currency.toLowerCase(),
          automatic_payment_methods: { enabled: true },
          metadata: {
            duffel_order_id: order.id,
            duffel_owner: order.owner?.iata_code ?? order.owner?.name ?? "",
            ...(userId ? { user_id: userId } : {}),
          },
        },
        { idempotencyKey: idemKey }
      );

      return {
        id: intent.id,
        client_secret: intent.client_secret,
        amount: order.total_amount,
        currency: order.total_currency.toUpperCase(),
      };
    } catch (e: any) {
      throw new InternalServerErrorException(
        `Stripe PI create (order) failed: ${e?.message ?? "unknown"}`
      );
    }
  }

  // ------- Webhook (Stripe) -------
  async handleWebhook(rawBody: Buffer, signature: string) {
    if (!this.webhookSecret)
      throw new BadRequestException("Missing STRIPE_WEBHOOK_SECRET");
    if (!signature)
      throw new BadRequestException("Missing Stripe-Signature header");

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.webhookSecret
      );
    } catch (err: any) {
      this.logger.error(
        `Webhook signature verification failed: ${err?.message}`
      );
      throw new BadRequestException(`Webhook Error: ${err?.message}`);
    }

    this.logEvent(event);

    switch (event.type) {
      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        this.logger.log(
          `PI succeeded: ${pi.id} amount=${pi.amount} ${pi.currency}`
        );
        const orderId = pi.metadata?.duffel_order_id;

        if (orderId) {
          try {
            const amountStr = fromMinorUnits(pi.amount, pi.currency);
            this.logger.log(
              `Duffel pay: order=${orderId} amount=${amountStr} currency=${pi.currency.toUpperCase()} idem=${
                pi.id
              }`
            );
            await this.duffel.createPayment({
              order_id: orderId,
              amount: amountStr,
              currency: pi.currency,
              idempotencyKey: pi.id,
            });
            // TODO: DB -> order status "PAID", store pi.id
          } catch (e) {
            this.logger.error(
              `Duffel settlement failed for order ${orderId}: ${e}`
            );
            // 500 -> Stripe retried den Webhook; call ist idempotent
            throw new InternalServerErrorException("Duffel settlement failed");
          }
        } else {
          this.logger.warn(`PI ${pi.id} without duffel_order_id metadata`);
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent;
        this.logger.warn(
          `PI failed: ${pi.id} ${pi.last_payment_error?.message ?? ""}`
        );
        // TODO: DB -> order/payment failed
        break;
      }

      // ---- Refund handling (reines Stripe-Tracking; Duffel-Policy separat) ----
      case "charge.refunded":
      case "refund.updated": {
        try {
          // Charge ermitteln
          let charge: Stripe.Charge | undefined;
          if (event.type === "charge.refunded") {
            charge = event.data.object as Stripe.Charge;
          } else {
            const refund = event.data.object as Stripe.Refund;
            if (typeof refund.charge === "string") {
              charge = await this.stripe.charges.retrieve(refund.charge);
            } else {
              charge = refund.charge as Stripe.Charge;
            }
          }

          if (!charge) {
            this.logger.warn(`[refund] no charge in event ${event.id}`);
            break;
          }

          const piId =
            typeof charge.payment_intent === "string"
              ? charge.payment_intent
              : (charge.payment_intent as Stripe.PaymentIntent | null)?.id;

          if (!piId) {
            this.logger.warn(
              `[refund] charge ${charge.id} has no payment_intent`
            );
            break;
          }

          const pi = await this.getPaymentIntent(piId);
          const orderId = pi?.metadata?.duffel_order_id;

          const refundedMinor = charge.amount_refunded ?? 0;
          const currency = (
            charge.currency ??
            pi?.currency ??
            "eur"
          ).toUpperCase();
          const refunded = fromMinorUnits(refundedMinor, currency);

          this.logger.log(
            `[refund] PI=${piId} charge=${
              charge.id
            } refunded=${refunded} ${currency} order=${orderId ?? "-"}`
          );

          // TODO: DB:
          // - full refund => status REFUNDED
          // - partial refund => status PARTIALLY_REFUNDED
          // - audit trail (charge/refund ids, amounts)
          //
          // ⚠️ Wichtig: Hier **kein** automatisches Duffel-Undo.
          // Falls gewünscht, eigene Business-Regeln + passende Duffel-APIs nutzen.
        } catch (err: any) {
          this.logger.error(`[refund] handler error: ${err?.message ?? err}`);
          // kein throw -> Refund-Events nicht retryen lassen
        }
        break;
      }

      default:
        this.logger.debug(`Unhandled event type: ${event.type}`);
    }

    // 200 OK -> Stripe zufrieden (außer wir haben bewusst 500 geworfen für Retry)
    return { received: true };
  }
}

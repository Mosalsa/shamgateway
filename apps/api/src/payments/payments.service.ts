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
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";

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
    private readonly duffel: DuffelService,
    @InjectQueue("eticket-poll") private readonly eticketQueue: Queue
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
  // === Hilfsfunktionen (oben in der Klasse ergänzen) =========================
  /** Vergleicht zwei Beträge als Strings mit Währungs-Exponent, z.B. "123.40" EUR */
  private amountsEqual(a: string, b: string, currency: string) {
    try {
      const ma = toMinorUnits(a, currency);
      const mb = toMinorUnits(b, currency);
      return ma === mb;
    } catch {
      return false;
    }
  }

  /** Voll-Refund via Duffel: Quote erzeugen & sofort bestätigen */
  private async refundViaDuffelCancellation(
    orderId: string,
    reason = "customer_refund"
  ) {
    // Quote holen
    const quote = await this.duffel.createOrderCancellation({
      order_id: orderId,
      reason,
    });
    if (!quote?.id)
      throw new Error(`Duffel cancellation quote failed for order ${orderId}`);
    // Confirm
    const confirmed = await this.duffel.confirmOrderCancellation(quote.id);
    return confirmed;
  }
  // ==========================================================================

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
      // apps/api/src/payments/payments.service.ts  (innerhalb switch(event.type))

      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        this.logger.log(
          `PI succeeded: ${pi.id} amount=${pi.amount} ${pi.currency}`
        );

        const orderId = pi.metadata?.duffel_order_id;
        if (!orderId) {
          this.logger.warn(`PI ${pi.id} without duffel_order_id metadata`);
          break;
        }

        // Nur HOLD/awaiting Orders bezahlen – instant bitte überspringen
        const order = await this.duffel.getOrder(orderId);
        const awaiting =
          order?.payment_status?.awaiting_payment === true ||
          order?.type === "hold";

        if (!awaiting) {
          this.logger.log(
            `Skip Duffel payment: order ${orderId} is not awaiting payment (type=${order?.type}, awaiting=${order?.payment_status?.awaiting_payment})`
          );
          break;
        }

        const amountStr = fromMinorUnits(pi.amount, pi.currency);
        const currency = pi.currency.toUpperCase();

        // optional: Plausibilitätscheck gegen Order-Totals
        try {
          const oAmt = order?.total_amount;
          const oCur = (order?.total_currency || "").toUpperCase();
          if (oAmt && oCur && (oCur !== currency || oAmt !== amountStr)) {
            this.logger.warn(
              `Amount/Currency mismatch: PI=${amountStr} ${currency} vs Order=${oAmt} ${oCur}`
            );
            // ggf. break; je nach Policy
          }
        } catch {}

        try {
          this.logger.log(
            `Duffel pay: order=${orderId} amount=${amountStr} currency=${currency} idem=${pi.id}`
          );
          await this.duffel.createPayment({
            order_id: orderId,
            amount: amountStr,
            currency, // UPPERCASE
            idempotencyKey: pi.id, // idempotent via PI-ID
          });
          // TODO: DB -> status "PAID", store pi.id
        } catch (e) {
          this.logger.error(
            `Duffel settlement failed for order ${orderId}: ${e}`
          );
          throw new InternalServerErrorException("Duffel settlement failed");
        }
        await this.duffel.createPayment({
          order_id: orderId,
          amount: amountStr,
          currency,
          idempotencyKey: pi.id,
        });
        await this.eticketQueue.add(
          "poll",
          { orderId },
          { delay: 3000, removeOnComplete: true, removeOnFail: true }
        );

        break;
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent;
        const msg = pi.last_payment_error?.message ?? "";
        const orderId = pi.metadata?.duffel_order_id;

        this.logger.warn(`PI failed: ${pi.id} ${msg} order=${orderId ?? "-"}`);

        // Duffel: nichts buchen/bezahlen – es ist ja fehlgeschlagen.
        // Business: DB markieren, User informieren
        try {
          // TODO: this.prisma.order.update({ where:{ duffelId: orderId }, data:{ paymentStatus:'failed' }})
        } catch {}
        break;
      }

      case "charge.refunded":
      case "refund.updated": {
        // Ziel: Stripe-Refunds ↔ Duffel-Konsistenz
        // full refund -> Duffel Order cancel (Quote + Confirm)
        // partial refund -> KEIN Auto-Handling (Order Changes/Cancellation policy-spezifisch)

        // 1) Charge + PI ermitteln
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
        if (!orderId) {
          this.logger.warn(
            `[refund] PI ${piId} without duffel_order_id; skipping Duffel sync`
          );
          break;
        }

        const currency = (
          charge.currency ||
          pi?.currency ||
          "eur"
        ).toUpperCase();
        const refundedMinor = charge.amount_refunded ?? 0;
        const refunded = fromMinorUnits(refundedMinor, currency);

        // 2) Duffel-Order & Totals
        const order = await this.duffel.getOrder(orderId);
        const total = order?.total_amount;
        const totalCur = (order?.total_currency || "").toUpperCase();
        if (!total || !totalCur) {
          this.logger.warn(
            `[refund] Duffel order ${orderId} has no totals; skipping auto-cancel`
          );
          break;
        }

        // 3) Voll vs. Teil-Refund
        const amountsEqual = (() => {
          try {
            return (
              toMinorUnits(refunded, currency) ===
                toMinorUnits(total, totalCur) && currency === totalCur
            );
          } catch {
            return false;
          }
        })();

        if (!amountsEqual) {
          // PARTIAL
          this.logger.warn(
            `[refund] partial refund: refunded=${refunded} ${currency} vs order=${total} ${totalCur} (order=${orderId}). No automatic Duffel action.`
          );
          // TODO: DB -> PARTIALLY_REFUNDED, Ops-Case anlegen
          break;
        }

        // 4) FULL -> Duffel cancel (Quote + Confirm)
        try {
          this.logger.log(
            `[refund] full refund -> cancelling Duffel order ${orderId}`
          );
          const quote = await this.duffel.createOrderCancellation({
            order_id: orderId,
            reason: "customer_refund",
          });
          const confirmed = await this.duffel.confirmOrderCancellation(
            quote.id
          );

          // Optional: Abgleich der Beträge
          const dAmt = confirmed?.refund_amount;
          const dCur = (confirmed?.refund_currency || "").toUpperCase();
          if (dAmt && dCur && (dCur !== currency || dAmt !== refunded)) {
            this.logger.warn(
              `[refund] mismatch Duffel vs Stripe: Duffel=${dAmt} ${dCur} / Stripe=${refunded} ${currency}`
            );
          }

          // TODO: DB -> REFUNDED, speichern cancellation id / charge / refund ids
        } catch (err: any) {
          this.logger.error(
            `[refund] Duffel cancellation failed for order ${orderId}: ${
              err?.message ?? err
            }`
          );
          // kein throw -> Stripe soll Refund-Webhook nicht retry-blocken
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

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
      appInfo: { name: "shamgateway", version: "1.0.0" },
    });
    this.webhookSecret = this.cfg.get<string>("STRIPE_WEBHOOK_SECRET");
  }

  ping() {
    return { ok: true, service: "payments", ts: new Date().toISOString() };
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
          automatic_payment_methods: { enabled: true }, // EU: Sofort, iDEAL, etc.
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

    switch (event.type) {
      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        this.logger.log(
          `PI succeeded: ${pi.id} amount=${pi.amount} ${pi.currency}`
        );
        const orderId = pi.metadata?.duffel_order_id;

        if (orderId) {
          // Duffel-Settlement: idempotent mit PI-ID
          try {
            const amountStr = fromMinorUnits(pi.amount, pi.currency);
            await this.duffel.createPayment({
              order_id: orderId,
              amount: amountStr,
              currency: pi.currency,
              idempotencyKey: pi.id,
            });
            // TODO: DB: order status -> "paid", store pi.id
          } catch (e) {
            // Duffel-Fehler: 500 werfen -> Stripe wird retryen (idempotent via Idempotency-Key)
            this.logger.error(
              `Duffel settlement failed for order ${orderId}: ${e}`
            );
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
        // TODO: DB: mark order/payment failed
        break;
      }

      default:
        this.logger.debug(`Unhandled event: ${event.type}`);
    }
    // 200 OK -> Stripe zufrieden (außer wir haben bewusst 500 geworfen für Retry)
    return { received: true };
  }
}

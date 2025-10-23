// apps/api/src/payments/payments.service.ts
import {
  Injectable,
  BadRequestException,
  Logger,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Stripe from "stripe";
import crypto from "crypto";
import { toMinorUnits, fromMinorUnits } from "./currency.util";
import { DuffelService } from "../duffel/duffel.service";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { PrismaService } from "../../prisma/prisma.service";
import { RefundOrderDto } from "../orders/dto/refund-order.dto";

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
    @InjectQueue("eticket-poll") private readonly eticketQueue: Queue,
    private readonly prisma: PrismaService
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

  async createIntentForOrder(orderId: string, userId?: string) {
    const order = await this.duffel.getOrder(orderId);
    if (!order?.id || !order?.total_amount || !order?.total_currency) {
      throw new BadRequestException("Duffel order not found or missing totals");
    }

    // 🚧 NEU: Zahlstatus prüfen – nur HOLD/awaiting_payment darf PI bekommen
    const awaiting =
      order?.payment_status?.awaiting_payment === true ||
      order?.type === "hold";

    if (!awaiting) {
      // Order ist bereits bezahlt (instant/balance) -> KEIN Stripe-PI erzeugen
      throw new BadRequestException(
        `Order ${order.id} is not awaiting payment (type=${
          order?.type
        }, paid_at=${order?.payment_status?.paid_at ?? "n/a"})`
      );
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

    // optional: verbose logging
    const base = `Stripe event: id=${event.id} type=${event.type}`;
    if (PAYMENTS_DEBUG) this.logger.debug(`${base} payload=${safeJson(event)}`);
    else this.logger.debug(base);

    switch (event.type) {
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

        const order = await this.duffel.getOrder(orderId);
        const awaiting =
          order?.payment_status?.awaiting_payment === true ||
          order?.type === "hold";

        if (!awaiting) {
          // INSTANT: Duffel bezahlt selbst – wir persistieren PI-Infos
          try {
            await this.prisma.order.update({
              where: { duffelId: orderId },
              data: {
                paymentProvider: "STRIPE",
                paymentIntentId: pi.id,
                paymentStatus: "succeeded",
                // status unverändert lassen; optional nachziehen, falls null:
              },
            });
            // optionales Nachziehen, wenn status null ist:
            const db = await this.prisma.order.findUnique({
              where: { duffelId: orderId },
              select: { status: true },
            });
            const fresh =
              order?.status ?? order?.booking_conditions?.status ?? null;
            if (!db?.status && fresh) {
              await this.prisma.order.update({
                where: { duffelId: orderId },
                data: { status: fresh },
              });
            }
          } catch (e) {
            this.logger.warn(
              `DB update (instant order) failed for ${orderId}: ${e}`
            );
          }

          // ⬅️ NEU: Immer Poll enqueuen (auch bei Instant)
          await this.eticketQueue
            .add(
              "poll",
              { orderId, attempt: 1 },
              {
                jobId: `poll:${orderId}`, // de-dupe
                delay: 3000,
                removeOnComplete: true,
                removeOnFail: true,
              }
            )
            .catch(() => {});
          break;
        }

        // HOLD: erst Duffel settle’n, dann Poll (bestehende Logik)
        const amountStr = fromMinorUnits(pi.amount, pi.currency);
        const currency = pi.currency.toUpperCase();

        try {
          await this.duffel.createPayment({
            order_id: orderId,
            amount: amountStr,
            currency,
            idempotencyKey: pi.id,
          });
        } catch (e) {
          this.logger.error(
            `Duffel settlement failed for order ${orderId}: ${e}`
          );
          throw new InternalServerErrorException("Duffel settlement failed");
        }

        try {
          await this.prisma.order.update({
            where: { duffelId: orderId },
            data: {
              paymentProvider: "STRIPE",
              paymentIntentId: pi.id,
              paymentStatus: "succeeded",
              paidAt: new Date(),
              status: "paid",
            },
          });
        } catch (e) {
          this.logger.error(`DB update failed for order ${orderId}: ${e}`);
        }

        // ⬅️ NEU/Bestätigt: Poll immer enqueuen (idempotent)
        await this.eticketQueue
          .add(
            "poll",
            { orderId, attempt: 1 },
            {
              jobId: `poll:${orderId}`,
              delay: 3000,
              removeOnComplete: true,
              removeOnFail: true,
            }
          )
          .catch(() => {});

        break;
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent;
        const msg = pi.last_payment_error?.message ?? "";
        const orderId = pi.metadata?.duffel_order_id;

        this.logger.warn(`PI failed: ${pi.id} ${msg} order=${orderId ?? "-"}`);

        if (orderId) {
          try {
            await this.prisma.order.update({
              where: { duffelId: orderId },
              data: { paymentStatus: "failed", status: "payment_failed" },
            });
          } catch (e) {
            this.logger.warn(
              `Could not update order ${orderId} after failed payment: ${e}`
            );
          }
        }
        break;
      }

      case "charge.refunded":
      case "refund.updated": {
        // Stripe-Refunds ↔ Duffel-Konsistenz
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

        const pi = await this.stripe.paymentIntents.retrieve(piId);
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

        // Duffel-Order totals
        const dOrder = await this.duffel.getOrder(orderId);
        const total = dOrder?.total_amount;
        const totalCur = (dOrder?.total_currency || "").toUpperCase();
        if (!total || !totalCur) {
          this.logger.warn(
            `[refund] Duffel order ${orderId} has no totals; skipping auto-cancel`
          );
          break;
        }

        const isFullRefund = (() => {
          try {
            return (
              toMinorUnits(refunded, currency) ===
                toMinorUnits(total, totalCur) && currency === totalCur
            );
          } catch {
            return false;
          }
        })();

        if (!isFullRefund) {
          // PARTIAL
          this.logger.warn(
            `[refund] partial refund: refunded=${refunded} ${currency} vs order=${total} ${totalCur} (order=${orderId}). No automatic Duffel action.`
          );
          // Optional: DB-Flag für teilweise erstattet
          try {
            await this.prisma.order.update({
              where: { duffelId: orderId },
              data: { paymentStatus: "partially_refunded" },
            });
          } catch {}
          break;
        }

        // FULL → Duffel cancel (Quote + Confirm)
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

          // DB als refund mark
          try {
            await this.prisma.order.update({
              where: { duffelId: orderId },
              data: { paymentStatus: "refunded", status: "refunded" },
            });
          } catch (e) {
            this.logger.warn(
              `Order DB update (refunded) failed for ${orderId}: ${e}`
            );
          }

          // optional: Abgleich Duffel vs Stripe Beträge loggen
          const dAmt = confirmed?.refund_amount;
          const dCur = (confirmed?.refund_currency || "").toUpperCase();
          if (dAmt && dCur && (dCur !== currency || dAmt !== refunded)) {
            this.logger.warn(
              `[refund] mismatch Duffel vs Stripe: Duffel=${dAmt} ${dCur} / Stripe=${refunded} ${currency}`
            );
          }
        } catch (err: any) {
          this.logger.error(
            `[refund] Duffel cancellation failed for order ${orderId}: ${
              err?.message ?? err
            }`
          );
          // kein throw: Stripe soll Webhook nicht blockieren
        }

        break;
      }

      default:
        this.logger.debug(`Unhandled event type: ${event.type}`);
    }

    return { received: true };
  }

  // ====== Refund Orchestrierung (API) ======
  // ====== Refund Orchestrierung (API) ======
  async refundOrder(orderId: string, dto: RefundOrderDto = {}) {
    // 0) Vorab: Duffel-Order laden & Policy prüfen (freundlicher Fehler)
    try {
      const dOrder = await this.duffel.getOrder(orderId);
      const refundable = !!dOrder?.conditions?.refund_before_departure?.allowed;
      if (!refundable) {
        throw new BadRequestException(
          "Order is not refundable per Duffel policy"
        );
      }
    } catch (e: any) {
      if (e instanceof BadRequestException) throw e;
      // Wenn der Check fehlschlägt, lassen wir Duffel im nächsten Schritt sprechen
    }

    // 1) DB-Order holen (für currency/amount & PI)
    const dbOrder = await this.prisma.order.findUnique({
      where: { duffelId: orderId },
      select: {
        id: true,
        amount: true,
        currency: true,
        paymentIntentId: true,
      },
    });
    if (!dbOrder) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    // 2) PaymentIntent bestimmen (für Stripe partial/full refund)
    let pi: Stripe.PaymentIntent | undefined;
    if (dbOrder.paymentIntentId) {
      try {
        pi = await this.stripe.paymentIntents.retrieve(dbOrder.paymentIntentId);
      } catch {}
    }
    if (!pi) {
      try {
        const res = await this.stripe.paymentIntents.search({
          query: `metadata['duffel_order_id']:'${orderId}' AND status:'succeeded'`,
          limit: 1,
        });
        pi = res.data?.[0];
      } catch (e) {
        this.logger.warn(`Stripe search PI failed for ${orderId}: ${e}`);
      }
    }

    // 3) Refund-Betrag bestimmen (minor units, nur für Stripe)
    const refundCurrency =
      dto.currency?.toUpperCase() ??
      dbOrder.currency?.toUpperCase() ??
      pi?.currency?.toUpperCase() ??
      "EUR";

    let amountMinor: number | undefined;
    if (dto.amount) {
      amountMinor = toMinorUnits(dto.amount, refundCurrency);
    } else if (dbOrder.amount && dbOrder.currency) {
      amountMinor = toMinorUnits(dbOrder.amount, dbOrder.currency);
    } else if (pi) {
      amountMinor = pi.amount_received ?? pi.amount ?? undefined;
    }

    // 4) Duffel: Cancellation (Quote + Confirm)
    let duffelCancel: any | undefined;
    try {
      this.logger.log(`[refund] Duffel cancellation start for ${orderId}`);
      const quote = await this.duffel.createOrderCancellation({
        order_id: orderId,
        reason: dto.reason ?? "customer_refund",
      });

      this.logger.log(
        `[refund] quote id=${quote?.id} amount=${quote?.refund_amount ?? "?"} ${
          quote?.refund_currency ?? ""
        } expires_at=${quote?.expires_at ?? "?"}`
      );

      duffelCancel = await this.duffel.confirmOrderCancellation(quote.id);

      if (!duffelCancel?.id) {
        throw new BadRequestException("Duffel returned no confirmation id");
      }
    } catch (e: any) {
      const msg =
        e?.response?.data?.errors?.[0]?.message ??
        e?.response?.data?.error ??
        e?.message ??
        "Duffel cancellation confirm failed";

      this.logger.error(`[refund] Duffel confirm error for ${orderId}: ${msg}`);
      throw new BadRequestException({
        message: "Duffel cancellation could not be confirmed; refund aborted",
        duffel_error: msg,
      });
    }

    // 5) Stripe: (optional) wirklichen Geld-Refund auslösen, falls PI vorhanden
    let stripeRefund: Stripe.Response<Stripe.Refund> | null = null;
    if (pi) {
      try {
        if (!amountMinor || amountMinor <= 0) {
          // Fallback: Full refund mit PI-amount_received
          amountMinor = pi.amount_received ?? pi.amount ?? undefined;
        }
        if (!amountMinor || amountMinor <= 0) {
          throw new BadRequestException(
            "Refund amount could not be determined"
          );
        }

        stripeRefund = await this.stripe.refunds.create({
          payment_intent: pi.id,
          amount: amountMinor,
          reason: "requested_by_customer",
        });
      } catch (e: any) {
        this.logger.error(
          `[refund] Stripe refund failed for ${orderId} / PI=${
            pi?.id ?? "?"
          }: ${e?.message ?? e}`
        );
        // Kein Throw: Duffel ist bereits storniert – wir geben klaren Status zurück.
      }
    } else {
      this.logger.warn(
        `[refund] No Stripe PI found for ${orderId}; skipping Stripe refund`
      );
    }

    // 6) DB updaten
    try {
      await this.prisma.order.update({
        where: { duffelId: orderId },
        data: {
          status: "cancelled",
          paymentStatus: stripeRefund ? "refunded" : "cancelled",
        },
      });

      // optional: Refund-Row persistieren
      try {
        await this.prisma.refund.create({
          data: {
            duffelId:
              duffelCancel?.id ??
              (stripeRefund
                ? `stripe_${stripeRefund.id}`
                : `duffel_${duffelCancel?.id ?? "unknown"}`),
            orderId: dbOrder.id,
            amount:
              dto.amount ??
              dbOrder.amount ??
              (amountMinor ? fromMinorUnits(amountMinor, refundCurrency) : "0"),
            currency: refundCurrency,
            status: stripeRefund ? "succeeded" : "cancelled",
          },
        });
      } catch {}
    } catch (e) {
      this.logger.warn(`[refund] DB update failed for ${orderId}: ${e}`);
    }

    return {
      ok: true,
      order_id: orderId,
      duffel_cancellation_id: duffelCancel?.id ?? null,
      stripe_refund_id: stripeRefund?.id ?? null,
      amount:
        amountMinor && amountMinor > 0
          ? fromMinorUnits(amountMinor, refundCurrency)
          : dto.amount ?? dbOrder.amount ?? null,
      currency: refundCurrency,
    };
  }

  // NEU: Stripe-only Partial Refund (keine Duffel-Interaktion)
  async refundStripePartial(
    orderId: string,
    body: { amount: string; currency: string; reason?: string }
  ) {
    const { amount, currency, reason } = body || {};
    if (!amount || !currency) {
      throw new BadRequestException(
        "amount and currency are required for partial refund"
      );
    }

    // PI finden (DB -> Search)
    const dbOrder = await this.prisma.order.findUnique({
      where: { duffelId: orderId },
      select: { id: true, paymentIntentId: true, currency: true },
    });
    if (!dbOrder) throw new NotFoundException(`Order ${orderId} not found`);

    let pi: Stripe.PaymentIntent | undefined;
    if (dbOrder.paymentIntentId) {
      try {
        pi = await this.stripe.paymentIntents.retrieve(dbOrder.paymentIntentId);
      } catch {}
    }
    if (!pi) {
      const res = await this.stripe.paymentIntents.search({
        query: `metadata['duffel_order_id']:'${orderId}' AND status:'succeeded'`,
        limit: 1,
      });
      pi = res.data?.[0];
    }
    if (!pi) {
      throw new NotFoundException(
        `No succeeded Stripe PaymentIntent found for order ${orderId}`
      );
    }

    const cur = currency.toUpperCase();
    const minor = toMinorUnits(amount, cur);

    const r = await this.stripe.refunds.create({
      payment_intent: pi.id,
      amount: minor,
      reason: "requested_by_customer",
      metadata: { duffel_order_id: orderId, ...(reason ? { reason } : {}) },
    });

    // Optional: DB-Flag für Partial
    try {
      await this.prisma.order.update({
        where: { duffelId: orderId },
        data: { paymentStatus: "partially_refunded" },
      });
      await this.prisma.refund.create({
        data: {
          duffelId: `stripe_${r.id}`,
          orderId: dbOrder.id,
          amount,
          currency: cur,
          status: "succeeded",
        },
      });
    } catch {}

    return {
      ok: true,
      mode: "stripe_partial",
      order_id: orderId,
      stripe_refund_id: r.id,
      amount,
      currency: cur,
    };
  }
}

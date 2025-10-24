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

  // ---- kleine Helper für konsistente 200-Antworten ----
  private resultOk<T = any>(data?: T, extra: Record<string, any> = {}) {
    return { ok: true, ...(data ?? {}), ...extra };
  }
  private resultFail(
    code: string,
    message: string,
    details?: any,
    extra: Record<string, any> = {}
  ) {
    return {
      ok: false,
      code,
      message,
      ...(details ? { details } : {}),
      ...extra,
    };
  }

  // ⬇️ Füge diese Helper-Methode in die Klasse PaymentsService ein (z.B. unter getPaymentIntent)
  private async getChargesForPaymentIntent(
    piId: string
  ): Promise<Stripe.Charge[]> {
    // 1) Versuche, den PI MIT expand=charges zu holen
    try {
      const pi = await this.stripe.paymentIntents.retrieve(piId, {
        expand: ["charges.data"], // liefert charges.data mit zurück
      });
      const expanded = (pi as any)?.charges?.data as
        | Stripe.Charge[]
        | undefined;
      if (Array.isArray(expanded) && expanded.length) return expanded;
    } catch (e) {
      this.logger.warn(
        `[refundPartial] PI retrieve (expand charges) failed for ${piId}: ${e}`
      );
    }

    // 2) Fallback: Charges direkt listen
    try {
      const list = await this.stripe.charges.list({
        payment_intent: piId,
        limit: 100,
      });
      if (Array.isArray(list.data) && list.data.length) return list.data;
    } catch (e) {
      this.logger.warn(`[refundPartial] charges.list failed for ${piId}: ${e}`);
    }

    // 3) Letzter Fallback: leer
    return [];
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

  // ------- Create PI für Duffel Order (nur HOLD) -------
  async createIntentForOrder(orderId: string, userId?: string) {
    const order = await this.duffel.getOrder(orderId);
    if (!order?.id || !order?.total_amount || !order?.total_currency) {
      return this.resultFail(
        "order_not_found",
        "Duffel order not found or missing totals",
        { order_id: orderId }
      );
    }

    // Duffel-Semantik:
    // - HOLD:   payment_status.awaiting_payment === true
    // - INSTANT:meist paid_at != null und awaiting_payment === false
    const awaiting = order?.payment_status?.awaiting_payment === true;
    const alreadyPaid = !!order?.payment_status?.paid_at;
    const isInstant = String(order?.type || "").toLowerCase() === "instant";

    if (!awaiting || alreadyPaid || isInstant) {
      // 200 + erklärender Body statt 400
      return this.resultFail(
        "already_paid_or_instant",
        `Order is not awaiting payment (type=${
          order?.type ?? "unknown"
        }, paid_at=${order?.payment_status?.paid_at ?? "null"})`,
        {
          order_id: order.id,
          type: order?.type ?? null,
          payment_status: order?.payment_status ?? null,
          hint: "Create a HOLD order (no payments in /orders), then create a Stripe PI and settle via Duffel Payments.",
        }
      );
    }

    let amountMinor: number;
    try {
      amountMinor = toMinorUnits(order.total_amount, order.total_currency);
    } catch {
      return this.resultFail(
        "invalid_totals",
        "Invalid amount/currency on Duffel order",
        {
          order_id: order.id,
          total_amount: order.total_amount,
          total_currency: order.total_currency,
        }
      );
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

      return this.resultOk({
        id: intent.id,
        client_secret: intent.client_secret,
        amount: order.total_amount,
        currency: order.total_currency.toUpperCase(),
      });
    } catch (e: any) {
      return this.resultFail(
        "stripe_pi_create_failed",
        e?.message ?? "Stripe PI create failed",
        { order_id: order.id }
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

  // async refundOrder(orderId: string, dto: RefundOrderDto = {}) {
  //   // 0) Vorab: Duffel-Order laden & Policy prüfen (freundlicher Fehler)
  //   try {
  //     const dOrder = await this.duffel.getOrder(orderId);
  //     const refundable = !!dOrder?.conditions?.refund_before_departure?.allowed;
  //     if (!refundable) {
  //       throw new BadRequestException(
  //         "Order is not refundable per Duffel policy"
  //       );
  //     }
  //   } catch (e: any) {
  //     if (e instanceof BadRequestException) throw e;
  //     // Wenn der Check fehlschlägt, lassen wir Duffel im nächsten Schritt sprechen
  //   }

  //   // 1) DB-Order holen (für currency/amount & PI)
  //   const dbOrder = await this.prisma.order.findUnique({
  //     where: { duffelId: orderId },
  //     select: {
  //       id: true,
  //       amount: true,
  //       currency: true,
  //       paymentIntentId: true,
  //     },
  //   });
  //   if (!dbOrder) {
  //     throw new NotFoundException(`Order ${orderId} not found`);
  //   }

  //   // 2) PaymentIntent bestimmen (für Stripe partial/full refund)
  //   let pi: Stripe.PaymentIntent | undefined;
  //   if (dbOrder.paymentIntentId) {
  //     try {
  //       pi = await this.stripe.paymentIntents.retrieve(dbOrder.paymentIntentId);
  //     } catch {}
  //   }
  //   if (!pi) {
  //     try {
  //       const res = await this.stripe.paymentIntents.search({
  //         query: `metadata['duffel_order_id']:'${orderId}' AND status:'succeeded'`,
  //         limit: 1,
  //       });
  //       pi = res.data?.[0];
  //     } catch (e) {
  //       this.logger.warn(`Stripe search PI failed for ${orderId}: ${e}`);
  //     }
  //   }

  //   // 3) Refund-Betrag bestimmen (minor units, nur für Stripe)
  //   const refundCurrency =
  //     dto.currency?.toUpperCase() ??
  //     dbOrder.currency?.toUpperCase() ??
  //     pi?.currency?.toUpperCase() ??
  //     "EUR";

  //   let amountMinor: number | undefined;
  //   if (dto.amount) {
  //     amountMinor = toMinorUnits(dto.amount, refundCurrency);
  //   } else if (dbOrder.amount && dbOrder.currency) {
  //     amountMinor = toMinorUnits(dbOrder.amount, dbOrder.currency);
  //   } else if (pi) {
  //     amountMinor = pi.amount_received ?? pi.amount ?? undefined;
  //   }

  //   // 4) Duffel: Cancellation (Quote + Confirm)
  //   let duffelCancel: any | undefined;
  //   try {
  //     this.logger.log(`[refund] Duffel cancellation start for ${orderId}`);
  //     const quote = await this.duffel.createOrderCancellation({
  //       order_id: orderId,
  //       reason: dto.reason ?? "customer_refund",
  //     });

  //     this.logger.log(
  //       `[refund] quote id=${quote?.id} amount=${quote?.refund_amount ?? "?"} ${
  //         quote?.refund_currency ?? ""
  //       } expires_at=${quote?.expires_at ?? "?"}`
  //     );

  //     duffelCancel = await this.duffel.confirmOrderCancellation(quote.id);

  //     if (!duffelCancel?.id) {
  //       throw new BadRequestException("Duffel returned no confirmation id");
  //     }
  //   } catch (e: any) {
  //     const msg =
  //       e?.response?.data?.errors?.[0]?.message ??
  //       e?.response?.data?.error ??
  //       e?.message ??
  //       "Duffel cancellation confirm failed";

  //     this.logger.error(`[refund] Duffel confirm error for ${orderId}: ${msg}`);
  //     throw new BadRequestException({
  //       message: "Duffel cancellation could not be confirmed; refund aborted",
  //       duffel_error: msg,
  //     });
  //   }

  //   // 5) Stripe: (optional) wirklichen Geld-Refund auslösen, falls PI vorhanden
  //   let stripeRefund: Stripe.Response<Stripe.Refund> | null = null;
  //   if (pi) {
  //     try {
  //       if (!amountMinor || amountMinor <= 0) {
  //         // Fallback: Full refund mit PI-amount_received
  //         amountMinor = pi.amount_received ?? pi.amount ?? undefined;
  //       }
  //       if (!amountMinor || amountMinor <= 0) {
  //         throw new BadRequestException(
  //           "Refund amount could not be determined"
  //         );
  //       }

  //       stripeRefund = await this.stripe.refunds.create({
  //         payment_intent: pi.id,
  //         amount: amountMinor,
  //         reason: "requested_by_customer",
  //       });
  //     } catch (e: any) {
  //       this.logger.error(
  //         `[refund] Stripe refund failed for ${orderId} / PI=${
  //           pi?.id ?? "?"
  //         }: ${e?.message ?? e}`
  //       );
  //       // Kein Throw: Duffel ist bereits storniert – wir geben klaren Status zurück.
  //     }
  //   } else {
  //     this.logger.warn(
  //       `[refund] No Stripe PI found for ${orderId}; skipping Stripe refund`
  //     );
  //   }

  //   // 6) DB updaten
  //   try {
  //     await this.prisma.order.update({
  //       where: { duffelId: orderId },
  //       data: {
  //         status: "cancelled",
  //         paymentStatus: stripeRefund ? "refunded" : "cancelled",
  //       },
  //     });

  //     // optional: Refund-Row persistieren
  //     try {
  //       await this.prisma.refund.create({
  //         data: {
  //           duffelId:
  //             duffelCancel?.id ??
  //             (stripeRefund
  //               ? `stripe_${stripeRefund.id}`
  //               : `duffel_${duffelCancel?.id ?? "unknown"}`),
  //           orderId: dbOrder.id,
  //           amount:
  //             dto.amount ??
  //             dbOrder.amount ??
  //             (amountMinor ? fromMinorUnits(amountMinor, refundCurrency) : "0"),
  //           currency: refundCurrency,
  //           status: stripeRefund ? "succeeded" : "cancelled",
  //         },
  //       });
  //     } catch {}
  //   } catch (e) {
  //     this.logger.warn(`[refund] DB update failed for ${orderId}: ${e}`);
  //   }

  //   return {
  //     ok: true,
  //     order_id: orderId,
  //     duffel_cancellation_id: duffelCancel?.id ?? null,
  //     stripe_refund_id: stripeRefund?.id ?? null,
  //     amount:
  //       amountMinor && amountMinor > 0
  //         ? fromMinorUnits(amountMinor, refundCurrency)
  //         : dto.amount ?? dbOrder.amount ?? null,
  //     currency: refundCurrency,
  //   };
  // }

  // ====== Refund Orchestrierung (API) – jetzt ohne 400-Throw, liefert ok:false ======
  async refundOrder(orderId: string, dto: RefundOrderDto = {}) {
    // 0) Vorab-Policy-Check (freundliche Antwort statt Exception)
    try {
      const dOrder = await this.duffel.getOrder(orderId);
      const refundable = !!dOrder?.conditions?.refund_before_departure?.allowed;
      if (!refundable) {
        return this.resultFail(
          "not_refundable",
          "Order is not refundable per Duffel policy",
          {
            order_id: orderId,
            policy: dOrder?.conditions?.refund_before_departure ?? null,
            type: dOrder?.type ?? null,
          }
        );
      }
    } catch (e: any) {
      // Wenn der Check scheitert, fahren wir fort und lassen ggf. Duffel sprechen.
      this.logger.warn(
        `[refund] pre-check failed for ${orderId}: ${e?.message ?? e}`
      );
    }

    // 1) DB-Order
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
      return this.resultFail("order_not_found", `Order ${orderId} not found`);
    }

    // 2) PaymentIntent (optional)
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

    // 3) Betrag (minor) nur für Stripe
    const refundCurrency =
      dto.currency?.toUpperCase() ??
      dbOrder.currency?.toUpperCase() ??
      pi?.currency?.toUpperCase() ??
      "EUR";

    let amountMinor: number | undefined;
    if (dto.amount) {
      try {
        amountMinor = toMinorUnits(dto.amount, refundCurrency);
      } catch {
        return this.resultFail(
          "invalid_amount",
          "Refund amount has invalid format",
          { amount: dto.amount, currency: refundCurrency }
        );
      }
    } else if (dbOrder.amount && dbOrder.currency) {
      amountMinor = toMinorUnits(dbOrder.amount, dbOrder.currency);
    } else if (pi) {
      amountMinor = pi.amount_received ?? pi.amount ?? undefined;
    }

    // 4) Duffel: Quote + Confirm (freundliche Fehler)
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
        return this.resultFail(
          "duffel_no_confirmation",
          "Duffel returned no confirmation id",
          { order_id: orderId, quote_id: quote?.id ?? null }
        );
      }
    } catch (e: any) {
      const msg =
        e?.response?.data?.errors?.[0]?.message ??
        e?.response?.data?.error ??
        e?.message ??
        "Duffel cancellation confirm failed";

      this.logger.error(`[refund] Duffel confirm error for ${orderId}: ${msg}`);
      return this.resultFail(
        "duffel_confirm_failed",
        "Duffel cancellation could not be confirmed; refund aborted",
        { duffel_error: msg, order_id: orderId }
      );
    }

    // 5) Stripe: optionaler Geld-Refund (falls PI vorhanden)
    let stripeRefund: Stripe.Response<Stripe.Refund> | null = null;
    if (pi) {
      try {
        if (!amountMinor || amountMinor <= 0) {
          amountMinor = pi.amount_received ?? pi.amount ?? undefined;
        }
        if (amountMinor && amountMinor > 0) {
          stripeRefund = await this.stripe.refunds.create({
            payment_intent: pi.id,
            amount: amountMinor,
            reason: "requested_by_customer",
          });
        } else {
          this.logger.warn(
            `[refund] could not determine refund amount for Stripe; skipping`
          );
        }
      } catch (e: any) {
        this.logger.error(
          `[refund] Stripe refund failed for ${orderId} / PI=${
            pi?.id ?? "?"
          }: ${e?.message ?? e}`
        );
        // kein Throw – Duffel ist schon storniert
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

      // optional: Refund row
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

    // 7) Freundliche Erfolgsmeldung
    return this.resultOk({
      order_id: orderId,
      duffel_cancellation_id: duffelCancel?.id ?? null,
      stripe_refund_id: stripeRefund?.id ?? null,
      amount:
        amountMinor && amountMinor > 0
          ? fromMinorUnits(amountMinor, refundCurrency)
          : dto.amount ?? dbOrder.amount ?? null,
      currency: refundCurrency,
    });
  }

  // NEU: Stripe-only Partial Refund (keine Duffel-Interaktion)
  async refundStripePartial(
    orderId: string,
    body: { amount: string; currency: string; reason?: string }
  ) {
    const { amount, currency, reason } = body || {};
    if (!amount || !currency) {
      return this.resultFail(
        "missing_params",
        "amount and currency are required for partial refund",
        { amount, currency }
      );
    }

    // 1) DB-Order holen
    const dbOrder = await this.prisma.order.findUnique({
      where: { duffelId: orderId },
      select: { id: true, paymentIntentId: true, currency: true },
    });
    if (!dbOrder) {
      return this.resultFail("order_not_found", `Order ${orderId} not found`);
    }

    // 2) PaymentIntent ermitteln
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
    if (!pi) {
      return this.resultFail(
        "pi_not_found",
        `No succeeded Stripe PaymentIntent found for order ${orderId}`
      );
    }

    // 3) Währungs-Check: Refund muss in PI-Währung erfolgen
    const piCurrency = (pi.currency || "").toUpperCase();
    const reqCurrency = currency.toUpperCase();
    if (!piCurrency) {
      return this.resultFail(
        "pi_currency_unknown",
        "Could not determine PaymentIntent currency",
        { payment_intent: pi.id }
      );
    }
    if (reqCurrency !== piCurrency) {
      return this.resultFail(
        "currency_mismatch",
        "Partial refund currency must equal the original charge currency",
        { expected_currency: piCurrency, got: reqCurrency }
      );
    }

    // 4) Betrag validieren (minor units) & verfügbaren Rest prüfen
    let minor: number;
    try {
      minor = toMinorUnits(amount, reqCurrency);
    } catch {
      return this.resultFail("invalid_amount", "Invalid amount format", {
        amount,
        currency: reqCurrency,
      });
    }
    if (minor <= 0) {
      return this.resultFail(
        "non_positive_amount",
        "Refund amount must be greater than 0",
        { minor }
      );
    }

    // Verbleibender, noch erstattbarer Betrag ermitteln
    let refundableMinor: number | undefined;
    try {
      const charges = await this.getChargesForPaymentIntent(pi.id);

      // Falls trotzdem nichts: versuche latest_charge einzeln zu holen
      if (
        !charges.length &&
        typeof pi.latest_charge === "string" &&
        pi.latest_charge
      ) {
        try {
          const ch = await this.stripe.charges.retrieve(pi.latest_charge);
          if (ch) charges.push(ch as any);
        } catch (e) {
          this.logger.warn(
            `[refundPartial] retrieve latest_charge failed for ${pi.latest_charge}: ${e}`
          );
        }
      }

      let captured = 0;
      let refunded = 0;
      for (const ch of charges) {
        // Stripe-Charge Felder defensiv lesen
        const cap =
          typeof ch.amount_captured === "number"
            ? ch.amount_captured
            : typeof ch.amount === "number"
            ? ch.amount
            : 0;
        const ref =
          typeof ch.amount_refunded === "number" ? ch.amount_refunded : 0;
        captured += cap;
        refunded += ref;
      }
      refundableMinor = Math.max(0, captured - refunded);
    } catch (e) {
      this.logger.warn(
        `[refundPartial] could not compute refundable amount for PI ${pi.id}: ${e}`
      );
    }

    if (typeof refundableMinor === "number" && minor > refundableMinor) {
      return this.resultFail(
        "amount_exceeds_remaining",
        "Refund amount exceeds remaining refundable balance",
        {
          requested_minor: minor,
          remaining_minor: refundableMinor,
          currency: reqCurrency,
        }
      );
    }

    // 5) Stripe Refund erstellen
    try {
      const refund = await this.stripe.refunds.create({
        payment_intent: pi.id,
        amount: minor,
        reason: "requested_by_customer",
        metadata: {
          duffel_order_id: orderId,
          ...(reason ? { reason } : {}),
        },
      });

      // 6) DB markieren (partial)
      try {
        await this.prisma.order.update({
          where: { duffelId: orderId },
          data: { paymentStatus: "partially_refunded" },
        });
        await this.prisma.refund.create({
          data: {
            duffelId: `stripe_${refund.id}`,
            orderId: dbOrder.id,
            amount, // als String gespeichert
            currency: reqCurrency,
            status: "succeeded",
          },
        });
      } catch (e) {
        this.logger.warn(
          `[refundPartial] DB update failed for ${orderId}: ${e}`
        );
      }

      return this.resultOk({
        ok: true,
        mode: "stripe_partial",
        order_id: orderId,
        stripe_refund_id: refund.id,
        amount,
        currency: reqCurrency,
        remaining_after_minor:
          typeof refundableMinor === "number"
            ? Math.max(0, refundableMinor - minor)
            : undefined,
      });
    } catch (e: any) {
      const msg = e?.message ?? "Stripe refund failed";
      this.logger.error(`[refundPartial] Stripe failed for ${orderId}: ${msg}`);
      return this.resultFail("stripe_refund_failed", msg, {
        order_id: orderId,
        payment_intent: pi.id,
      });
    }
  }
}

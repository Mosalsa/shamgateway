// apps/api/src/bookings/bookings.service.ts
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { OrdersService } from "../orders/orders.service";
import { PaymentsService } from "../payments/payments.service";
import { PrismaService } from "../../prisma/prisma.service";
import { BookOrderDto } from "./dto/book-order.dto";

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly prisma: PrismaService
  ) {}

  /**
   * Haupt-Flow:
   * 1) Stripe PaymentIntent verifizieren (succeeded, Amount, Currency)
   * 2) Duffel-Order via OrdersService.create() erstellen
   * 3) Stripe-PI an DB-Order hängen (paymentIntentId, Provider, paidAt)
   */
  async book(dto: BookOrderDto, userId: string) {
    // --- 1) PaymentIntent prüfen ---
    const verification = await this.payments.verifyPrepaidIntent(
      dto.stripePaymentIntentId,
      dto.totalAmount,
      dto.currency
    );

    // TS kennt hier nur { ok: boolean }, deshalb casten wir das Fehler-Objekt explizit
    if (!verification.ok) {
      const fail: any = verification;

      throw new BadRequestException({
        code: fail.code ?? "payment_verification_failed",
        message:
          fail.message ??
          "Zahlung konnte nicht verifiziert werden. Bitte erneut versuchen.",
        details: fail.details ?? undefined,
      });
    }

    // Erfolgszweig – hier liegt der echte PaymentIntent drin
    const success: any = verification;
    const pi = success.intent;

    // --- 2) Duffel-Order erstellen ---
    // OrdersService kümmert sich intern um:
    // - hold vs instant
    // - Fallback hold->instant mit balance
    const orderResult = await this.orders.create(
      {
        offerId: dto.offerId,
        passengers: dto.passengers,
        // WICHTIG: keine payments -> wir zahlen als Plattform mit balance/HOLD-Flow
      } as any,
      userId
    );

    // --- 3) Stripe-PI an unsere DB-Order hängen ---
    try {
      await this.prisma.order.update({
        where: { duffelId: orderResult.order_id },
        data: {
          paymentProvider: "STRIPE",
          paymentIntentId: pi.id,
          paymentStatus: "succeeded",
          paidAt: pi.created ? new Date(pi.created * 1000) : new Date(),
        },
      });
    } catch (e) {
      this.logger.warn(
        `Could not attach PaymentIntent ${pi.id} to order ${orderResult.order_id}: ${e}`
      );
    }

    return {
      ...orderResult,
      payment_intent_id: pi.id,
    };
  }
}

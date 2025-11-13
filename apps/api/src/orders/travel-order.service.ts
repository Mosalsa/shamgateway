// src/orders/travel-order.service.ts
import {
  Injectable,
  BadRequestException,
  HttpException,
  Inject,
} from "@nestjs/common";
import {
  CreateTravelOrderDto,
  PaymentsPort,
  DuffelOrdersPort,
  PriceBuilder,
  TravelOrderRepo,
  TicketsQueue,
  Currency,
  PassengerDto,
} from "./ports";
import * as crypto from "crypto";

@Injectable()
export class TravelOrderService {
  constructor(
    @Inject("PaymentsPort") private readonly payments: PaymentsPort,
    @Inject("DuffelOrdersPort") private readonly duffel: DuffelOrdersPort,
    @Inject("PriceBuilder") private readonly priceBuilder: PriceBuilder,
    @Inject("TravelOrderRepo") private readonly repo: TravelOrderRepo,
    @Inject("TicketsQueue") private readonly ticketsQueue: TicketsQueue
  ) {}

  /** Neuer v1-Entry: Kunde zahlt an uns → wir bezahlen Duffel (balance) → Order issued. */
  async createAndIssue(dto: CreateTravelOrderDto, currentUserId: string) {
    // 1) Offer prüfen (fresh)
    const offer = await this.duffel.getOffer(dto.offerId);
    this.assertOfferFresh(offer);

    // 2) Pricing bauen (Flight + Fees + optional Ground/Courier)
    const pricing = await this.priceBuilder.build({
      offer,
      addons: dto.addons,
      currency: dto.currency,
      customerId: dto.customer.id,
    });

    // 3) IdempotencyKey (TravelOrder-weit)
    const idem = this.buildIdempotencyKey({
      userId: currentUserId,
      offerId: offer.id,
      passengers: dto.passengers,
      total: pricing.total,
      version: "v1-instant",
    });

    // 4) Primäre Persistenz: proposed/pricing_built
    await this.repo.upsertTravelOrder({
      idempotencyKey: idem,
      userId: currentUserId,
      customerId: dto.customer.id,
      offerId: offer.id,
      state: "pricing_built",
      pricingTotalAmount: pricing.total.amount,
      currency: pricing.total.currency,
      breakdown: pricing.lines,
      chargeId: null,
      duffelOrderId: null,
      bookingRef: null,
      liveMode: !!offer.live_mode,
      paidAt: null,
    });

    // 5) Kundenzahlung (direct capture)
    const charge = await this.payments.capture({
      amount: pricing.total.amount,
      currency: pricing.total.currency,
      customerId: dto.customer.id,
      idempotencyKey: idem,
      metadata: { kind: "travel_order", offerId: offer.id },
    });
    if (charge.status !== "succeeded") {
      await this.repo.markState(idem, "payment_failed", {});
      throw new BadRequestException("Customer payment failed");
    }
    await this.repo.markState(idem, "payment_captured", {
      chargeId: charge.chargeId,
      paidAt: new Date(),
    });

    // 6) Duffel Order (instant, wir zahlen aus UNSEREM Duffel-Balance den Flight-Preis)
    let duffelOrder: any;
    try {
      duffelOrder = await this.duffel.createInstantOrder({
        offerId: offer.id,
        passengers: this.mapDuffelPassengers(dto.passengers),
        payments: [
          {
            type: "balance",
            amount: offer.total_amount,
            currency: offer.total_currency,
          },
        ],
        idempotencyKey: idem,
      });
    } catch (err: any) {
      // Airline/Kanal failt → sofort Full Refund an Kunden
      await this.repo.markState(idem, "issue_failed", {});
      await this.safeRefundFull(
        charge.chargeId,
        pricing.total.amount,
        pricing.total.currency,
        idem,
        "duffel_issue_failed"
      );
      throw new HttpException(
        this.safeErrMsg(err, "Duffel order failed"),
        err?.status ?? 502
      );
    }

    if (!duffelOrder?.id) {
      await this.repo.markState(idem, "issue_failed", {});
      await this.safeRefundFull(
        charge.chargeId,
        pricing.total.amount,
        pricing.total.currency,
        idem,
        "duffel_missing_id"
      );
      throw new BadRequestException("Duffel did not return order id");
    }

    // 7) Persist Duffel Snapshot & Tickets Poll
    await Promise.all([
      this.repo.saveDuffelOrderSnapshot(duffelOrder),
      this.ticketsQueue.enqueueEticketPoll(duffelOrder.id).catch(() => void 0),
    ]);

    // 8) Final persist
    await this.repo.markState(idem, "issued_air", {
      duffelOrderId: duffelOrder.id,
      bookingRef: duffelOrder.booking_reference ?? null,
    });

    // 9) Response an Client (stabil, minimal)
    return {
      travel_order_id: idem,
      duffel_order_id: duffelOrder.id,
      status: "issued",
      paid_at: new Date().toISOString(),
      total_amount: pricing.total.amount,
      total_currency: pricing.total.currency,
      flight_amount: offer.total_amount,
      flight_currency: offer.total_currency,
      owner: duffelOrder?.owner?.iata_code ?? duffelOrder?.owner?.name ?? null,
      live_mode: !!duffelOrder.live_mode,
      booking_reference: duffelOrder.booking_reference ?? null,
    };
  }

  // --------- helpers ---------
  private mapDuffelPassengers(pax: PassengerDto[]) {
    return pax.map((p) => ({
      id: p.id,
      type: p.type,
      gender: p.gender,
      title: p.title,
      given_name: p.given_name,
      family_name: p.family_name,
      born_on: p.born_on,
      email: p.email,
      phone_number: p.phone_number,
    }));
  }

  private assertOfferFresh(offer: {
    expires_at?: string | null;
    payment_requirements?: any;
  }) {
    const now = Date.now();
    const pg = offer?.payment_requirements?.price_guarantee_expires_at
      ? Date.parse(offer.payment_requirements.price_guarantee_expires_at)
      : null;
    const exp = offer?.expires_at ? Date.parse(offer.expires_at) : null;

    // wenn eines vorhanden ist und abgelaufen → blocken (wir verkaufen sonst „tote“ Preise)
    if ((pg && pg < now) || (exp && exp < now)) {
      throw new BadRequestException({
        code: "offer_expired",
        message: "Offer price guarantee expired. Please re-select an offer.",
      });
    }
  }

  private buildIdempotencyKey(input: {
    userId: string;
    offerId: string;
    passengers: PassengerDto[];
    total: { amount: string; currency: Currency };
    version: string;
  }) {
    const hash = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          u: input.userId,
          o: input.offerId,
          p: input.passengers.map((p) => ({
            id: p.id,
            n: p.given_name,
            f: p.family_name,
          })),
          t: input.total,
          v: input.version,
        })
      )
      .digest("hex");
    return `trav_${hash.slice(0, 32)}`;
  }

  private async safeRefundFull(
    chargeId: string,
    amount: string,
    currency: Currency,
    idem: string,
    reason: string
  ) {
    try {
      await this.repo.markState(idem, "refunding", {});
      const r = await this.payments.refund({
        chargeId,
        idempotencyKey: `${idem}:refund`,
        reason,
      });
      await this.repo.markState(
        idem,
        r.status === "succeeded" ? "refunded" : "refund_failed",
        {}
      );
    } catch {
      await this.repo.markState(idem, "refund_failed", {});
    }
  }

  private safeErrMsg(err: any, fallback: string) {
    const m = err?.response?.data ?? err?.message ?? fallback;
    return typeof m === "string" ? m : JSON.stringify(m);
  }
}

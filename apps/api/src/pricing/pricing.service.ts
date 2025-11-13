import { Injectable, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
// Falls du einen Duffel-Wrapper hast, importiere ihn hier.
type PriceModel = {
  base_fixed: string;
  per_km: string;
  per_pax: string;
  per_bag: string;
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
function toStr(n: number) {
  return n.toFixed(2);
}

@Injectable()
export class PricingService {
  constructor(private prisma: PrismaService) {}

  private async fx(base: string, quote: string) {
    if (base === quote) return 1;
    const row = await this.prisma.fxRate.findUnique({
      where: { base_quote: { base, quote } },
    });
    if (!row) throw new BadRequestException(`fx_missing_${base}_${quote}`);
    return Number(row.rate);
  }

  private convert(amount: number, from: string, to: string) {
    // simple convert via fx(from->to); assume direct pair exists
    // You can extend with triangulation if needed.
    return amount * /*fx(from->to)*/ 1; // will be replaced per-call
  }

  private calcGroundUSD(pm: PriceModel, km: number, pax: number, bags: number) {
    const n = (s: string) => Number(s || "0");
    return (
      n(pm.base_fixed) +
      km * n(pm.per_km) +
      pax * n(pm.per_pax) +
      bags * n(pm.per_bag)
    );
  }

  private async applyFee(
    amountEUR: number,
    kind: "service" | "card" | "shamcash" | "vat"
  ) {
    const policy = await this.prisma.feePolicy.findFirst({
      where: { kind, active: true },
    });
    if (!policy) return 0;
    // convert amount -> policyCurrency -> apply -> back to EUR
    const toPolicy = (await this.fx("EUR", policy.policyCurrency)) || 1;
    const fromPolicy = (await this.fx(policy.policyCurrency, "EUR")) || 1;
    const amountInPolicy = amountEUR * toPolicy;
    const feePolicy =
      (Number(policy.percent) / 100) * amountInPolicy + Number(policy.fixed);
    return feePolicy * fromPolicy;
  }

  async buildQuote(dto: {
    offer_id: string;
    ground: { route_id: string; pax: number; bags: number };
    currency: "EUR" | "USD" | "SYP";
    pay_method: "card" | "shamcash";
  }) {
    // 1) Duffel Offer holen (hier nur stub – integriere deinen Duffel-Service)
    // const offer = await this.duffel.getOffer(dto.offer_id);
    // const flightAmount = Number(offer.total_amount);
    // const flightCurrency = offer.total_currency || "EUR";
    throw new BadRequestException("duffel_integration_required"); // <-- Entfernen, wenn eingebunden

    // --- Beispiel ohne Duffel (bis du integrierst) ---
    // const flightAmount = 220; const flightCurrency = "EUR";

    // // 2) Ground
    // const route = await this.prisma.transportRoute.findUnique({ where: { id: dto.ground.route_id } });
    // if (!route || !route.active) throw new BadRequestException("route_not_found_or_inactive");
    // const groundUSD = this.calcGroundUSD(route.priceModel as any, route.baseKm, dto.ground.pax, dto.ground.bags);
    // const fxUSDtoEUR = await this.fx("USD","EUR");
    // const groundEUR = groundUSD * fxUSDtoEUR;

    // // 3) Flight -> EUR
    // const fxFlightToEUR = await this.fx(flightCurrency,"EUR");
    // const flightEUR = flightAmount * fxFlightToEUR;

    // // 4) Service Fee
    // const preFee = flightEUR + groundEUR;
    // const serviceFee = await this.applyFee(preFee, "service");

    // // 5) Payment Fee
    // const baseForPay = preFee + serviceFee;
    // const payFee = await this.applyFee(baseForPay, dto.pay_method);

    // // 6) VAT (z. B. nur auf Service Fee)
    // const tax = await this.applyFee(serviceFee, "vat");

    // // 7) Sum & round
    // const totalEUR = round2(flightEUR + groundEUR + serviceFee + payFee + tax);
    // const fxEURtoDisp = await this.fx("EUR", dto.currency);
    // const totalDisp = round2(totalEUR * fxEURtoDisp);

    // // 8) Persist
    // const quote = await this.prisma.priceQuote.create({
    //   data: {
    //     currency: dto.currency,
    //     breakdown: [
    //       { code: "FLIGHT_NET", amount: toStr(flightEUR), currency: "EUR", meta: { offer_id: dto.offer_id } },
    //       { code: "GROUND_NET", amount: toStr(groundEUR), currency: "EUR", meta: { route_id: dto.ground.route_id } },
    //       { code: "SERVICE_FEE", amount: toStr(serviceFee), currency: "EUR" },
    //       { code: "PAYMENT_FEE", amount: toStr(payFee), currency: "EUR", meta: { method: dto.pay_method } },
    //       { code: "TAX", amount: toStr(tax), currency: "EUR" }
    //     ],
    //     subtotal: new this.prisma.Prisma.Decimal((flightEUR + groundEUR).toFixed(2)),
    //     paymentFee: new this.prisma.Prisma.Decimal(payFee.toFixed(2)),
    //     tax: new this.prisma.Prisma.Decimal(tax.toFixed(2)),
    //     total: new this.prisma.Prisma.Decimal(totalEUR.toFixed(2)),
    //   }
    // });

    // return { quote_id: quote.id, currency: dto.currency, components: quote.breakdown, total: toStr(totalDisp) };
  }

  async createPaymentIntentFromQuote(dto: {
    quote_id: string;
    travel_order_id?: string;
    pay_method: "card" | "shamcash";
  }) {
    // Hole Quote
    const q = await this.prisma.priceQuote.findUnique({
      where: { id: dto.quote_id },
    });
    if (!q) throw new BadRequestException("quote_not_found");

    // CARD: Stripe PI (automatic capture, kind=travel_order)
    if (dto.pay_method === "card") {
      // @ts-ignore Stripe-Client aus deinem PaymentsService nutzen, hier nur Platzhalter
      throw new BadRequestException("stripe_integration_required");
      // const amountMinor = Math.round(Number(q.total) * 100);
      // const pi = await stripe.paymentIntents.create({
      //   amount: amountMinor,
      //   currency: q.currency.toLowerCase(),
      //   capture_method: "automatic",
      //   metadata: { kind: "travel_order", quote_id: q.id, travel_order_id: dto.travel_order_id ?? "" }
      // }, { idempotencyKey: `pqi_${q.id}` });
      // return { payment_intent_id: pi.id, client_secret: pi.client_secret };
    }

    // SHAMCASH: Stub – erzeuge Referenz & markiere TravelOrder pending
    if (dto.pay_method === "shamcash") {
      const escrowRef = `shc_${Date.now()}`;
      return {
        shamcash_ref: escrowRef,
        instructions: "Bitte mit dieser Referenz in SYP zahlen.",
      };
    }

    throw new BadRequestException("unsupported_payment_method");
  }
}

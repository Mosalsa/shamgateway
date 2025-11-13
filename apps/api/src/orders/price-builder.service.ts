// src/orders/price-builder.service.ts
import { Injectable } from "@nestjs/common";
import { PriceBuilder, Pricing, DuffelOffer, Currency } from "./ports";

@Injectable()
export class SimplePriceBuilder implements PriceBuilder {
  async build(input: {
    offer: DuffelOffer;
    addons?: any;
    currency?: Currency;
    customerId: string;
  }): Promise<Pricing> {
    const currency = input.offer.total_currency as Currency;
    const lines = [
      { code: "flight", amount: input.offer.total_amount, currency },
      // v1: beispielhaft 5% platform fee
      {
        code: "platform_fee",
        amount: (Number(input.offer.total_amount) * 0.05).toFixed(2),
        currency,
      },
      // v1: payment fee pauschal
      { code: "payment_fee", amount: "2.00", currency },
      // ground/courier können hier addiert werden, wenn benötigt
    ];
    const total = lines.reduce((sum, l) => sum + Number(l.amount), 0);
    return {
      currency,
      lines,
      total: { amount: total.toFixed(2), currency },
      flightAmount: { amount: input.offer.total_amount, currency },
    };
  }
}

// src/orders/duffel.adapter.ts
import { Injectable, HttpException } from "@nestjs/common";
import {
  DuffelOrdersPort,
  DuffelOffer,
  DuffelOrder,
  PassengerDto,
  Currency,
} from "./ports";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";

@Injectable()
export class DuffelAdapter implements DuffelOrdersPort {
  constructor(private readonly http: HttpService) {}

  async getOffer(offerId: string): Promise<DuffelOffer> {
    const { data } = await firstValueFrom(this.http.get(`/offers/${offerId}`));
    return data?.data ?? data;
  }

  async createInstantOrder(params: {
    offerId: string;
    passengers: PassengerDto[];
    payments: [{ type: "balance"; amount: string; currency: Currency }];
    idempotencyKey: string;
  }): Promise<DuffelOrder> {
    const body = {
      data: {
        type: "instant",
        selected_offers: [params.offerId],
        passengers: params.passengers,
        payments: params.payments,
      },
    };
    try {
      const { data } = await firstValueFrom(
        this.http.post(`/orders`, body, {
          headers: { "Idempotency-Key": params.idempotencyKey },
        })
      );
      return data?.data ?? data;
    } catch (err: any) {
      throw new HttpException(
        err?.response?.data ?? err?.message ?? "Duffel error",
        err?.response?.status ?? 502
      );
    }
  }
}

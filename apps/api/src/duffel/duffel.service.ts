// apps/api/src/duffel/duffel.service.ts
import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
} from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";

@Injectable()
export class DuffelService {
  constructor(private readonly http: HttpService) {}

  async getOrder(orderId: string) {
    try {
      const { data } = await firstValueFrom(
        this.http.get(`/orders/${orderId}`)
      );
      return data?.data ?? data;
    } catch (e: any) {
      throw new BadRequestException(
        `Duffel order fetch failed: ${e?.message ?? "unknown"}`
      );
    }
  }

  async createPayment(params: {
    order_id: string;
    amount: string; // "156.42"
    currency: string; // "EUR"
    idempotencyKey: string;
  }) {
    try {
      const { data } = await firstValueFrom(
        this.http.post(
          `/payments`,
          {
            data: {
              order_id: params.order_id,
              amount: params.amount,
              currency: params.currency.toUpperCase(),
            },
          },
          { headers: { "Idempotency-Key": params.idempotencyKey } }
        )
      );
      return data?.data ?? data;
    } catch (e: any) {
      if (e?.response?.status === 400) {
        throw new BadRequestException(e?.response?.data ?? "Duffel 400");
      }
      throw new InternalServerErrorException(
        `Duffel payment failed: ${e?.message ?? "unknown"}`
      );
    }
  }
}

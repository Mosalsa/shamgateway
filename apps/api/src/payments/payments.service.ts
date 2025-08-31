// apps/api/src/payments/payments.service.ts
import { Injectable, HttpException } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import { CreatePaymentDto } from "./dto/create-payment.dto";

@Injectable()
export class PaymentsService {
  constructor(private readonly http: HttpService) {}

  async create(dto: CreatePaymentDto) {
    const body = { data: dto };
    try {
      const { data } = await firstValueFrom(this.http.post("/payments", body));
      return data?.data ?? data;
    } catch (err: any) {
      throw new HttpException(
        err?.response?.data ?? err?.message ?? "Unknown error",
        err?.response?.status ?? 500
      );
    }
  }
}

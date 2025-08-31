// apps/api/src/orders/orders.service.ts
import { Injectable, HttpException, BadRequestException } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { PrismaService } from "../../prisma/prisma.service";
import { firstValueFrom } from "rxjs";
import { CreateOrderDto } from "./dto/create-order.dto";
import { CancelOrderDto } from "./dto/cancel-order.dto";
import { RefundOrderDto } from "./dto/refund-order.dto";
import { randomBytes } from "crypto";

@Injectable()
export class OrdersService {
  constructor(
    private readonly http: HttpService,
    private readonly prisma: PrismaService
  ) {}

  // ---- Create Order ----
  async create(dto: CreateOrderDto, currentUserId: string) {
    const body = {
      data: {
        selected_offers: [dto.offerId],
        passengers: dto.passengers.map((p) => ({
          id: p.id,
          type: p.type,
          gender: p.gender,
          title: p.title,
          given_name: p.given_name,
          family_name: p.family_name,
          born_on: p.born_on,
          email: p.email,
          phone_number: p.phone_number,
        })),
        payments: dto.payments.map((pay) => ({
          type: pay.type,
          currency: pay.currency,
          amount: pay.amount,
        })),
      },
    };

    const idem = randomBytes(16).toString("hex");
    try {
      const { data } = await firstValueFrom(
        this.http.post("/orders", body, {
          headers: { "Idempotency-Key": idem },
        })
      );
      const order = data?.data;
      if (!order?.id)
        throw new BadRequestException("Duffel did not return an order");

      // Persist order meta (dein bestehendes Order-Model)
      await this.prisma.order.upsert({
        where: { duffelId: order.id },
        update: {
          status: order.status ?? null,
          amount: order.total_amount,
          currency: order.total_currency,
          owner: order.owner?.iata_code ?? order.owner?.name ?? null,
          liveMode: !!order.live_mode,
        },
        create: {
          duffelId: order.id,
          offerId: dto.offerId,
          userId: currentUserId,
          status: order.status ?? null,
          amount: order.total_amount,
          currency: order.total_currency,
          owner: order.owner?.iata_code ?? order.owner?.name ?? null,
          liveMode: !!order.live_mode,
        },
      });

      return {
        order_id: order.id,
        status: order.status ?? order.booking_conditions?.status ?? "unknown",
        total_amount: order.total_amount,
        total_currency: order.total_currency,
        owner: order.owner?.iata_code ?? order.owner?.name ?? null,
        live_mode: order.live_mode ?? false,
      };
    } catch (err: any) {
      throw new HttpException(
        err?.response?.data ?? err?.message ?? "Unknown error",
        err?.response?.status ?? 500
      );
    }
  }

  // ---- List my orders (from DB) ----
  async listMine(userId: string) {
    return this.prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  // ---- Get one order from Duffel ----
  async getOne(orderId: string) {
    try {
      const { data } = await firstValueFrom(
        this.http.get(`/orders/${orderId}`)
      );
      return data?.data ?? data;
    } catch (err: any) {
      throw new HttpException(
        err?.response?.data ?? err,
        err?.response?.status ?? 500
      );
    }
  }

  // ---- Cancellation: create quote ----
  async createCancellationQuote(
    orderId: string,
    userId: string,
    reason?: string
  ) {
    try {
      const { data } = await firstValueFrom(
        this.http.post(`/order_cancellations`, {
          data: { order_id: orderId, reason },
        })
      );
      const quote = data?.data ?? data;

      // optional: persist lightweight cancellation meta
      await this.prisma.orderCancellation.upsert({
        where: { duffelCancellationId: quote.id },
        update: {
          refundAmount: quote.refund_amount ?? null,
          refundCurrency: quote.refund_currency ?? null,
          refundTo: quote.refund_to ?? null,
          expiresAt: quote.expires_at ? new Date(quote.expires_at) : null,
          confirmedAt: quote.confirmed_at ? new Date(quote.confirmed_at) : null,
          liveMode: !!quote.live_mode,
        },
        create: {
          duffelCancellationId: quote.id,
          orderDuffelId: orderId,
          refundAmount: quote.refund_amount ?? null,
          refundCurrency: quote.refund_currency ?? null,
          refundTo: quote.refund_to ?? null,
          expiresAt: quote.expires_at ? new Date(quote.expires_at) : null,
          confirmedAt: quote.confirmed_at ? new Date(quote.confirmed_at) : null,
          liveMode: !!quote.live_mode,
        },
      });

      return quote;
    } catch (err: any) {
      throw new HttpException(
        err?.response?.data ?? err,
        err?.response?.status ?? 500
      );
    }
  }

  // ---- Cancellation: confirm ----
  async confirmCancellation(cancellationId: string, userId: string) {
    try {
      const { data } = await firstValueFrom(
        this.http.post(
          `/order_cancellations/${cancellationId}/actions/confirm`,
          { data: {} }
        )
      );
      const confirmed = data?.data ?? data;

      await this.prisma.orderCancellation.update({
        where: { duffelCancellationId: cancellationId },
        data: {
          confirmedAt: confirmed.confirmed_at
            ? new Date(confirmed.confirmed_at)
            : new Date(),
        },
      });

      return confirmed;
    } catch (err: any) {
      throw new HttpException(
        err?.response?.data ?? err,
        err?.response?.status ?? 500
      );
    }
  }

  // ---- simple refund wrapper (optional) ----
  async refund(_dto: RefundOrderDto, orderId: string) {
    // Duffel v2 behandelt Refunds über order_cancellations (Quote + confirm).
    // Diese Methode kann einen 2-Schritt-Wrapper darstellen, falls gewünscht.
    throw new BadRequestException(
      "Use /orders/:id/cancel (quote) then confirm to refund if refundable."
    );
  }
}

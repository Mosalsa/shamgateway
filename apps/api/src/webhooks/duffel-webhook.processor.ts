// apps/api/src/modules/webhooks/duffel-webhook.processor.ts
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { OrdersService } from "../orders/orders.service";
import type { DuffelWebhook, DuffelOrder } from "./duffel.types";

@Injectable()
@Processor("duffel-webhooks")
export class DuffelWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(DuffelWebhookProcessor.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService
  ) {
    super();
  }

  async process(job: any) {
    const ev = job.data as DuffelWebhook;

    // Idempotenz (fallback auf Event-ID)
    const key = ev.idempotency_key
      ? `${ev.type}|${ev.idempotency_key}`
      : `event|${ev.id}`;
    const exists = await this.prisma.processedKey.findUnique({
      where: { key },
    });
    if (exists) return true;

    switch (ev.type) {
      case "order.created": {
        const o = ev.data?.object as DuffelOrder | undefined;
        if (o?.id) {
          await this.upsertOrderMeta(o, ev.type);
        }
        break;
      }

      case "order.airline_initiated_change_detected": {
        const o = (ev.data as any)?.object;
        if (o?.id) await this.orders.persistAirlineChange(o.id, o);
        break;
      }

      case "order_cancellation.created": {
        await this.orders.markCancellation("created", (ev.data as any)?.object);
        break;
      }

      case "order_cancellation.confirmed": {
        await this.orders.markCancellation(
          "confirmed",
          (ev.data as any)?.object
        );
        break;
      }

      case "ping.triggered":
        // no-op
        break;

      default:
        this.logger.debug(`Unhandled Duffel event: ${ev.type}`);
    }

    // mark processed
    await this.prisma.processedKey.create({ data: { key } }).catch(() => {});
    await this.prisma.webhookEvent
      .update({
        where: { id: ev.id },
        data: { processedAt: new Date() },
      })
      .catch(() => {});
    return true;
  }

  private async upsertOrderMeta(o: DuffelOrder, lastEventType: string) {
    await this.prisma.order.upsert({
      where: { duffelId: o.id },
      // create: nur Minimalwerte – i.d.R. existiert Order bereits aus deinem create()
      create: {
        duffelId: o.id,
        offerId: o.offer_id ?? "unknown",
        userId:
          (
            await this.prisma.order.findFirst({
              where: { duffelId: o.id },
              select: { userId: true },
            })
          )?.userId ?? (await this.ensureAnyUser()).id, // Fallback
        status: o.status ?? null,
        amount: o.total_amount ?? "0",
        currency: o.total_currency ?? "USD",
        owner: o.owner?.iata_code ?? o.owner?.name ?? null,
        liveMode: !!o.live_mode,
        lastEventType,
      },
      update: {
        status: o.status ?? undefined,
        amount: o.total_amount ?? undefined,
        currency: o.total_currency ?? undefined,
        owner: o.owner?.iata_code ?? o.owner?.name ?? undefined,
        liveMode: o.live_mode ?? undefined,
        lastEventType,
      },
    });
  }

  // Nur als Fallback – in Produktion bitte entfernen
  private async ensureAnyUser() {
    const u = await this.prisma.user.findFirst();
    if (u) return u;
    return this.prisma.user.create({
      data: {
        email: "system@shamgateway.com",
        password: "N/A",
        role: "ADMIN" as any,
      },
    });
  }
}

// apps/api/src/tickets/eticket-poll.processor.ts
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import { OrdersService } from "../orders/orders.service";

@Injectable()
@Processor("eticket-poll")
export class EticketPollProcessor extends WorkerHost {
  private readonly logger = new Logger(EticketPollProcessor.name);

  constructor(
    private readonly orders: OrdersService,
    private readonly http: HttpService // ⬅️ kommt jetzt aus DuffelHttpModule
  ) {
    super();
  }

  async process(job: any) {
    const raw = String(job?.data?.orderId ?? "");
    const orderId = raw.replace(/^["']+|["']+$/g, "");
    const attempt = Number(job?.data?.attempt ?? 1);

    this.logger.log(
      `➡️ processing job id=${job.id} orderId=${orderId} attempt=${attempt}`
    );

    // 1) Frisch bei Duffel holen (JETZT korrekt konfiguriert)
    let order: any;
    try {
      const resp = await firstValueFrom(this.http.get(`/orders/${orderId}`));
      order = resp?.data?.data ?? resp?.data;
      this.logger.log(
        `status=${order?.status} docs=${order?.documents?.length ?? 0}`
      );
    } catch (e: any) {
      this.logger.error(
        `Duffel GET /orders/${orderId} failed: ${e?.message ?? e}`
      );
    }

    // 2) Tickets persistieren
    const docs = order?.documents ?? [];
    const saved = await this.orders.persistTicketDocuments(orderId, docs);

    if (saved > 0) {
      this.logger.log(`🎟️ E-ticket(s) stored for ${orderId}: ${saved}`);
      try {
        await this.orders.markEticketReady(
          orderId,
          order?.status ?? "confirmed"
        );
      } catch {}
      return true;
    }

    // 3) Retry mit Backoff
    const maxAttempts = 15;
    if (attempt >= maxAttempts) {
      this.logger.warn(`⏭️ giving up after ${attempt} attempts for ${orderId}`);
      return true;
    }
    const delay = Math.min(
      60_000,
      Math.round(5000 * Math.pow(1.6, attempt - 1))
    );
    this.logger.log(`⏳ no tickets yet for ${orderId}, requeue in ${delay}ms`);
    await job.queue.add(
      "poll",
      { orderId, attempt: attempt + 1 },
      {
        jobId: `poll:${orderId}`,
        delay,
        removeOnComplete: true,
        removeOnFail: true,
      }
    );
    return true;
  }
}

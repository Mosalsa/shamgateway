import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import { OrdersService } from "../orders/orders.service"; // <– Pfad ggf. anpassen

@Injectable()
@Processor("eticket-poll")
export class EticketPollProcessor extends WorkerHost {
  private readonly logger = new Logger(EticketPollProcessor.name);

  constructor(
    private readonly orders: OrdersService, // wir nutzen die Persist-Helper unten
    private readonly http: HttpService // kommt aus DuffelHttpModule
  ) {
    super();
    this.logger.log("🔥 EticketPollProcessor constructed");
  }

  async process(job: any) {
    const raw = String(job?.data?.orderId ?? "");
    const orderId = raw.replace(/^["']+|["']+$/g, ""); // evtl. Quotes entfernen
    const attempt = Number(job?.data?.attempt ?? 1);

    this.logger.log(
      `➡️ processing job id=${job.id} orderId=${orderId} attempt=${attempt}`
    );

    // 1) Order frisch von Duffel holen
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

    // 2) Tickets persistieren (auch URL nachtragen, wenn später vorhanden)
    const docs = order?.documents ?? [];
    const saved = await this.orders.persistTicketDocuments(orderId, docs);

    if (saved > 0) {
      this.logger.log(`🎟️ E-ticket(s) stored for ${orderId}: ${saved}`);
      // Order-Status in DB aktualisieren (bereit)
      try {
        await this.orders.markEticketReady(
          orderId,
          order?.status ?? "confirmed"
        );
      } catch {}
      return true;
    }

    // 3) Retry mit Backoff, bis URL/Docs da sind
    const maxAttempts = 15; // ~10–15 Minuten
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
      { delay, removeOnComplete: true, removeOnFail: true }
    );
    return true;
  }
}

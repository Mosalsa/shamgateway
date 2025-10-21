// apps/api/src/modules/webhooks/duffel-webhook.module.ts
import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { HttpModule } from "@nestjs/axios";

import { DuffelWebhookController } from "./duffel-webhook.controller";
import { DuffelWebhookService } from "./duffel-webhook.service";
import { DuffelWebhookProcessor } from "./duffel-webhook.processor";
import { EticketPollProcessor } from "../tickets/eticket-poll.processor"; // <- falls bei dir hier liegt
import { PrismaService } from "../../prisma/prisma.service";
import { OrdersModule } from "../orders/orders.module"; // damit Processor OrdersService nutzen kann

@Module({
  imports: [
    // ⬇️ mehrere Queues so registrieren:
    BullModule.registerQueue(
      {
        name: "duffel-webhooks",
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: "exponential", delay: 2000 },
        },
      },
      {
        name: "eticket-poll",
        defaultJobOptions: {
          attempts: 30,
          backoff: { type: "exponential", delay: 5000 },
        },
      }
    ),

    // HttpService für Duffel-Calls im Processor (optional, wenn du ihn dort nutzt)
    HttpModule.register({
      baseURL: "https://api.duffel.com/air",
      headers: {
        "Duffel-Version": process.env.DUFFEL_VERSION ?? "v2",
        Authorization: `Bearer ${process.env.DUFFEL_TOKEN ?? ""}`,
      },
      timeout: 15000,
    }),

    // damit der Processor auf OrdersService zugreifen kann
    OrdersModule,
  ],
  controllers: [DuffelWebhookController],
  providers: [
    PrismaService,
    DuffelWebhookService,
    DuffelWebhookProcessor,
    EticketPollProcessor, // ⬅️ nicht vergessen
  ],
})
export class DuffelWebhookModule {}

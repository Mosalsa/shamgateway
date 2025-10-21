// apps/api/src/orders/orders.module.ts
import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";
import { EticketPollProcessor } from "../tickets/eticket-poll.processor";
import { DuffelHttpModule } from "../common/duffel-http.module";
import { PrismaModule } from "../../prisma/prisma.module";

@Module({
  imports: [
    // Queue, die der Controller (@InjectQueue('eticket-poll')) und der Worker nutzen
    BullModule.registerQueue({
      name: "eticket-poll",
      defaultJobOptions: {
        attempts: 15, // mehr Geduld bis Tickets da sind
        backoff: { type: "exponential", delay: 5_000 }, // 5s, 8s, 13s, ... capped durch deinen Worker
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    }),

    // HTTP-Client für Duffel-Aufrufe (der Poller lädt /orders/{id})
    DuffelHttpModule,

    // Prisma (DB-Zugriff für Controller/Service/Worker)
    PrismaModule,
  ],

  controllers: [OrdersController],

  providers: [
    OrdersService,
    EticketPollProcessor, // ⬅️ registriert den BullMQ-Worker
  ],

  // OrdersService auch in anderen Modulen nutzbar
  exports: [OrdersService],
})
export class OrdersModule {}

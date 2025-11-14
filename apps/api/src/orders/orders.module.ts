// apps/api/src/orders/orders.module.ts
import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { DuffelHttpModule } from "../common/duffel-http.module";
import { PaymentsModule } from "../payments/payments.module";
import { EticketPollProcessor } from "../tickets/eticket-poll.processor";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";

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
    PrismaModule,
    PaymentsModule,
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

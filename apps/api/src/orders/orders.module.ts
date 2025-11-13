// apps/api/src/orders/orders.module.ts
import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { OrdersController } from "./orders.controller";
import { TravelOrderController } from "./travel-order.controller";
import { TravelOrderService } from "./travel-order.service";
import { OrdersService } from "./orders.service";
import { EticketPollProcessor } from "../tickets/eticket-poll.processor";
import { DuffelHttpModule } from "../common/duffel-http.module";
import { PrismaModule } from "../../prisma/prisma.module";
import { PaymentsModule } from "../payments/payments.module";
import { DuffelAdapter } from "./duffel.adapter";
import { PaymentsAdapter } from "./payments.adapter";
import { SimplePriceBuilder } from "./price-builder.service";
import { RepoPrismaAdapter } from "./repo-prisma.adapter";
import { TicketsQueueBull } from "./tickets.queue";

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

  controllers: [OrdersController, TravelOrderController],

  providers: [
    OrdersService,
    TravelOrderService,
    { provide: "PaymentsPort", useClass: PaymentsAdapter },
    { provide: "DuffelOrdersPort", useClass: DuffelAdapter },
    { provide: "PriceBuilder", useClass: SimplePriceBuilder },
    { provide: "TravelOrderRepo", useClass: RepoPrismaAdapter },
    { provide: "TicketsQueue", useClass: TicketsQueueBull },
    EticketPollProcessor, // ⬅️ registriert den BullMQ-Worker
  ],

  // OrdersService auch in anderen Modulen nutzbar
  exports: [OrdersService, TravelOrderService],
})
export class OrdersModule {}

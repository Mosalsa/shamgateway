// apps/api/src/tickets/tickets.module.ts
import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { HttpModule } from "@nestjs/axios";
import { EticketPollProcessor } from "./eticket-poll.processor";
import { OrdersModule } from "../orders/orders.module";

@Module({
  imports: [
    BullModule.registerQueue({ name: "eticket-poll" }),
    HttpModule, // Poller lädt /orders/{id} bei Duffel
    OrdersModule, // persistTicketDocuments()
  ],
  providers: [EticketPollProcessor],
})
export class TicketsModule {}

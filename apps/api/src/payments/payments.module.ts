// apps/api/src/payments/payments.module.ts
import { Module, MiddlewareConsumer, NestModule } from "@nestjs/common";
import { raw } from "body-parser";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { DuffelModule } from "../duffel/duffel.module";
import { BullModule } from "@nestjs/bullmq";
import { PrismaModule } from "../../prisma/prisma.module";

@Module({
  imports: [
    DuffelModule,
    BullModule.registerQueue({ name: "eticket-poll" }),
    PrismaModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(raw({ type: "*/*" })).forRoutes("payments/webhook/stripe");
  }
}

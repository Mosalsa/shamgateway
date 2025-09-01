// apps/api/src/payments/payments.module.ts
import { Module, MiddlewareConsumer, NestModule } from "@nestjs/common";
import { raw } from "body-parser";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { DuffelModule } from "../duffel/duffel.module";

@Module({
  imports: [DuffelModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(raw({ type: "*/*" })).forRoutes("payments/webhook/stripe");
  }
}

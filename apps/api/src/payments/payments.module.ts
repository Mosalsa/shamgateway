// // apps/api/src/payments/payments.module.ts
// import { Module } from "@nestjs/common";
// import { ConfigModule } from "@nestjs/config";
// import { PaymentsService } from "./payments.service";
// import { PaymentsController } from "./payments.controller";
// import { DuffelHttpModule } from "../common/duffel-http.module";

// @Module({
//   imports: [ConfigModule.forRoot({ isGlobal: true }), DuffelHttpModule],
//   controllers: [PaymentsController],
//   providers: [PaymentsService],
// })
// export class PaymentsModule {}

// apps/api/src/payments/payments.module.ts
import { Module, NestModule, MiddlewareConsumer } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { HttpModule } from "@nestjs/axios";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";

import { DuffelModule } from "../duffel/duffel.module";
import { raw } from "express";

@Module({
  imports: [DuffelModule, ConfigModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Stripe Webhook braucht den unveränderten Raw-Body
    consumer.apply(raw({ type: "*/*" })).forRoutes("payments/webhook/stripe");
  }
}

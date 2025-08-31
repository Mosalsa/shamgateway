// apps/api/src/payments/payments.module.ts
import { Module } from "@nestjs/common";
import { PaymentsService } from "./payments.service";
import { PaymentsController } from "./payments.controller";
import { DuffelHttpModule } from "../common/duffel-http.module";

@Module({
  imports: [DuffelHttpModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}

// apps/api/src/bookings/bookings.module.ts
import { Module } from "@nestjs/common";
import { OrdersModule } from "../orders/orders.module";
import { PaymentsModule } from "../payments/payments.module";
import { PrismaModule } from "../../prisma/prisma.module";
import { BookingsService } from "./bookings.service";
import { BookingsController } from "./bookings.controller";

@Module({
  imports: [OrdersModule, PaymentsModule, PrismaModule],
  providers: [BookingsService],
  controllers: [BookingsController],
})
export class BookingsModule {}

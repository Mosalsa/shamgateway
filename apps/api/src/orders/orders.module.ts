// apps/api/src/orders/orders.module.ts
import { Module } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { OrdersController } from "./orders.controller";
import { DuffelHttpModule } from "../common/duffel-http.module";
import { PrismaModule } from "../../prisma/prisma.module";

@Module({
  imports: [DuffelHttpModule, PrismaModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}

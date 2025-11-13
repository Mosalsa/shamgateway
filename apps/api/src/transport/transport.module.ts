import { Module } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { ProvidersController } from "./providers.controller";
import { ProvidersService } from "./providers.service";
import { RoutesController } from "./routes.controller";
import { RoutesService } from "./routes.service";
import { TransportOrdersController } from "./transport-orders.controller";
import { TransportOrdersService } from "./transport-orders.service";

@Module({
  controllers: [
    ProvidersController,
    RoutesController,
    TransportOrdersController,
  ],
  providers: [
    PrismaService,
    ProvidersService,
    RoutesService,
    TransportOrdersService,
  ],
  exports: [TransportOrdersService],
})
export class TransportModule {}

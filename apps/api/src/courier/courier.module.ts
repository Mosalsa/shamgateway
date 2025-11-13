import { Module } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CourierOrdersController } from "./courier-orders.controller";
import { CourierOrdersService } from "./courier-orders.service";
import { ItemsController } from "./items.controller";
import { ItemsService } from "./items.service";
import { TripsController } from "./trips.controller";
import { TripsService } from "./trips.service";
import { MatchesController } from "./matches.controller";
import { MatchesService } from "./matches.service";

@Module({
  controllers: [
    CourierOrdersController,
    ItemsController,
    TripsController,
    MatchesController,
  ],
  providers: [
    PrismaService,
    CourierOrdersService,
    ItemsService,
    TripsService,
    MatchesService,
  ],
  exports: [CourierOrdersService, MatchesService],
})
export class CourierModule {}

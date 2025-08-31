// apps/api/src/flights/flights.module.ts
import { Module } from "@nestjs/common";
import { FlightsService } from "./flights.service";
import { FlightsController } from "./flights.controller";
import { DuffelHttpModule } from "../common/duffel-http.module";

@Module({
  imports: [DuffelHttpModule],
  controllers: [FlightsController],
  providers: [FlightsService],
  exports: [FlightsService],
})
export class FlightsModule {}

// apps/api/src/duffel/duffel.module.ts  (NEU)
import { Module } from "@nestjs/common";
import { DuffelHttpModule } from "./duffel-http.module";
import { DuffelService } from "./duffel.service";

@Module({
  imports: [DuffelHttpModule],
  providers: [DuffelService],
  exports: [DuffelService], // <— WICHTIG: exportieren!
})
export class DuffelModule {}

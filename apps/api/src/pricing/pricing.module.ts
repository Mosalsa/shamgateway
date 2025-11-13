import { Module } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { PricingController } from "./pricing.controller";
import { PricingService } from "./pricing.service";

@Module({
  controllers: [PricingController],
  providers: [PrismaService, PricingService],
  exports: [PricingService],
})
export class PricingModule {}

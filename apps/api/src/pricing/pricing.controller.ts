import { Body, Controller, Post } from "@nestjs/common";
import { PricingService } from "./pricing.service";
import { BuildQuoteDto } from "./dto/build-quote.dto";
import { CreatePaymentIntentDto } from "./dto/create-payment-intent.dto";

@Controller("pricing")
export class PricingController {
  constructor(private svc: PricingService) {}

  @Post("quote")
  buildQuote(@Body() dto: BuildQuoteDto) {
    return this.svc.buildQuote(dto as any);
  }

  @Post("create-payment-intent")
  createPI(@Body() dto: CreatePaymentIntentDto) {
    return this.svc.createPaymentIntentFromQuote(dto as any);
  }
}

// apps/api/src/payments/payments.controller.ts
import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  UsePipes,
  ValidationPipe,
  Req,
  BadRequestException,
  Headers,
} from "@nestjs/common";
import type { Request } from "express";
import { PaymentsService } from "./payments.service";
import { CreateIntentDto } from "./dto/create-intent.dto";
import { RefundOrderDto } from "../orders/dto/refund-order.dto";
@Controller("payments")
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post("intents")
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  createIntent(@Body() dto: CreateIntentDto) {
    return this.payments.createIntent(dto);
  }

  @Post("intents/order/:orderId")
  createIntentForOrder(@Param("orderId") orderId: string) {
    return this.payments.createIntentForOrder(orderId);
  }

  @Post("refund/:orderId")
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async refundOrder(
    @Param("orderId") orderId: string,
    @Body() dto: RefundOrderDto
  ) {
    return this.payments.refundOrder(orderId, dto);
  }

  @Post("webhook/stripe")
  @HttpCode(200)
  async stripeWebhook(
    @Req() req: Request,
    @Headers("stripe-signature") sig?: string | string[]
  ) {
    const raw = (req as any).rawBody ?? (req as any).body;

    if (!raw || !(raw instanceof Buffer)) {
      throw new BadRequestException(
        "Missing raw Buffer body. Ensure express.raw({ type: '*/*' }) is bound to /payments/webhook/stripe BEFORE express.json()."
      );
    }
    const signature = Array.isArray(sig) ? sig[0] : sig;
    return this.payments.handleWebhook(raw, signature ?? "");
  }

  // NEU: Teilrefund (Stripe-only) – kein Duffel-Cancel
  @Post("refund/stripe/:orderId")
  @HttpCode(200)
  async refundStripePartial(
    @Param("orderId") orderId: string,
    @Body() body: { amount: string; currency: string; reason?: string }
  ) {
    return this.payments.refundStripePartial(orderId, body);
  }
}

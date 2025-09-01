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

  @Post("webhook/stripe")
  @HttpCode(200)
  async stripeWebhook(
    @Req() req: Request,
    @Headers("stripe-signature") sig?: string | string[]
  ) {
    // express.raw() setzt den Body unter req.body (Buffer)
    const raw =
      (req as any).rawBody ?? // falls du irgendwo rawBody setzt
      (req as any).body; // <- Buffer von express.raw()

    if (!raw || !(raw instanceof Buffer)) {
      throw new BadRequestException(
        "Missing raw Buffer body. Ensure express.raw({ type: '*/*' }) is bound to /payments/webhook/stripe BEFORE express.json()."
      );
    }
    const signature = Array.isArray(sig) ? sig[0] : sig;
    return this.payments.handleWebhook(raw, signature ?? "");
  }
}

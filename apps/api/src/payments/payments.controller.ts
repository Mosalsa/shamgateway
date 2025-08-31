// apps/api/src/payments/payments.controller.ts
import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Headers,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
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
    @Body() raw: Buffer,
    @Headers("stripe-signature") signature?: string
  ) {
    // raw-Body kommt durch Middleware als Buffer
    return this.payments.handleWebhook(
      raw as unknown as Buffer,
      signature ?? ""
    );
  }
}

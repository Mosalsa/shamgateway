//src/orders/orders.controller.ts
import { Controller, Post, Body, Req } from "@nestjs/common";
import { TravelOrderService } from "./travel-order.service";
import { CreateTravelOrderDto } from "./ports";

@Controller("travel-orders")
export class TravelOrderController {
  constructor(private readonly svc: TravelOrderService) {}

  @Post("create-and-issue")
  async createAndIssue(@Body() dto: CreateTravelOrderDto, @Req() req: any) {
    const userId = req.user?.id ?? "anon";
    return this.svc.createAndIssue(dto, userId);
  }
}

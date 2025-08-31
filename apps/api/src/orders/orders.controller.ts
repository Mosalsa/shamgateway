// apps/api/src/orders/orders.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { OrdersService } from "./orders.service";
import { CreateOrderDto } from "./dto/create-order.dto";
import { CancelOrderDto } from "./dto/cancel-order.dto";
import { RefundOrderDto } from "./dto/refund-order.dto";

@Controller("orders")
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreateOrderDto, @Req() req: any) {
    const userId = req?.user?.id;
    return this.ordersService.create(dto, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  listMine(@Req() req: any) {
    return this.ordersService.listMine(req.user.id);
  }

  @Get(":id")
  getOne(@Param("id") orderId: string) {
    return this.ordersService.getOne(orderId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(":id/cancel")
  async cancel(
    @Param("id") orderId: string,
    @Body() dto: CancelOrderDto,
    @Req() req: any
  ) {
    const reason = dto?.reason;
    return this.ordersService.createCancellationQuote(
      orderId,
      req.user.id,
      reason
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post(":cancellationId/cancel/confirm")
  async confirm(
    @Param("cancellationId") cancellationId: string,
    @Req() req: any
  ) {
    return this.ordersService.confirmCancellation(cancellationId, req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(":id/refund")
  refund(@Param("id") orderId: string, @Body() dto: RefundOrderDto) {
    return this.ordersService.refund(dto, orderId);
  }
}

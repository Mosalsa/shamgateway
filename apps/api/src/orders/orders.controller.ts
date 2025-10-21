// apps/api/src/orders/orders.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  UseGuards,
  Query,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { OrdersService } from "./orders.service";
import { CreateOrderDto } from "./dto/create-order.dto";
import { CancelOrderDto } from "./dto/cancel-order.dto";
import { RefundOrderDto } from "./dto/refund-order.dto";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { PrismaService } from "../../prisma/prisma.service";
import type { TicketDocument } from "@prisma/client"; // <-- Typ für Tickets

@Controller("orders")
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly prisma: PrismaService, // <-- Prisma injizieren
    @InjectQueue("eticket-poll") private readonly eticketQueue: Queue // <-- Queue per ctor injizieren
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get("duffel")
  listDuffel(@Query("after") after?: string, @Query("limit") limit?: string) {
    const q: any = {};
    if (after) q.after = after;
    if (limit) q.limit = Number(limit);
    return this.ordersService.listDuffelOrders(q);
  }

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
  @Post("cancellations/:cancellationId/confirm")
  confirmCancel(
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

  @Get("cancellations/:cancellationId")
  getCancellation(@Param("cancellationId") cancellationId: string) {
    if (!cancellationId)
      throw new BadRequestException("cancellationId is required");
    return this.ordersService.getCancellation(cancellationId);
  }

  // === E-Tickets abrufen ===
  @Get(":duffelId/etickets")
  async getEtickets(@Param("duffelId") duffelId: string) {
    const order = await this.prisma.order.findUnique({
      where: { duffelId },
      include: { tickets: true },
    });
    if (!order) throw new NotFoundException("Order not found");

    return {
      duffelId,
      status: order.status,
      eticketReady: (order as any).eticketReady ?? order.tickets.length > 0,
      tickets: order.tickets.map((t: TicketDocument) => ({
        type: t.type,
        uniqueId: t.uniqueId,
        url: t.url,
        createdAt: t.createdAt,
      })),
    };
  }

  // === E-Ticket-Refresh jobben ===
  @Post(":duffelId/refresh")
  async refresh(@Param("duffelId") duffelId: string) {
    await this.eticketQueue.add(
      "poll",
      { orderId: duffelId },
      { removeOnComplete: true, removeOnFail: true }
    );
    return { ok: true, queued: true };
  }
}

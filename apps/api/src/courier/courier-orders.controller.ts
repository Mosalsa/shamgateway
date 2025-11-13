import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { CourierOrdersService } from "./courier-orders.service";
import { CourierOrderCreateDto } from "./dto/courier-order-create.dto";
import { CourierOrderUpdateDto } from "./dto/courier-order-update.dto";
import { CourierOrderStatus } from "@prisma/client";

@Controller("courier/orders")
export class CourierOrdersController {
  constructor(private svc: CourierOrdersService) {}

  @Post()
  create(@Body() dto: CourierOrderCreateDto, @Req() req: any) {
    const senderId = req.user?.id ?? dto.senderId;
    if (!senderId) throw new BadRequestException("senderId_required");
    return this.svc.create(dto, senderId);
  }

  @Get()
  list(@Query("status") status: string | undefined, @Req() req: any) {
    const senderId = req.user?.id ?? "anon";
    const enumStatus = status as CourierOrderStatus | undefined;
    if (enumStatus && !Object.values(CourierOrderStatus).includes(enumStatus)) {
      throw new BadRequestException("invalid_status");
    }
    return this.svc.listBySender(senderId, enumStatus);
  }

  @Get(":id") get(@Param("id") id: string) {
    return this.svc.get(id);
  }
  @Patch(":id") upd(
    @Param("id") id: string,
    @Body() dto: CourierOrderUpdateDto
  ) {
    return this.svc.update(id, dto);
  }
  @Delete(":id") del(@Param("id") id: string) {
    return this.svc.cancel(id);
  }
}

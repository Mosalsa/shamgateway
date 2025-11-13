import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { ItemsService } from "./items.service";
import { ItemCreateDto } from "./dto/item-create.dto";
import { ItemUpdateDto } from "./dto/item-update.dto";

@Controller("courier")
export class ItemsController {
  constructor(private svc: ItemsService) {}
  @Post("orders/:id/items") add(
    @Param("id") orderId: string,
    @Body() dto: ItemCreateDto
  ) {
    return this.svc.add(orderId, dto);
  }
  @Get("orders/:id/items") list(@Param("id") orderId: string) {
    return this.svc.list(orderId);
  }
  @Patch("items/:itemId") upd(
    @Param("itemId") itemId: string,
    @Body() dto: ItemUpdateDto
  ) {
    return this.svc.upd(itemId, dto);
  }
  @Delete("items/:itemId") del(@Param("itemId") itemId: string) {
    return this.svc.del(itemId);
  }
}

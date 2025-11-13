import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { ItemCreateDto } from "./dto/item-create.dto";
import { ItemUpdateDto } from "./dto/item-update.dto";

@Injectable()
export class ItemsService {
  constructor(private prisma: PrismaService) {}
  add(orderId: string, dto: ItemCreateDto) {
    return this.prisma.shipmentItem.create({
      data: {
        courierOrderId: orderId,
        title: dto.title,
        description: dto.description,
        fileIds: dto.fileIds ?? [],
        quantity: dto.quantity ?? 1,
        fee: dto.fee ?? "0.00",
        currency: dto.currency ?? "EUR",
      },
    });
  }
  list(orderId: string) {
    return this.prisma.shipmentItem.findMany({
      where: { courierOrderId: orderId },
    });
  }
  upd(itemId: string, dto: ItemUpdateDto) {
    return this.prisma.shipmentItem.update({
      where: { id: itemId },
      data: dto,
    });
  }
  del(itemId: string) {
    return this.prisma.shipmentItem.delete({ where: { id: itemId } });
  }
}

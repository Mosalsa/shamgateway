import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CourierOrderCreateDto } from "./dto/courier-order-create.dto";
import { CourierOrderUpdateDto } from "./dto/courier-order-update.dto";
import { CourierOrderStatus } from "@prisma/client";
import { BadRequestException, NotFoundException } from "@nestjs/common";
@Injectable()
export class CourierOrdersService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CourierOrderCreateDto, senderId: string) {
    // 1) Existenzen prüfen → sauberer 404/400 statt P2003
    const [sender, recipient] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: senderId } }),
      this.prisma.user.findUnique({ where: { id: dto.recipientId } }),
    ]);
    if (!sender) throw new NotFoundException("sender_not_found");
    if (!recipient) throw new NotFoundException("recipient_not_found");

    // 2) Optional: gleiche Route/Datum? (kleiner sanity check)
    if (!dto.routeFrom || !dto.routeTo) {
      throw new BadRequestException("route_from_to_required");
    }

    // 3) Anlegen
    return this.prisma.courierOrder.create({
      data: {
        senderId,
        recipientId: dto.recipientId,
        recipientTravelOrderId: dto.recipientTravelOrderId ?? null,
        recipientName: dto.recipientName ?? recipient.firstName ?? null,
        recipientPhone: dto.recipientPhone ?? null,
        recipientCity: dto.recipientCity ?? null,
        routeFrom: dto.routeFrom,
        routeTo: dto.routeTo,
        desiredDate: new Date(dto.desiredDate),
        itemType: dto.itemType,
        weightKg: dto.weightKg ?? 0,
        declaredValue: dto.declaredValue ?? null,
        notes: dto.notes ?? null,
        status: "open",
        price: dto.price ?? "0.00",
        currency: dto.currency ?? "EUR",
      },
    });
  }

  listBySender(senderId: string, status?: CourierOrderStatus) {
    return this.prisma.courierOrder.findMany({
      where: { senderId, ...(status ? { status } : {}) },
      include: { items: true },
      orderBy: { createdAt: "desc" },
    });
  }

  get(id: string) {
    return this.prisma.courierOrder.findUnique({
      where: { id },
      include: { items: true, matches: true },
    });
  }

  update(id: string, dto: CourierOrderUpdateDto) {
    return this.prisma.courierOrder.update({ where: { id }, data: dto });
  }

  cancel(id: string) {
    return this.prisma.courierOrder.update({
      where: { id },
      data: { status: "cancelled" },
    });
  }
}

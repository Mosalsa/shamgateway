import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { MatchCreateDto } from "./dto/match-create.dto";

@Injectable()
export class MatchesService {
  constructor(private prisma: PrismaService) {}
  propose(dto: MatchCreateDto) {
    return this.prisma.courierMatch.create({
      data: {
        courierOrderId: dto.courier_order_id,
        tripId: dto.trip_id,
        status: "proposed",
        price: dto.proposed_price,
        currency: dto.currency,
      },
    });
  }
  async accept(matchId: string) {
    const match = await this.prisma.courierMatch.update({
      where: { id: matchId },
      data: { status: "accepted" },
    });
    // TODO: Escrow (Stripe/ShamCash) erzeugen
    return {
      match_id: match.id,
      pay_with: "shamcash|card",
      amount: match.price,
      currency: match.currency,
    };
  }
  start(matchId: string) {
    return this.prisma.courierMatch.update({
      where: { id: matchId },
      data: { status: "in_transit" },
    });
  }
  delivered(matchId: string) {
    return this.prisma.courierMatch.update({
      where: { id: matchId },
      data: { status: "delivered" },
    });
  }
  cancel(matchId: string) {
    return this.prisma.courierMatch.update({
      where: { id: matchId },
      data: { status: "cancelled" },
    });
  }
}

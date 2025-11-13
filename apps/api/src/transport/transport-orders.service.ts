import { Injectable, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { TransportQuoteDto } from "./dto/quote.dto";
import { TransportReserveDto } from "./dto/reserve.dto";

type PriceModel = {
  base_fixed: string;
  per_km: string;
  per_pax: string;
  per_bag: string;
};

@Injectable()
export class TransportOrdersService {
  constructor(private prisma: PrismaService) {}

  private calcUSD(
    pm: PriceModel,
    km: number,
    pax: number,
    bags: number
  ): string {
    const n = (s: string) => Number(s || "0");
    return (
      n(pm.base_fixed) +
      km * n(pm.per_km) +
      pax * n(pm.per_pax) +
      bags * n(pm.per_bag)
    ).toFixed(2);
  }

  async quote(dto: TransportQuoteDto) {
    const where: any = {
      active: true,
      fromAirport: dto.from_airport,
      toRegion: dto.to_region,
    };
    if (dto.provider_id) where.providerId = dto.provider_id;

    const route = await this.prisma.transportRoute.findFirst({ where });
    if (!route) throw new BadRequestException("route_not_found");
    if (dto.pax_count < route.minPax || dto.pax_count > route.maxPax)
      throw new BadRequestException("pax_not_supported");

    const amount_usd = this.calcUSD(
      route.priceModel as any,
      route.baseKm,
      dto.pax_count,
      dto.bags_count
    );
    return {
      provider_id: route.providerId,
      route_id: route.id,
      amount_usd,
      currency: "USD",
      estimates: true,
    };
  }

  async reserve(dto: TransportReserveDto) {
    const route = await this.prisma.transportRoute.findUnique({
      where: { id: dto.route_id },
    });
    if (!route?.active) throw new BadRequestException("route_inactive");

    const amount_usd = this.calcUSD(
      route.priceModel as any,
      route.baseKm,
      dto.pax_count,
      dto.bags_count
    );
    const gto = await this.prisma.groundTransportOrder.create({
      data: {
        travelOrderId: dto.travel_order_id,
        providerId: route.providerId,
        routeId: route.id,
        status: "reserved",
        reserveId: `res_${Date.now()}`, // TODO: echte Provider-ID
        paxCount: dto.pax_count,
        bagsCount: dto.bags_count,
        fromAirport: dto.from_airport,
        toRegion: dto.to_region,
        dateTimeUTC: new Date(dto.date_time_utc),
        amountUSD: amount_usd,
      },
    });
    return {
      ground_transport_order_id: gto.id,
      status: gto.status,
      reserve_id: gto.reserveId,
    };
  }

  async confirm(ground_transport_order_id: string) {
    const gto = await this.prisma.groundTransportOrder.update({
      where: { id: ground_transport_order_id },
      data: { status: "confirmed" },
    });
    return { status: gto.status };
  }

  async cancel(ground_transport_order_id: string, reason?: string) {
    const gto = await this.prisma.groundTransportOrder.update({
      where: { id: ground_transport_order_id },
      data: { status: "cancelled" },
    });
    // TODO: penalty aus cancelPolicy berechnen
    return { status: gto.status };
  }
}

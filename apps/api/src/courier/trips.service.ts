import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { TripCreateDto } from "./dto/trip-create.dto";
import { TripUpdateDto } from "./dto/trip-update.dto";

@Injectable()
export class TripsService {
  constructor(private prisma: PrismaService) {}
  create(userId: string, dto: TripCreateDto) {
    return this.prisma.courierTrip.create({
      data: {
        userId,
        routeFrom: dto.routeFrom,
        routeTo: dto.routeTo,
        date: new Date(dto.date),
        maxWeightKg: dto.maxWeightKg,
        status: "open",
      },
    });
  }
  list(filter: any) {
    return this.prisma.courierTrip.findMany({
      where: { ...filter, status: "open" },
      orderBy: { date: "asc" },
    });
  }
  update(id: string, dto: TripUpdateDto) {
    return this.prisma.courierTrip.update({ where: { id }, data: dto });
  }
  delete(id: string) {
    return this.prisma.courierTrip.update({
      where: { id },
      data: { status: "closed" },
    });
  }
}

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { RouteCreateDto } from "./dto/route-create.dto";
import { RouteUpdateDto } from "./dto/route-update.dto";

@Injectable()
export class RoutesService {
  constructor(private prisma: PrismaService) {}
  create(providerId: string, dto: RouteCreateDto) {
    return this.prisma.transportRoute.create({ data: { ...dto, providerId } });
  }
  list(providerId: string) {
    return this.prisma.transportRoute.findMany({
      where: { providerId, active: true },
    });
  }
  update(routeId: string, dto: RouteUpdateDto) {
    return this.prisma.transportRoute.update({
      where: { id: routeId },
      data: dto,
    });
  }
  remove(routeId: string) {
    return this.prisma.transportRoute.update({
      where: { id: routeId },
      data: { active: false },
    });
  }
}

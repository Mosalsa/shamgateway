import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { ProviderCreateDto } from "./dto/provider-create.dto";
import { ProviderUpdateDto } from "./dto/provider-update.dto";

@Injectable()
export class ProvidersService {
  constructor(private prisma: PrismaService) {}
  create(dto: ProviderCreateDto) {
    return this.prisma.transportProvider.create({ data: dto });
  }
  list(active?: boolean) {
    return this.prisma.transportProvider.findMany({
      where: active == null ? {} : { active },
    });
  }
  get(id: string) {
    return this.prisma.transportProvider.findUnique({ where: { id } });
  }
  update(id: string, dto: ProviderUpdateDto) {
    return this.prisma.transportProvider.update({ where: { id }, data: dto });
  }
  remove(id: string) {
    return this.prisma.transportProvider.update({
      where: { id },
      data: { active: false },
    });
  }
}

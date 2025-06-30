// apps/api/src/user/user.service.ts
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { UpdateUserDto } from "../auth/dto/update-user.dto";

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  /** für Admin-Übersichten – optional */
  async findAll() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        createdAt: true,
      },
    });
  }

  /** Profil-Abruf ohne Passwort-Hash  */
  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        createdAt: true,
      },
    });
  }
  async update(id: string, dto: UpdateUserDto) {
    return this.prisma.user.update({
      where: { id },
      data: dto,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        birthDate: true,
        role: true,
        updatedAt: true,
      },
    });
  }

  async remove(id: string) {
    await this.prisma.user.delete({ where: { id } });
    return { message: "User deleted" };
  }
}

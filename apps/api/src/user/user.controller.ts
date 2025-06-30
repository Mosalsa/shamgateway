import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { UserService } from "./user.service";
import { Request } from "express";
import { UpdateUserDto } from "src/auth/dto/update-user.dto";
import { UserRole } from "@prisma/client";

@Controller("user")
@UseGuards(JwtAuthGuard, RolesGuard) // global: alle Routen brauchen JWT + Rollenprüfung
export class UserController {
  constructor(private readonly users: UserService) {}

  @Get("profile")
  profile(@Req() req: Request & { user: any }) {
    return this.users.findById(req.user.id); // 👈 wichtig: req.user.id statt .sub
  }

  @Patch(":id")
  @Roles(UserRole.ADMIN) // 👈 Rollenprüfung
  update(@Param("id") id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(id, dto);
  }

  @Delete(":id")
  @Roles(UserRole.ADMIN)
  remove(@Param("id") id: string) {
    return this.users.remove(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN) // Nur Admins dürfen alle Nutzer sehen
  @Get()
  findAll() {
    return this.users.findAll();
  }
}

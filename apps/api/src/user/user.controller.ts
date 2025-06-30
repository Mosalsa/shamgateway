import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { UserService } from "./user.service";
import { Request } from "express";
@Controller("user")
export class UserController {
  constructor(private readonly users: UserService) {}

  @UseGuards(JwtAuthGuard)
  @Get("profile")
  profile(@Req() req: Request & { user: any }) {
    return this.users.findById(req.user.sub);
  }
}

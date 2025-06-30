import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { JwtService } from "@nestjs/jwt";
import { RequestResetDto } from "./dto/request-reset.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly jwtService: JwtService
  ) {}

  @Post("register")
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post("login")
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get("verify-email")
  async verifyEmail(@Query("token") token: string) {
    const user = await this.authService.verifyEmail(token);
    return { message: "Email verified successfully", user };
  }

  @Patch("change-password")
  @UseGuards(JwtAuthGuard)
  changePassword(
    @Req() req: Request & { user: any },
    @Body() dto: ChangePasswordDto
  ) {
    return this.authService.changePassword(req.user.id, dto);
  }

  @Post("refresh")
  refresh(@Body("refreshToken") token: string) {
    return this.authService.refreshTokens(token);
  }

  @Post("logout")
  @UseGuards(JwtAuthGuard)
  logout(@Req() req: Request & { user: any }) {
    return this.authService.logout(req.user.id);
  }
  @Post("request-reset")
  requestReset(@Body() dto: RequestResetDto) {
    return this.authService.requestPasswordReset(dto);
  }

  @Post("reset-password")
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }
}

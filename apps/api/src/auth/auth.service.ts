import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../../prisma/prisma.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { UserRole } from "@prisma/client";
import { randomBytes } from "crypto";

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService
  ) {}

  async register(dto: RegisterDto) {
    const exists = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (exists) throw new ConflictException("User already exists");

    const hashed = await bcrypt.hash(dto.password, 10);
    const verificationToken = randomBytes(32).toString("hex");

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashed,
        role: UserRole.CUSTOMER,
        verificationToken,
        isVerified: false,
      },
    });

    return {
      message:
        "Registration successful. Please check your email to verify your account.",
      verificationUrl: `http://localhost:3000/auth/verify-email?token=${verificationToken}`,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user || !(await bcrypt.compare(dto.password, user.password))) {
      throw new UnauthorizedException("Invalid credentials");
    }

    if (!user.isVerified) {
      throw new UnauthorizedException("Please verify your email first.");
    }

    const tokens = await this.signTokens(user.id, user.email, user.role);
    await this.updateRefreshToken(user.id, tokens.refreshToken);
    return tokens;
  }

  async verifyEmail(token: string) {
    const user = await this.prisma.user.findFirst({
      where: { verificationToken: token },
    });

    if (!user) throw new NotFoundException("Invalid verification token");

    return this.prisma.user.update({
      where: { id: user.id },
      data: {
        isVerified: true,
        verificationToken: null,
      },
    });
  }

  async signTokens(userId: string, email: string, role: UserRole) {
    const payload = { sub: userId, email, role };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, { expiresIn: "15m" }),
      this.jwt.signAsync(payload, { expiresIn: "7d" }),
    ]);

    return { accessToken, refreshToken };
  }

  async updateRefreshToken(userId: string, refreshToken: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken },
    });
  }

  async refreshTokens(refreshToken: string) {
    try {
      const payload = await this.jwt.verifyAsync(refreshToken, {
        secret: process.env.JWT_SECRET,
      });

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user || user.refreshToken !== refreshToken) {
        throw new UnauthorizedException("Invalid refresh token");
      }

      const tokens = await this.signTokens(user.id, user.email, user.role);
      await this.updateRefreshToken(user.id, tokens.refreshToken);
      return tokens;
    } catch (e) {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !(await bcrypt.compare(dto.oldPwd, user.password))) {
      throw new UnauthorizedException("Wrong password");
    }

    const hashed = await bcrypt.hash(dto.newPwd, 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed },
    });

    return { message: "Password updated successfully" };
  }

  async logout(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });

    return { message: "Logged out successfully" };
  }
}

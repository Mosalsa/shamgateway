import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { UserRole } from "@prisma/client";

interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET!, // stelle sicher, dass .env das enthält
    });
  }

  validate(payload: JwtPayload) {
    // wird als req.user verfügbar
    return { id: payload.sub, email: payload.email, role: payload.role };
  }
}

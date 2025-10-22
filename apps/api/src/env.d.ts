// apps/api/src/env.d.ts
declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * Akzeptiert ms-Notation wie '15m', '1h', '30s', '2d', etc.
     * (passt zum StringValue-Typ von @nestjs/jwt)
     */
    JWT_EXPIRES_IN?: `${number}${"ms" | "s" | "m" | "h" | "d"}`;
  }
}

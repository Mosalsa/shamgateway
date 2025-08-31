// apps/api/src/duffel/duffel-http.module.ts
import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";

@Module({
  imports: [
    HttpModule.registerAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        const base = (
          cfg.get<string>("DUFFEL_API_URL") || "https://api.duffel.com"
        ).replace(/\/$/, "");
        const token = cfg.get<string>("DUFFEL_API_KEY");
        const version = cfg.get<string>("DUFFEL_VERSION") || "v2";

        if (!token) {
          console.warn(
            "[DuffelHttp] DUFFEL_API_KEY fehlt! Requests werden 401 liefern."
          );
        }

        return {
          baseURL: `${base}/air`, // wichtig
          headers: {
            Authorization: `Bearer ${token}`,
            "Duffel-Version": version, // bei v2 passt das
            "Content-Type": "application/json",
          },
          timeout: 15000,
          maxRedirects: 3,
        };
      },
    }),
  ],
  exports: [HttpModule],
})
export class DuffelHttpModule {}

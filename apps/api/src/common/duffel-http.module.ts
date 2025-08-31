import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";

@Module({
  imports: [
    // ConfigModule ist global, daher reicht hier inject + useFactory
    HttpModule.registerAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        const base = (
          cfg.get<string>("DUFFEL_API_URL") || "https://api.duffel.com"
        ).replace(/\/$/, "");
        const token = cfg.get<string>("DUFFEL_API_KEY");
        const version = cfg.get<string>("DUFFEL_VERSION") || "v2";

        if (!token) {
          // Hilfreich beim lokalen Debuggen
          console.warn(
            "[DuffelHttp] DUFFEL_API_KEY fehlt! Requests werden 401 liefern."
          );
        }

        return {
          // v2-Endpunkte liegen unter /air
          baseURL: `${base}/air`,
          headers: {
            Authorization: `Bearer ${token}`,
            "Duffel-Version": version,
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

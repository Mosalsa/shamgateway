import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "../prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { UserModule } from "./user/user.module";
import { FlightsModule } from "./flights/flights.module";
import { OrdersModule } from "./orders/orders.module"; // falls vorhanden
import { PaymentsModule } from "./payments/payments.module";
import { DuffelWebhookModule } from "./webhooks/duffel-webhook.module";
import { BullModule } from "@nestjs/bullmq";

@Module({
  imports: [
    // Global verfügbar machen
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ".env",
    }),
    BullModule.forRoot({
      // nimm die URL direkt, damit es auch ohne @nestjs/config klappt:
      connection: { url: process.env.REDIS_URL || "redis://127.0.0.1:6379" },
    }),
    DuffelWebhookModule,
    PrismaModule,
    AuthModule,
    UserModule,
    FlightsModule,
    OrdersModule,
    PaymentsModule,
  ],
})
export class AppModule {}

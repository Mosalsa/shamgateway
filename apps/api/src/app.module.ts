import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "../prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { UserModule } from "./user/user.module";
import { FlightsModule } from "./flights/flights.module";
import { OrdersModule } from "./orders/orders.module"; // falls vorhanden
import { PaymentsModule } from "./payments/payments.module";
@Module({
  imports: [
    // Global verfügbar machen
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ".env",
    }),
    PrismaModule,
    AuthModule,
    UserModule,
    FlightsModule,
    OrdersModule,
    PaymentsModule,
  ],
})
export class AppModule {}

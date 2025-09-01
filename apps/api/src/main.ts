import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ValidationPipe } from "@nestjs/common";
import * as express from "express";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    })
  );

  // ✅ GENAU der Webhook-Pfad + roher Body NUR für diese Route
  app.use(
    "/payments/webhook/stripe",
    express.raw({ type: "*/*" }) // oder "application/json" – wichtig ist: raw, nicht json()
  );

  // danach für alle anderen Routen normal parsen
  app.use(express.json());

  await app.listen(3000);
}
bootstrap();

import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ValidationPipe } from "@nestjs/common";
import * as express from "express";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // ❗ löscht unbekannte Felder
      forbidNonWhitelisted: true, // (Optional) gibt sogar 400 Fehler zurück
      transform: true,
    })
  );

  // Stripe Webhook braucht rawBody (nur für diesen Endpoint!)
  app.use(
    "/payments/webhook",
    express.raw({ type: "application/json" }) // <- hier kein JSON-Parsing
  );

  // Für alle anderen Endpoints weiterhin normales JSON-Parsing
  app.use(express.json());

  await app.listen(3000);
}
bootstrap();

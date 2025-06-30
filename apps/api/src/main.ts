import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ValidationPipe } from "@nestjs/common";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // ❗ löscht unbekannte Felder
      forbidNonWhitelisted: true, // (Optional) gibt sogar 400 Fehler zurück
      transform: true,
    })
  );

  await app.listen(3000);
}
bootstrap();

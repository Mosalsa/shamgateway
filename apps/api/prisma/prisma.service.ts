import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  // Optional: clean DB for e2e testing
  async cleanDatabase() {
    if (process.env.NODE_ENV === "test") {
      await this.user.deleteMany();
      // Füge hier weitere Entities hinzu, wenn du später z. B. flights, orders etc. hast
    }
  }
}

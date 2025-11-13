// src/orders/repo-prisma.adapter.ts
import { Injectable } from "@nestjs/common";
import { TravelOrderRepo } from "./ports";
// import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RepoPrismaAdapter implements TravelOrderRepo {
  // constructor(private readonly prisma: PrismaService) {}
  async upsertTravelOrder(data: any): Promise<void> {
    // await this.prisma.travelOrder.upsert({ where:{ idempotencyKey: data.idempotencyKey }, create: data, update: data });
    return;
  }
  async saveDuffelOrderSnapshot(order: any): Promise<void> {
    // await this.prisma.ordersAir.upsert({ where:{ duffelId: order.id }, create:{...}, update:{...} });
    return;
  }
  async markState(idemKey: string, state: string, patch?: any): Promise<void> {
    // await this.prisma.travelOrder.update({ where:{ idempotencyKey: idemKey }, data: { state, ...patch } });
    return;
  }
}

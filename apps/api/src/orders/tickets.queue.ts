// src/orders/tickets.queue.ts
import { Injectable } from "@nestjs/common";
import { TicketsQueue } from "./ports";

@Injectable()
export class TicketsQueueBull implements TicketsQueue {
  async enqueueEticketPoll(orderId: string): Promise<void> {
    // this.queue.add('poll', { orderId }, { jobId:`poll-${orderId}`, delay:3000, removeOnComplete:true, removeOnFail:true });
    return;
  }
}

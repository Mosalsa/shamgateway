// apps/api/src/orders/dto/cancel-order.dto.ts
import { IsOptional, IsString } from "class-validator";

export class CancelOrderDto {
  @IsString() order_id!: string; // ord_...
  @IsOptional() @IsString() reason?: string;
}

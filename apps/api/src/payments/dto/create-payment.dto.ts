// apps/api/src/payments/dto/create-payment.dto.ts
import { IsIn, IsString } from "class-validator";

export class CreatePaymentDto {
  @IsString() order_id!: string; // ord_...
  @IsIn(["balance", "card", "arc_bsp_cash"]) type!:
    | "balance"
    | "card"
    | "arc_bsp_cash";
  @IsString() currency!: string; // e.g. "EUR"
  @IsString() amount!: string; // e.g. "149.00"
}

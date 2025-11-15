// apps/api/src/payments/dto/create-checkout.dto.ts
// apps/api/src/payments/dto/create-checkout.dto.ts
import { IsNumber, IsOptional, IsString, Min } from "class-validator";

export class CreateCheckoutDto {
  @IsString()
  orderId!: string; // Duffel/DB Order-ID (duffelId)

  @IsNumber()
  @Min(0)
  amount!: number; // z.B. 175.13 (Customer total incl. fees)

  @IsString()
  currency!: string; // "EUR"

  @IsOptional()
  @IsString()
  description?: string; // optional: "FRA → AMM 1 pax"
}

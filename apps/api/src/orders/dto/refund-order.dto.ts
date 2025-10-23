import { IsOptional, IsString, Matches, Length } from "class-validator";

export class RefundOrderDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d+)?$/) // "156.42"
  amount?: string;

  @IsOptional()
  @IsString()
  @Length(3, 3) // ISO 4217
  currency?: string;

  @IsOptional()
  @IsString()
  reason?: string; // z.B. "customer_refund"
}

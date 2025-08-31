// apps/api/src/payments/dto/create-intent.dto.ts
import { IsOptional, IsString, Matches, Length } from "class-validator";

export class CreateIntentDto {
  @IsString()
  @Matches(/^\d+(\.\d+)?$/) // "156.42"
  amount!: string;

  @IsString()
  @Length(3, 3) // ISO 4217
  currency!: string;

  @IsOptional()
  @IsString()
  order_id?: string;

  @IsOptional()
  @IsString()
  user_id?: string;
}

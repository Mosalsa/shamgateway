// apps/api/src/orders/dto/create-order.dto.ts
import {
  IsArray,
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class PassengerDto {
  @IsString() id!: string; // pas_... from offer request
  @IsIn(["adult", "child", "infant_without_seat", "young_adult"]) type!:
    | "adult"
    | "child"
    | "infant_without_seat"
    | "young_adult";
  @IsIn(["mr", "mrs", "ms"]) title!: "mr" | "mrs" | "ms";
  @IsString() @Length(1, 50) given_name!: string;
  @IsString() @Length(1, 50) family_name!: string;
  @IsDateString() born_on!: string;
  @IsIn(["m", "f"]) gender!: "m" | "f";
  @IsOptional() @IsEmail() email?: string;
  @IsOptional()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: "Use E.164 format, e.g., +4915123456789",
  })
  phone_number?: string;
}

export class PaymentDto {
  @IsIn(["balance", "card", "arc_bsp_cash"]) type!:
    | "balance"
    | "card"
    | "arc_bsp_cash";
  @IsString() currency!: string;
  @IsString() amount!: string;
}

export class CreateOrderDto {
  @IsString() offerId!: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PassengerDto)
  passengers!: PassengerDto[];
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentDto)
  payments!: PaymentDto[];
}

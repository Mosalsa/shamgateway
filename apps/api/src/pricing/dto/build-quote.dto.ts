import {
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

class GroundInputDto {
  @IsString() route_id!: string;
  @IsInt() pax!: number;
  @IsInt() bags!: number;
  @IsOptional() @IsISO8601() date_time_utc?: string;
}

export class BuildQuoteDto {
  @IsString() offer_id!: string; // Duffel Offer ID

  @ValidateNested()
  @Type(() => GroundInputDto)
  ground!: GroundInputDto;

  @IsIn(["EUR", "USD", "SYP"]) currency!: "EUR" | "USD" | "SYP";
  @IsIn(["card", "shamcash"]) pay_method!: "card" | "shamcash";
}

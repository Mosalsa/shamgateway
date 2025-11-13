import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsObject,
} from "class-validator";

export class RouteCreateDto {
  @IsString() fromAirport!: string; // 'BEY' | 'AMM' | ...
  @IsString() toRegion!: string; // 'Damascus' | ...
  @IsInt() baseKm!: number;
  @IsInt() leadTimeHours!: number;
  @IsInt() minPax!: number;
  @IsInt() maxPax!: number;

  @IsObject() priceModel!: { [k: string]: string }; // { base_fixed, per_km, per_pax, per_bag }
  @IsOptional() @IsObject() cancelPolicy?: { [k: string]: any }; // { free_until_h, penalty_fixed }

  @IsOptional() @IsBoolean() active?: boolean;
}

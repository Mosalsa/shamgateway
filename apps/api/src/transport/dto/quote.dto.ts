import { IsISO8601, IsInt, IsOptional, IsString } from "class-validator";
export class TransportQuoteDto {
  @IsString() from_airport!: string;
  @IsString() to_region!: string;
  @IsInt() pax_count!: number;
  @IsInt() bags_count!: number;
  @IsISO8601() date_time_utc!: string;
  @IsOptional() @IsString() provider_id?: string; // optional Vorauswahl
}

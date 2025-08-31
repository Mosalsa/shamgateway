// apps/api/src/flights/dto/search-flights.dto.ts
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from "class-validator";

export class SearchFlightsDto {
  @IsString() origin!: string; // e.g. "FRA"
  @IsString() destination!: string; // e.g. "ALP"
  @IsDateString() departureDate!: string;
  @IsOptional() @IsDateString() returnDate?: string;

  @IsInt() @Min(1) adults!: number;
  @IsOptional() @IsInt() @Min(0) children?: number;
  @IsOptional() @IsInt() @Min(0) infants?: number;

  @IsOptional()
  @IsIn(["economy", "premium_economy", "business", "first"])
  cabinClass?: "economy" | "premium_economy" | "business" | "first";

  @IsOptional()
  @IsInt()
  @Min(0)
  maxConnections?: number;
}

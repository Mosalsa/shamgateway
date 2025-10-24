import {
  IsString,
  IsDateString,
  IsOptional,
  IsInt,
  Min,
  IsIn,
  IsBoolean,
  ValidateNested,
  ArrayMinSize,
  IsArray,
} from "class-validator";
import { Type, Transform } from "class-transformer";

/** Dropdown "Class" */
export type CabinClass = "economy" | "premium_economy" | "business" | "first";

/** UI: One way / Return / Multi-city */
export type JourneyType = "one_way" | "return" | "multi_city";

export class SliceInputDto {
  @IsString() origin!: string;
  @IsString() destination!: string;
  @IsDateString() departureDate!: string; // YYYY-MM-DD
}

export class AdvancedOptionsDto {
  /** Tageszeitfenster (optional) z.B. "morning" / "afternoon" / "evening" / "night" */
  @IsOptional()
  @IsIn(["any", "night", "morning", "afternoon", "evening"])
  departTimeOfDay?: "any" | "night" | "morning" | "afternoon" | "evening" =
    "any";

  /** Max. Umstiege (0 = direkt, 1 = max 1 Stop …) */
  @IsOptional()
  @IsInt()
  @Min(0)
  maxConnections?: number;

  /** Nur bestimmte Carrier erlauben (IATA) */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowCarriers?: string[];

  /** Bestimmte Carrier ausschließen (IATA) */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  blockCarriers?: string[];
}

/** Haupt-DTO für die Suchmaske */
export class SearchFlightsDto {
  // Journey Type
  @IsIn(["one_way", "return", "multi_city"])
  journeyType!: JourneyType;

  // Komfort-Felder (für one_way/return)
  @IsOptional()
  @IsString()
  origin?: string;

  @IsOptional()
  @IsString()
  destination?: string;

  @IsOptional()
  @IsDateString()
  departureDate?: string;

  @IsOptional()
  @IsDateString()
  returnDate?: string; // required when journeyType = "return"

  // Multi-city Eingabe (UI “Add flight”)
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => SliceInputDto)
  @ArrayMinSize(2)
  slices?: SliceInputDto[];

  // Passengers & Class
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  adults: number = 1;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  children?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  infants?: number;

  @IsOptional()
  @IsIn(["economy", "premium_economy", "business", "first"])
  cabinClass?: CabinClass;

  // Advanced
  @IsOptional()
  @ValidateNested()
  @Type(() => AdvancedOptionsDto)
  advanced?: AdvancedOptionsDto;

  // Flag: Sofort Klassifikation der Offers (instant/hold)
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === true || value === "true")
  classify?: boolean = true;
}

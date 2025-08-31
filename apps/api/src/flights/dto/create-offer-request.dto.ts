// apps/api/src/flights/dto/create-offer-request.dto.ts
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class SearchPassengerDto {
  @IsOptional() @IsInt() @Min(0) @Max(120) age?: number;
  @IsOptional()
  @IsIn(["adult", "young_adult", "child", "infant_without_seat"])
  type?: "adult" | "young_adult" | "child" | "infant_without_seat";
  @IsOptional() @IsString() fare_type?: string;
}

export class SliceDto {
  @IsString() origin!: string;
  @IsString() destination!: string;
  @IsDateString() departure_date!: string; // YYYY-MM-DD
}

export class CreateOfferRequestDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SliceDto)
  slices!: SliceDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SearchPassengerDto)
  passengers!: SearchPassengerDto[];

  @IsOptional()
  @IsIn(["first", "business", "premium_economy", "economy"])
  cabin_class?: "first" | "business" | "premium_economy" | "economy";

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2)
  max_connections?: number;
}

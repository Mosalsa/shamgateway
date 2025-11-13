import { IsISO8601, IsNumber, IsOptional, IsString } from "class-validator";
export class TripCreateDto {
  // nur für Tests/Fallback – in Produktion kommt userId aus req.user.id
  @IsOptional() @IsString() userId?: string;

  @IsString() routeFrom!: string;
  @IsString() routeTo!: string;
  @IsISO8601() date!: string;
  @IsNumber() maxWeightKg!: number;
}

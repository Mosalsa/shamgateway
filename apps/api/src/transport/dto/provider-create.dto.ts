import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsArray,
} from "class-validator";

export class ProviderCreateDto {
  @IsString() name!: string;
  @IsOptional() @IsString() legalName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() iban?: string;
  @IsOptional() @IsString() bankName?: string;
  @IsOptional() address?: Record<string, any>;
  @IsOptional() @IsString() baseCurrency?: string; // default USD
  @IsOptional() @IsInt() vehicleCount?: number;
  @IsArray() @IsString({ each: true }) vehicleTypes!: string[];
  @IsOptional() @IsBoolean() active?: boolean;
}

// src/user/dto/create-user.dto.ts
import {
  IsEmail,
  IsOptional,
  IsString,
  IsDateString,
  MinLength,
} from "class-validator";

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;
}

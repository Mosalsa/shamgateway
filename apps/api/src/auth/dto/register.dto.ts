import { IsEmail, IsOptional, MinLength } from "class-validator";
import { PartialType } from "@nestjs/mapped-types";
import { CreateUserDto } from "./create-user.dto";
export class UpdateUserDto extends PartialType(CreateUserDto) {}
export class RegisterDto {
  @IsEmail()
  email!: string;

  @MinLength(6)
  password!: string;

  @IsOptional()
  name?: string;
}

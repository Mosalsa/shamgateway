import { IsString, MinLength } from "class-validator";

export class ChangePasswordDto {
  @IsString()
  @MinLength(6)
  oldPwd!: string;

  @IsString()
  @MinLength(6)
  newPwd!: string;
}

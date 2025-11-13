import { IsArray, IsInt, IsOptional, IsString } from "class-validator";

export class ItemCreateDto {
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;

  // ✅ optional machen, sonst meckert er wenn nicht gesendet
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fileIds?: string[];

  @IsOptional() @IsInt() quantity?: number;
  @IsOptional() @IsString() fee?: string;
  @IsOptional() @IsString() currency?: string;
}

import {
  IsArray,
  IsOptional,
  IsString,
  ValidateNested,
  IsIn,
  IsNumberString,
} from "class-validator";
import { Type } from "class-transformer";

export class ChangeSliceDto {
  // ENTWEDER slice_id ODER (origin, destination, departure_date)
  @IsOptional() @IsString() slice_id?: string;
  @IsOptional() @IsString() origin?: string;
  @IsOptional() @IsString() destination?: string;
  @IsOptional() @IsString() departure_date?: string; // YYYY-MM-DD
}

export class ChangeSlicesDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChangeSliceDto)
  add?: ChangeSliceDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChangeSliceDto)
  remove?: ChangeSliceDto[];
}

export class CreateOrderChangeRequestDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => ChangeSlicesDto)
  slices?: ChangeSlicesDto;

  @IsOptional()
  @IsArray()
  services?: Array<{ id: string; quantity?: number }>;

  @IsOptional()
  @IsString()
  reason?: string; // nur für Logging bei dir
}

export class ChangePaymentDto {
  @IsIn(["balance", "card", "arc_bsp_cash"])
  type!: "balance" | "card" | "arc_bsp_cash";

  @IsString()
  currency!: string;

  @IsNumberString()
  amount!: string; // "12.00"
}

export class ConfirmOrderChangeDto {
  @IsString()
  order_change_request_id!: string; // req_...

  @IsString()
  selected_order_change_offer!: string; // oco_...

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChangePaymentDto)
  payments?: ChangePaymentDto[];
}

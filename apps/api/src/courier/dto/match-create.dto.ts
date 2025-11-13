import { IsString } from "class-validator";
export class MatchCreateDto {
  @IsString() courier_order_id!: string;
  @IsString() trip_id!: string;
  @IsString() proposed_price!: string;
  @IsString() currency!: string;
}

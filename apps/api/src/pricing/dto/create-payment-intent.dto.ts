import { IsIn, IsOptional, IsString } from "class-validator";

export class CreatePaymentIntentDto {
  @IsString() quote_id!: string;
  @IsOptional() @IsString() travel_order_id?: string; // falls schon angelegt
  @IsIn(["card", "shamcash"]) pay_method!: "card" | "shamcash";
}

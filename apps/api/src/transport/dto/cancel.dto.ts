import { IsOptional, IsString } from "class-validator";
export class TransportCancelDto {
  @IsString() ground_transport_order_id!: string;
  @IsOptional() @IsString() reason?: string;
}

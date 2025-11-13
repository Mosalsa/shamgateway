import { IsString } from "class-validator";
export class TransportConfirmDto {
  @IsString() ground_transport_order_id!: string;
}

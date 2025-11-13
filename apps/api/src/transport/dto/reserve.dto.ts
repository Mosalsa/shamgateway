import { TransportQuoteDto } from "./quote.dto";
import { IsString } from "class-validator";
export class TransportReserveDto extends TransportQuoteDto {
  @IsString() travel_order_id!: string; // Container-ID (String)
  @IsString() route_id!: string;
}

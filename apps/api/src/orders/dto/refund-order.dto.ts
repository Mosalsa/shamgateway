// import { IsString } from "class-validator";

// export class RefundOrderDto {
//   @IsString()
//   paymentIntentId!: string;

//   @IsString()
//   currency!: string;

//   @IsString()
//   amount!: string;
// }

// apps/api/src/orders/dto/refund-order.dto.ts
import { IsString } from "class-validator";
export class RefundOrderDto {
  @IsString() order_id!: string; // ord_...
}

// apps/api/src/bookings/dto/book-order.dto.ts
import {
  ArrayMinSize,
  IsArray,
  IsString,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { PassengerDto } from "../../orders/dto/create-order.dto";

export class BookOrderDto {
  @IsString()
  offerId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PassengerDto)
  passengers!: PassengerDto[];

  // Stripe PaymentIntent, der bereits "succeeded" ist
  @IsString()
  stripePaymentIntentId!: string;

  // Gesamtsumme, die der Kunde bei Stripe gezahlt hat (inkl. Fees), z.B. "199.00"
  @IsString()
  totalAmount!: string;

  // z.B. "EUR"
  @IsString()
  currency!: string;
}

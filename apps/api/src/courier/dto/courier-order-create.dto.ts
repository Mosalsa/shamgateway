import { IsISO8601, IsNumber, IsOptional, IsString } from "class-validator";

export class CourierOrderCreateDto {
  @IsOptional() @IsString() senderId?: string;
  @IsString() recipientId!: string; // User-ID des Empfängers
  @IsOptional() @IsString() recipientTravelOrderId?: string;

  @IsOptional() @IsString() recipientName?: string;
  @IsOptional() @IsString() recipientPhone?: string;
  @IsOptional() @IsString() recipientCity?: string;

  @IsString() routeFrom!: string;
  @IsString() routeTo!: string;
  @IsISO8601() desiredDate!: string;
  @IsString() itemType!: string; // 'documents' | 'small_parcel'
  @IsNumber() weightKg!: number;

  @IsOptional() @IsString() declaredValue?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() price?: string; // System kann überschreiben
  @IsOptional() @IsString() currency?: string;
}

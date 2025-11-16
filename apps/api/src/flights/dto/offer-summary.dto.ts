// apps/api/src/flights/dto/offer-summary.dto.ts
export class OfferSummaryDto {
  id!: string;

  total_amount!: string;
  total_currency!: string;

  expires_at!: string | null; // raw (ISO von Duffel)
  expires_at_local!: string | null; // schön formatiert (Berlin)
  expires_in_minutes!: number | null; // wie viele Minuten ab jetzt?

  payment_required_by!: string | null;
  requires_instant_payment!: boolean;
  is_instant!: boolean;
  is_hold!: boolean;
}

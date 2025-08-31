// apps/api/src/flights/flights.service.ts
import { HttpService } from "@nestjs/axios";
import { Injectable, HttpException } from "@nestjs/common";
import { firstValueFrom } from "rxjs";
import { CreateOfferRequestDto } from "./dto/create-offer-request.dto";
import { SearchFlightsDto } from "./dto/search-flights.dto";

@Injectable()
export class FlightsService {
  constructor(private readonly http: HttpService) {}

  async createOfferRequest(
    dto: CreateOfferRequestDto,
    opts?: { return_offers?: boolean; supplier_timeout?: number }
  ) {
    const params: Record<string, any> = {};
    if (typeof opts?.return_offers === "boolean")
      params.return_offers = opts.return_offers;
    if (typeof opts?.supplier_timeout === "number")
      params.supplier_timeout = opts.supplier_timeout;

    const body = {
      data: {
        slices: dto.slices,
        passengers: dto.passengers,
        ...(dto.cabin_class ? { cabin_class: dto.cabin_class } : {}),
        ...(typeof dto.max_connections === "number"
          ? { max_connections: dto.max_connections }
          : {}),
      },
    };

    try {
      const { data } = await firstValueFrom(
        this.http.post("/offer_requests", body, { params })
      );
      return data?.data ?? data; // v2: payload hat "data"
    } catch (err: any) {
      throw new HttpException(
        err?.response?.data ?? err?.message ?? "Unknown error",
        err?.response?.status ?? 500
      );
    }
  }

  async searchFlights(dto: SearchFlightsDto) {
    const slices = [
      {
        origin: dto.origin,
        destination: dto.destination,
        departure_date: dto.departureDate,
      },
    ];
    if (dto.returnDate) {
      slices.push({
        origin: dto.destination,
        destination: dto.origin,
        departure_date: dto.returnDate,
      });
    }

    const passengers: any[] = [];
    for (let i = 0; i < dto.adults; i++) passengers.push({ type: "adult" });
    for (let i = 0; i < (dto.children ?? 0); i++)
      passengers.push({ type: "child" });
    for (let i = 0; i < (dto.infants ?? 0); i++)
      passengers.push({ type: "infant_without_seat" });

    return this.createOfferRequest(
      {
        slices,
        passengers,
        cabin_class: dto.cabinClass,
        max_connections: dto.maxConnections,
      },
      { return_offers: true, supplier_timeout: 10000 }
    );
  }

  async listOfferRequests(query?: {
    after?: string;
    before?: string;
    limit?: number;
  }) {
    try {
      const { data } = await firstValueFrom(
        this.http.get("/offer_requests", { params: query ?? {} })
      );
      return data?.data ?? data;
    } catch (err: any) {
      throw new HttpException(
        err?.response?.data ?? err,
        err?.response?.status ?? 500
      );
    }
  }

  async getOfferRequest(id: string) {
    try {
      const { data } = await firstValueFrom(
        this.http.get(`/offer_requests/${id}`)
      );
      return data?.data ?? data;
    } catch (err: any) {
      throw new HttpException(
        err?.response?.data ?? err,
        err?.response?.status ?? 500
      );
    }
  }
}

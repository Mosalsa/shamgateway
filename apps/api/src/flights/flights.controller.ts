// apps/api/src/flights/flights.controller.ts
import { Controller, Get, Post, Body, Query, Param } from "@nestjs/common";
import { FlightsService } from "./flights.service";
import { CreateOfferRequestDto } from "./dto/create-offer-request.dto";
import { SearchFlightsDto } from "./dto/search-flights.dto";

@Controller("flights")
export class FlightsController {
  constructor(private readonly flights: FlightsService) {}

  @Post("offer-requests")
  createOfferRequest(
    @Body() dto: CreateOfferRequestDto,
    @Query("return_offers") return_offers?: string,
    @Query("supplier_timeout") supplier_timeout?: string
  ) {
    const opts = {
      return_offers:
        return_offers === undefined ? undefined : return_offers === "true",
      supplier_timeout: supplier_timeout ? Number(supplier_timeout) : undefined,
    };
    return this.flights.createOfferRequest(dto, opts);
  }

  @Post("search")
  search(@Body() dto: SearchFlightsDto) {
    return this.flights.searchFlights(dto);
  }

  @Get("offer-requests")
  list(
    @Query("after") after?: string,
    @Query("before") before?: string,
    @Query("limit") limit?: string
  ) {
    const q: any = {};
    if (after) q.after = after;
    if (before) q.before = before;
    if (limit) q.limit = Number(limit);
    return this.flights.listOfferRequests(q);
  }

  @Get("offer-requests/:id")
  getOne(@Param("id") id: string) {
    return this.flights.getOfferRequest(id);
  }
}

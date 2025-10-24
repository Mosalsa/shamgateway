// apps/api/src/flights/flights.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  BadRequestException,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
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
  // ...innerhalb der bestehenden FlightsController-Klasse ANS ENDE anhängen:

  // GET /flights/offers/:id
  @Get("offers/:id")
  getOffer(@Param("id") id: string) {
    if (!id) throw new BadRequestException("offer id is required");
    return this.flights.getOffer(id);
  }

  // GET /flights/offers?offer_request_id=...&after=...&limit=...
  @Get("offers")
  listOffers(
    @Query("offer_request_id") offerRequestId?: string,
    @Query("after") after?: string,
    @Query("limit") limit?: string
  ) {
    if (!offerRequestId) {
      throw new BadRequestException("offer_request_id is required");
    }
    return this.flights.listOffersByRequest(offerRequestId, {
      after,
      limit: limit ? Number(limit) : undefined,
    });
  }

  // GET /flights/seat-maps?offer_id=...
  @Get("seat-maps")
  getSeatMaps(@Query("offer_id") offerId?: string) {
    if (!offerId) throw new BadRequestException("offer_id is required");
    return this.flights.getSeatMapsByOffer(offerId);
  }

  // GET /flights/airlines?after=...&limit=...&iata_code=...
  @Get("airlines")
  listAirlines(
    @Query("after") after?: string,
    @Query("limit") limit?: string,
    @Query("iata_code") iata_code?: string
  ) {
    return this.flights.listAirlines({
      after,
      limit: limit ? Number(limit) : undefined,
      iata_code,
    });
  }

  // GET /flights/aircraft?after=...&limit=...&iata_code=...
  @Get("aircraft")
  listAircraft(
    @Query("after") after?: string,
    @Query("limit") limit?: string,
    @Query("iata_code") iata_code?: string
  ) {
    return this.flights.listAircraft({
      after,
      limit: limit ? Number(limit) : undefined,
      iata_code,
    });
  }

  // POST /flights/batch-offer-requests?supplier_timeout=...
  @Post("batch-offer-requests")
  createBatchOfferRequestCtrl(
    @Body() dto: CreateOfferRequestDto,
    @Query("supplier_timeout") supplier_timeout?: string
  ) {
    return this.flights.createBatchOfferRequest(dto, {
      supplier_timeout: supplier_timeout ? Number(supplier_timeout) : undefined,
    });
  }

  // GET /flights/batch-offer-requests/:id
  @Get("batch-offer-requests/:id")
  getBatchOfferRequestCtrl(@Param("id") id: string) {
    if (!id)
      throw new BadRequestException("batch offer_request id is required");
    return this.flights.getBatchOfferRequest(id);
  }

  // ⬇️ NEU: kompakte Zählung instant vs hold aus den Offer-Ergebnissen
  @Post("search/summary")
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    })
  )
  searchSummary(@Body() dto: SearchFlightsDto) {
    return this.flights.searchSummary(dto);
  }
}

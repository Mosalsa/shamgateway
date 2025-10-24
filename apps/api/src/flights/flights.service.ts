// apps/api/src/flights/flights.service.ts
import { HttpService } from "@nestjs/axios";
import { Injectable, HttpException, BadRequestException } from "@nestjs/common";
import { firstValueFrom } from "rxjs";
import { CreateOfferRequestDto } from "./dto/create-offer-request.dto";
import { SearchFlightsDto } from "./dto/search-flights.dto";

@Injectable()
export class FlightsService {
  constructor(private readonly http: HttpService) {}

  private makePassengers(dto: SearchFlightsDto) {
    const pax: any[] = [];
    for (let i = 0; i < (dto.adults ?? 1); i++) pax.push({ type: "adult" });
    for (let i = 0; i < (dto.children ?? 0); i++) pax.push({ type: "child" });
    for (let i = 0; i < (dto.infants ?? 0); i++)
      pax.push({ type: "infant_without_seat" });
    if (pax.length === 0) pax.push({ type: "adult" });
    return pax;
  }
  private buildSlices(dto: SearchFlightsDto) {
    if (dto.journeyType === "one_way") {
      if (!dto.origin || !dto.destination || !dto.departureDate) {
        throw new BadRequestException(
          "origin, destination, departureDate required for one_way"
        );
      }
      return [
        {
          origin: dto.origin,
          destination: dto.destination,
          departure_date: dto.departureDate,
        },
      ];
    }

    if (dto.journeyType === "return") {
      if (
        !dto.origin ||
        !dto.destination ||
        !dto.departureDate ||
        !dto.returnDate
      ) {
        throw new BadRequestException(
          "origin, destination, departureDate, returnDate required for return"
        );
      }
      return [
        {
          origin: dto.origin,
          destination: dto.destination,
          departure_date: dto.departureDate,
        },
        {
          origin: dto.destination,
          destination: dto.origin,
          departure_date: dto.returnDate,
        },
      ];
    }

    // multi_city
    if (!Array.isArray(dto.slices) || dto.slices.length < 2) {
      throw new BadRequestException("slices[2+] required for multi_city");
    }
    return dto.slices.map((s) => ({
      origin: s.origin,
      destination: s.destination,
      departure_date: s.departureDate,
    }));
  }
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
  private applyAdvancedToBody(body: any, dto: SearchFlightsDto) {
    const adv = dto.advanced;
    if (!adv) return;

    if (typeof adv.maxConnections === "number") {
      body.data.max_connections = adv.maxConnections;
    }
    if (Array.isArray(adv.allowCarriers) && adv.allowCarriers.length) {
      body.data.allowed_carriers = adv.allowCarriers;
    }
    if (Array.isArray(adv.blockCarriers) && adv.blockCarriers.length) {
      body.data.blocked_carriers = adv.blockCarriers;
    }
    // Time-of-day → Duffel hat kein 1:1 Feld; du kannst ggf. clientseitig filtern.
    // Wir hängen es nur in metadata, damit du es später filtern kannst.
    if (adv.departTimeOfDay && adv.departTimeOfDay !== "any") {
      body.data.metadata = {
        ...(body.data.metadata ?? {}),
        depart_time_of_day: adv.departTimeOfDay,
      };
    }
  }

  private classifyOfferType(offer: any) {
    const pr = offer?.payment_requirements ?? {};
    if (pr.requires_instant_payment === true) return "instant";
    if (pr.payment_required_by) return "hold";
    return "unknown";
  }

  async searchFlights(dto: SearchFlightsDto) {
    const slices = this.buildSlices(dto);
    const passengers = this.makePassengers(dto);

    const body: any = { data: { slices, passengers } };
    if (dto.cabinClass) body.data.cabin_class = dto.cabinClass;
    this.applyAdvancedToBody(body, dto);

    // Duffel v2: POST /air/offer_requests
    const { data: created } = await firstValueFrom(
      this.http.post("/offer_requests", body)
    );
    const offerRequest = created?.data ?? created;

    // Die Offers sind meist direkt im POST-Response enthalten (v2).
    const offers = Array.isArray(offerRequest?.offers)
      ? offerRequest.offers
      : [];

    if (!dto.classify) return offerRequest;

    // kleine Zusammenfassung wie in deiner Analyse
    const counts = { instant: 0, hold: 0, unknown: 0 };
    const samples = {
      instant: [] as string[],
      hold: [] as string[],
      unknown: [] as string[],
    };

    for (const o of offers) {
      const t = this.classifyOfferType(o);
      counts[t as "instant" | "hold" | "unknown"]++;
      if (samples[t as "instant" | "hold" | "unknown"].length < 8) {
        samples[t as "instant" | "hold" | "unknown"].push(o.id);
      }
    }

    return {
      ok: true,
      request_id: offerRequest?.id ?? null,
      totals: { offers: offers.length, ...counts },
      samples,
      note: "Klassifikation basiert auf offer.payment_requirements.requires_instant_payment bzw. payment_required_by.",
      offers, // ← wenn zu groß, hier entfernen oder mit ?details=1 steuern
    };
  }

  // GET /air/offer_requests?after=...&before=...&limit=...
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

  // GET /air/offer_requests/:id
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

  // GET /air/offers/:id
  async getOffer(id: string) {
    try {
      const { data } = await firstValueFrom(this.http.get(`/offers/${id}`));
      return data?.data ?? data;
    } catch (err: any) {
      throw new HttpException(
        err?.response?.data ?? err,
        err?.response?.status ?? 500
      );
    }
  }

  // GET /air/offers?offer_request_id=...&after=...&limit=...
  async listOffersByRequest(
    offerRequestId: string,
    query?: { after?: string; limit?: number }
  ) {
    try {
      const params: any = {
        offer_request_id: offerRequestId,
        ...(query ?? {}),
      };
      const { data } = await firstValueFrom(
        this.http.get(`/offers`, { params })
      );
      return data?.data ?? data;
    } catch (err: any) {
      throw new HttpException(
        err?.response?.data ?? err,
        err?.response?.status ?? 500
      );
    }
  }

  // GET /air/seat_maps?offer_id=...
  async getSeatMapsByOffer(offerId: string) {
    try {
      const { data } = await firstValueFrom(
        this.http.get(`/seat_maps`, { params: { offer_id: offerId } })
      );
      return data?.data ?? data;
    } catch (err: any) {
      throw new HttpException(
        err?.response?.data ?? err,
        err?.response?.status ?? 500
      );
    }
  }

  // GET /air/airlines?after=...&limit=... (optional: iata_code)
  async listAirlines(query?: {
    after?: string;
    limit?: number;
    iata_code?: string;
  }) {
    try {
      const { data } = await firstValueFrom(
        this.http.get(`/airlines`, { params: query ?? {} })
      );
      return data?.data ?? data;
    } catch (err: any) {
      throw new HttpException(
        err?.response?.data ?? err,
        err?.response?.status ?? 500
      );
    }
  }

  // GET /air/aircraft?after=...&limit=... (optional: iata_code)
  async listAircraft(query?: {
    after?: string;
    limit?: number;
    iata_code?: string;
  }) {
    try {
      const { data } = await firstValueFrom(
        this.http.get(`/aircraft`, { params: query ?? {} })
      );
      return data?.data ?? data;
    } catch (err: any) {
      throw new HttpException(
        err?.response?.data ?? err,
        err?.response?.status ?? 500
      );
    }
  }

  // OPTIONAL: Batch Offer Requests (POST + GET)
  // POST /air/batch_offer_requests
  async createBatchOfferRequest(
    dto: CreateOfferRequestDto,
    opts?: { supplier_timeout?: number }
  ) {
    const params: Record<string, any> = {};
    if (typeof opts?.supplier_timeout === "number") {
      params.supplier_timeout = opts.supplier_timeout;
    }
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
        this.http.post(`/batch_offer_requests`, body, { params })
      );
      return data?.data ?? data;
    } catch (err: any) {
      throw new HttpException(
        err?.response?.data ?? err,
        err?.response?.status ?? 500
      );
    }
  }

  // GET /air/batch_offer_requests/:id
  async getBatchOfferRequest(id: string) {
    try {
      const { data } = await firstValueFrom(
        this.http.get(`/batch_offer_requests/${id}`)
      );
      return data?.data ?? data;
    } catch (err: any) {
      throw new HttpException(
        err?.response?.data ?? err,
        err?.response?.status ?? 500
      );
    }
  }

  //Zähle instant vs hold anhand payment_requirements der Offers
  async searchSummary(dto: SearchFlightsDto) {
    const search = await this.searchFlights(dto);

    // Versuche, die Offer-Liste robust zu extrahieren
    const offers: any[] =
      (search?.data?.offers as any[]) ??
      (search?.data as any[]) ??
      (search?.offers as any[]) ??
      [];

    console.log(
      "DBG payment_requirements sample:",
      offers.slice(0, 3).map((o) => ({
        id: o?.id,
        pr: o?.payment_requirements ?? o?.payment_status,
      }))
    );

    const classify = (offer: any): "instant" | "hold" | "unknown" => {
      const pr = offer?.payment_requirements ?? offer?.payment_status ?? {};
      // Duffel v2: payment_requirements.requires_instant_payment => true => "instant"
      if (pr?.requires_instant_payment === true) return "instant";

      // Wenn eine Deadline existiert (payment_required_by) und NOT requires_instant_payment => "hold"
      if (pr?.payment_required_by && pr?.requires_instant_payment !== true) {
        return "hold";
      }

      // gelegentlich legen Anbieter das Flag nicht – heuristisch:
      // total_amount vorhanden aber keine requires_instant_payment, keine deadline -> oft instant
      if (pr?.requires_instant_payment === false) return "hold";
      return "unknown";
    };

    let instant = 0;
    let hold = 0;
    let unknown = 0;

    const sampleInstant: string[] = [];
    const sampleHold: string[] = [];
    const sampleUnknown: string[] = [];

    for (const o of offers) {
      const t = classify(o);
      if (t === "instant") {
        instant++;
        if (sampleInstant.length < 10) sampleInstant.push(o?.id ?? "(no-id)");
      } else if (t === "hold") {
        hold++;
        if (sampleHold.length < 10) sampleHold.push(o?.id ?? "(no-id)");
      } else {
        unknown++;
        if (sampleUnknown.length < 10) sampleUnknown.push(o?.id ?? "(no-id)");
      }
    }

    return {
      ok: true,
      totals: {
        offers: offers.length,
        instant,
        hold,
        unknown,
      },
      samples: {
        instant: sampleInstant,
        hold: sampleHold,
        unknown: sampleUnknown,
      },
      note: "Klassifikation basiert auf offer.payment_requirements.requires_instant_payment bzw. payment_required_by.",
    };
  }
}

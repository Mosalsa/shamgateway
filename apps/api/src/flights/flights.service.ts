// apps/api/src/flights/flights.service.ts
import { HttpService } from "@nestjs/axios";
import {
  Injectable,
  HttpException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { firstValueFrom } from "rxjs";
import { CreateOfferRequestDto } from "./dto/create-offer-request.dto";
import { SearchFlightsDto } from "./dto/search-flights.dto";
import { OfferSummaryDto } from "./dto/offer-summary.dto";
const DEFAULT_SUPPLIER_TIMEOUT_MS = Number(
  process.env.SUPPLIER_TIMEOUT_MS ?? 30000
);
const MIN_SUPPLIER_TIMEOUT_MS = 2000;

type FilterMode =
  | "hold_and_changeable"
  | "hold_only"
  | "changeable_only"
  | "any";
@Injectable()
export class FlightsService {
  private readonly apiBaseUrl =
    process.env.API_BASE_URL ?? "http://localhost:3000";
  private readonly logger = new Logger(FlightsService.name);
  constructor(private readonly http: HttpService) {}

  private resolveSupplierTimeoutMs(ms?: number) {
    const v = Number.isFinite(ms as any)
      ? Number(ms)
      : DEFAULT_SUPPLIER_TIMEOUT_MS;
    // Duffel fordert >= 2000 ms
    return Math.max(v, MIN_SUPPLIER_TIMEOUT_MS);
  }

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
    opts?: { return_offers?: boolean; supplier_timeout?: number } // number in ms!
  ) {
    // 1) Params korrekt in MS bauen
    const timeoutMs = this.resolveSupplierTimeoutMs(opts?.supplier_timeout);
    const params: Record<string, any> = {
      // default: true – stabilere Suche (kann per opts überschrieben werden)
      return_offers:
        typeof opts?.return_offers === "boolean" ? opts.return_offers : true,
      supplier_timeout: timeoutMs,
    };

    // 2) Duffel-Body
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

    // 3) Call – wichtig: axios timeout > supplier_timeout
    try {
      const { data } = await firstValueFrom(
        this.http.post("/offer_requests", body, {
          params,
          timeout: timeoutMs + 5000, // client-Timeout > server aggregation
        })
      );
      return data?.data ?? data;
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
    const SUPPLIER_TIMEOUT_MS = Number(
      process.env.SUPPLIER_TIMEOUT_MS ?? 30000
    );
    // Duffel v2: POST /air/offer_requests
    const { data: created } = await firstValueFrom(
      this.http.post("/offer_requests", body, {
        params: { return_offers: true, supplier_timeout: 30000 },
      })
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

  // In FlightsService einfügen:
  async searchHoldChangeable(
    dto: SearchFlightsDto,
    mode: FilterMode = "hold_only"
  ) {
    // --- Helfer: Passengers aus adults/children/infants bauen (Duffel erwartet Liste)
    const buildPassengers = () => {
      const list: Array<{ type: "adult" | "child" | "infant_without_seat" }> =
        [];
      const adults = Math.max(1, Number(dto.adults ?? 1));
      const children = Math.max(0, Number(dto.children ?? 0));
      const infants = Math.max(0, Number(dto.infants ?? 0));
      for (let i = 0; i < adults; i++) list.push({ type: "adult" });
      for (let i = 0; i < children; i++) list.push({ type: "child" });
      for (let i = 0; i < infants; i++)
        list.push({ type: "infant_without_seat" });
      return list;
    };

    // --- Helfer: Slices aus deinem DTO (one_way/return/multi_city)
    const buildSlices = () => {
      const out: Array<{
        origin: string;
        destination: string;
        departure_date: string;
      }> = [];
      if (dto.journeyType === "one_way") {
        if (!dto.origin || !dto.destination || !dto.departureDate) {
          throw new BadRequestException(
            "origin, destination, departureDate sind erforderlich (one_way)"
          );
        }
        out.push({
          origin: dto.origin,
          destination: dto.destination,
          departure_date: dto.departureDate,
        });
      } else if (dto.journeyType === "return") {
        if (
          !dto.origin ||
          !dto.destination ||
          !dto.departureDate ||
          !dto.returnDate
        ) {
          throw new BadRequestException(
            "origin, destination, departureDate, returnDate sind erforderlich (return)"
          );
        }
        out.push({
          origin: dto.origin,
          destination: dto.destination,
          departure_date: dto.departureDate,
        });
        out.push({
          origin: dto.destination,
          destination: dto.origin,
          departure_date: dto.returnDate,
        });
      } else {
        const arr = Array.isArray(dto.slices) ? dto.slices : [];
        if (arr.length < 2)
          throw new BadRequestException(
            "multi_city benötigt mindestens 2 Slices"
          );
        for (const s of arr) {
          if (!s.origin || !s.destination || !s.departureDate) {
            throw new BadRequestException(
              "Slice benötigt origin, destination, departureDate (YYYY-MM-DD)"
            );
          }
          out.push({
            origin: s.origin,
            destination: s.destination,
            departure_date: s.departureDate,
          });
        }
      }
      return out;
    };

    // ---- Duffel Request (wie deine search), KEINE Carrier erzwungen
    const body: any = {
      data: {
        slices: buildSlices(),
        passengers: buildPassengers(),
        ...(dto.cabinClass ? { cabin_class: dto.cabinClass } : {}),
        ...(typeof dto.advanced?.maxConnections === "number"
          ? { max_connections: dto.advanced.maxConnections }
          : {}),
        ...(Array.isArray(dto.advanced?.allowCarriers) &&
        dto.advanced.allowCarriers.length
          ? { allowed_carriers: dto.advanced.allowCarriers }
          : {}),
        ...(Array.isArray(dto.advanced?.blockCarriers) &&
        dto.advanced.blockCarriers.length
          ? { blocked_carriers: dto.advanced.blockCarriers }
          : {}),
      },
    };

    const params = {
      return_offers: true,
      supplier_timeout: 30000, // Duffel verlangt >= 2000 (ms)
    };

    const { data } = await firstValueFrom(
      this.http.post("/offer_requests", body, { params })
    );
    const payload = data?.data ?? data;

    // v2: Offers herausziehen
    const offers: any[] =
      (Array.isArray(payload?.offers) && payload.offers) ||
      (Array.isArray(payload?.data) && payload.data) ||
      (Array.isArray(payload) ? payload : []);

    // --- Filterlogik + Diagnose
    const reasons = {
      instantOnly: 0,
      notChangeableTop: 0,
      notChangeableSlice: 0,
    };

    const passHold = (o: any) =>
      o?.payment_requirements?.requires_instant_payment === false;
    const passTopChange = (o: any) =>
      !!o?.conditions?.change_before_departure?.allowed;
    const passAllSlicesChange = (o: any) => {
      const ss = Array.isArray(o?.slices) ? o.slices : [];
      return ss.every(
        (s: any) => !!s?.conditions?.change_before_departure?.allowed
      );
    };

    const keep = (o: any) => {
      switch (mode) {
        case "hold_only":
          return passHold(o);
        case "changeable_only":
          return passTopChange(o) && passAllSlicesChange(o);
        case "any":
          return true;
        default:
          /* hold_and_changeable */ return (
            passHold(o) && passTopChange(o) && passAllSlicesChange(o)
          );
      }
    };

    const filtered: any[] = [];
    for (const off of offers) {
      // Für Breakdown immer erst streng zählen (wie du es debuggen willst)
      const isHold = passHold(off);
      const isTopChg = passTopChange(off);
      const isSlicesChg = passAllSlicesChange(off);
      if (!isHold) reasons.instantOnly++;
      else if (!isTopChg) reasons.notChangeableTop++;
      else if (!isSlicesChg) reasons.notChangeableSlice++;

      if (keep(off)) filtered.push(off);
    }

    // Preis-aufsteigend
    filtered.sort(
      (a, b) => Number(a?.total_amount ?? 0) - Number(b?.total_amount ?? 0)
    );

    // Gleiche Struktur behalten, nur offers ersetzen + Stats anhängen
    return {
      ...payload,
      offers: filtered,
      _stats: {
        total: Array.isArray(offers) ? offers.length : 0,
        filtered: filtered.length,
        reasons, // hilft sofort zu sehen, warum nichts übrig blieb
        mode,
      },
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
    opts?: { supplier_timeout?: number } // number in ms!
  ) {
    const timeoutMs = this.resolveSupplierTimeoutMs(opts?.supplier_timeout);
    const params: Record<string, any> = {
      supplier_timeout: timeoutMs,
    };

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
        this.http.post("/batch_offer_requests", body, {
          params,
          timeout: timeoutMs + 5000,
        })
      );
      return data?.data ?? data;
    } catch (err: any) {
      throw new HttpException(
        err?.response?.data ?? err?.message ?? "Unknown error",
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

  // ==================================================
  // NEU: Fare-Optionen für ein Offer (Basic / Comfort / Premium)
  // ==================================================

  /** prüft, ob zwei Offers das gleiche Itinerary (gleiche Slices/Segmente) haben */
  private sameItinerary(a: any, b: any): boolean {
    const sa = Array.isArray(a?.slices) ? a.slices : [];
    const sb = Array.isArray(b?.slices) ? b.slices : [];
    if (sa.length !== sb.length) return false;

    for (let i = 0; i < sa.length; i++) {
      const segA = Array.isArray(sa[i]?.segments) ? sa[i].segments : [];
      const segB = Array.isArray(sb[i]?.segments) ? sb[i].segments : [];
      if (segA.length !== segB.length) return false;

      for (let j = 0; j < segA.length; j++) {
        const aSeg = segA[j];
        const bSeg = segB[j];
        if (
          aSeg?.origin?.iata_code !== bSeg?.origin?.iata_code ||
          aSeg?.destination?.iata_code !== bSeg?.destination?.iata_code ||
          aSeg?.departing_at !== bSeg?.departing_at
        ) {
          return false;
        }
      }
    }
    return true;
  }

  /** baut die Bullet-Liste wie auf deiner Detailseite aus conditions + Bags */
  private buildFareRulesFromOffer(offer: any): string[] {
    const rules: string[] = [];

    const topCond = offer?.conditions ?? {};
    const sliceCond =
      offer?.slices?.[0]?.conditions ??
      offer?.slices?.[0]?.conditions_before_departure ??
      {};

    const change =
      topCond.change_before_departure ??
      sliceCond.change_before_departure ??
      {};
    const refund =
      topCond.refund_before_departure ??
      sliceCond.refund_before_departure ??
      {};

    // Changes
    if (change.allowed === true) {
      const fee =
        change.change_penalty_amount ??
        change.penalty_amount ??
        change.amount ??
        null;
      const cur =
        change.change_penalty_currency ??
        change.penalty_currency ??
        change.currency ??
        offer.total_currency ??
        null;
      if (fee && cur) {
        rules.push(`Changeable (${fee} ${cur} fee)`);
      } else {
        rules.push("Changeable");
      }
    } else if (change.allowed === false) {
      rules.push("Not changeable");
    } else {
      rules.push("No data on changes");
    }

    // Refunds
    if (refund.allowed === true) {
      const fee =
        refund.refund_penalty_amount ??
        refund.penalty_amount ??
        refund.amount ??
        null;
      const cur =
        refund.refund_penalty_currency ??
        refund.penalty_currency ??
        refund.currency ??
        offer.total_currency ??
        null;
      if (fee && cur) {
        rules.push(`Refundable (${fee} ${cur} fee)`);
      } else {
        rules.push("Refundable");
      }
    } else if (refund.allowed === false) {
      rules.push("Not refundable");
    } else {
      rules.push("No data on refunds");
    }

    // Payment / Hold
    const pr = offer?.payment_requirements ?? {};
    if (pr.requires_instant_payment === true) {
      rules.push("Instant payment required");
    } else if (
      pr.payment_required_by ||
      pr.requires_instant_payment === false
    ) {
      rules.push("Hold space (no instant payment required)");
    } else {
      rules.push("No data about payment requirements");
    }

    // Cabin & Checked bags – aus slice.conditions.* oder offer.*
    const slice0 = Array.isArray(offer?.slices) ? offer.slices[0] : undefined;
    const cabin =
      slice0?.conditions?.included_cabin_bags ??
      offer?.included_cabin_bags ??
      null;
    const checked =
      slice0?.conditions?.included_checked_bags ??
      offer?.included_checked_bags ??
      null;

    if (cabin && typeof cabin.quantity === "number" && cabin.quantity > 0) {
      rules.push(
        `Includes cabin bags (${cabin.quantity} bag${
          cabin.quantity > 1 ? "s" : ""
        })`
      );
    } else {
      rules.push("No data about cabin bags");
    }

    if (
      checked &&
      typeof checked.quantity === "number" &&
      checked.quantity > 0
    ) {
      rules.push(
        `Includes checked bags (${checked.quantity} bag${
          checked.quantity > 1 ? "s" : ""
        })`
      );
    } else {
      rules.push("No data about checked bags");
    }

    return rules;
  }

  /** Name der Fare-Option (Basic / Comfort / Premium …) */
  private buildFareName(offer: any): string {
    return (
      offer?.fare_brand_name ??
      offer?.brand_name ??
      offer?.cabin_class_marketing_name ??
      offer?.cabin_class ??
      "Economy"
    );
  }

  /**
   * Hauptfunktion:
   *  - Holt das Offer
   *  - Liest offer_request_id
   *  - Holt alle Offers dieses Requests
   *  - Filtert gleiche Route
   *  - Baut Fare-Liste mit echten Regeln
   */
  async getOfferWithFareOptions(id: string) {
    const baseOffer = await this.getOffer(id);
    if (!baseOffer || !baseOffer.id) {
      throw new HttpException("Offer not found", 404);
    }

    const offerRequestId =
      baseOffer.offer_request_id ?? baseOffer.offer_request?.id;
    let siblings: any[] = [];
    console.log(
      "DBG baseOffer",
      baseOffer.id,
      "offer_request_id",
      offerRequestId
    );
    if (offerRequestId) {
      const raw = await this.listOffersByRequest(offerRequestId, {
        limit: 50,
      });
      const all = Array.isArray(raw) ? raw : raw?.data ?? [];
      siblings = all.filter((o: any) => this.sameItinerary(o, baseOffer));
      console.log("DBG siblings for", id, siblings.length);
    }

    if (!siblings.length) {
      siblings = [baseOffer];
    }

    const fares = siblings
      .map((o) => ({
        id: o.id,
        name: this.buildFareName(o),
        cabin_class: o.cabin_class,
        total_amount: o.total_amount,
        total_currency: o.total_currency,
        rules: this.buildFareRulesFromOffer(o),
      }))
      .sort(
        (a, b) => Number(a.total_amount ?? 0) - Number(b.total_amount ?? 0)
      );

    return {
      offer: baseOffer,
      fares,
    };
  }

  private async callOfferRequestsFromSearch(
    dto: SearchFlightsDto
  ): Promise<any[]> {
    const slices = this.buildSlices(dto);
    const passengers = this.makePassengers(dto);

    const body: any = {
      data: {
        slices,
        passengers,
      },
    };

    // Cabin-Class
    if (dto.cabinClass) {
      body.data.cabin_class = dto.cabinClass;
    }

    // Advanced-Einstellungen (maxConnections, allowCarriers, blockCarriers, departTimeOfDay)
    this.applyAdvancedToBody(body, dto);

    const timeoutMs = this.resolveSupplierTimeoutMs(
      Number(process.env.SUPPLIER_TIMEOUT_MS ?? 30000)
    );

    const { data } = await firstValueFrom(
      this.http.post("/offer_requests", body, {
        params: {
          return_offers: true,
          supplier_timeout: timeoutMs,
        },
        timeout: timeoutMs + 5000,
      })
    );

    const payload = data?.data ?? data;

    const offers: any[] =
      (Array.isArray(payload?.offers) && payload.offers) ||
      (Array.isArray(payload?.data) && payload.data) ||
      (Array.isArray(payload) ? payload : []);

    return offers;
  }

  /**
   * Nimmt ein Array von Offers und baut daraus die 3 billigsten mit expires_at/expired.
   */
  private pickTop3WithExpiry(offers: any[]): any[] {
    if (!offers.length) return [];

    // nach total_amount sortieren (billigste zuerst)
    const sorted = [...offers].sort((a, b) => {
      const aStr = a.total_amount ?? a.totalAmount ?? "0";
      const bStr = b.total_amount ?? b.totalAmount ?? "0";
      const aNum = parseFloat(aStr);
      const bNum = parseFloat(bStr);
      return aNum - bNum;
    });

    const top3 = sorted.slice(0, 3);
    const now = new Date();

    return top3.map((o) => {
      const expiresRaw = o.expires_at ?? o.expiresAt ?? o.valid_until ?? null;
      const expDate = expiresRaw ? new Date(expiresRaw) : null;
      const expired = expDate ? expDate.getTime() <= now.getTime() : false;

      return {
        ...o,
        expires_at: expiresRaw ?? null,
        expired,
      };
    });
  }

  /** Mapped ein Duffel-Offer auf eine kompakte Zusammenfassung (Preis + Expiry) */
  private toOfferSummary(o: any): OfferSummaryDto {
    const pr = o?.payment_requirements ?? {};
    const requiresInstant = pr?.requires_instant_payment === true;
    const paymentRequiredBy: string | null = pr?.payment_required_by ?? null;

    const rawExpires: string | null =
      (o.expires_at as string | null) ??
      (o.expiresAt as string | null) ??
      (o.valid_until as string | null) ??
      null;

    let expiresLocal: string | null = null;
    let expiresInMinutes: number | null = null;

    if (rawExpires) {
      const d = new Date(rawExpires); // UTC

      // 1) schöne lokale Darstellung (Berlin)
      expiresLocal = d.toLocaleString("de-DE", {
        timeZone: "Europe/Berlin",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      // 2) „in x Minuten“ ab jetzt
      const now = new Date();
      const diffMs = d.getTime() - now.getTime();
      expiresInMinutes = Math.floor(diffMs / 60000); // negative Werte möglich, wenn schon abgelaufen
    }

    const summary = new OfferSummaryDto();
    summary.id = String(o.id ?? "");
    summary.total_amount = String(o.total_amount ?? o.totalAmount ?? "0");
    summary.total_currency = String(
      o.total_currency ?? o.totalCurrency ?? "EUR"
    );

    summary.expires_at = rawExpires;
    summary.expires_at_local = expiresLocal;
    summary.expires_in_minutes = expiresInMinutes;

    summary.payment_required_by = paymentRequiredBy;
    summary.requires_instant_payment = requiresInstant;
    summary.is_instant = requiresInstant;
    summary.is_hold = !requiresInstant && !!paymentRequiredBy;

    return summary;
  }

  async getTop3FreshOffers(dto: SearchFlightsDto) {
    // 1. Versuch
    const offers1 = await this.callOfferRequestsFromSearch(dto);
    const top1 = this.pickTop3WithExpiry(offers1);

    const anyExpired1 = top1.some((o) => o.expired);

    if (!anyExpired1) {
      return {
        attempt: 1,
        offers: top1.map((o) => this.toOfferSummary(o)),
      };
    }

    this.logger.warn(
      `getTop3FreshOffers: mindestens ein Offer expired beim ersten Versuch – neuer Duffel offer_requests Call`
    );

    // 2. Versuch
    const offers2 = await this.callOfferRequestsFromSearch(dto);
    const top2 = this.pickTop3WithExpiry(offers2);

    return {
      attempt: 2,
      offers: top2.map((o) => this.toOfferSummary(o)),
    };
  }
}

// apps/api/src/orders/orders.service.ts
import {
  Injectable,
  HttpException,
  BadRequestException,
  ConflictException,
  Logger,
} from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { PrismaService } from "../../prisma/prisma.service";
import { firstValueFrom } from "rxjs";
import { CreateOrderDto } from "./dto/create-order.dto";
import { RefundOrderDto } from "./dto/refund-order.dto";
import { randomBytes } from "crypto";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import {
  CreateOrderChangeRequestDto,
  ConfirmOrderChangeDto,
  ChangeSliceDto,
} from "./dto/order-change.dto";
import { createHash } from "crypto";
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  constructor(
    private readonly http: HttpService,
    private readonly prisma: PrismaService,
    @InjectQueue("eticket-poll") private readonly eticketQueue: Queue
  ) {}

  // -------- HELPERS --------
  private asDate(v?: string | null): Date | null {
    return v ? new Date(v) : null;
  }

  // private buildIdempotencyKey(dto: CreateOrderDto): string {
  //   // Wir normalisieren nur die Felder, die kaufrelevant sind.
  //   // Wichtig: KEIN timestamp hier, sonst wäre er wieder random.
  //   const canonical = {
  //     offerId: dto.offerId,
  //     passengers: dto.passengers.map((p) => ({
  //       id: p.id,
  //       type: p.type,
  //       title: p.title,
  //       given_name: p.given_name,
  //       family_name: p.family_name,
  //       born_on: p.born_on,
  //       gender: p.gender,
  //       email: p.email,
  //       phone_number: p.phone_number,
  //     })),
  //     payments: Array.isArray(dto.payments)
  //       ? dto.payments.map((pay) => ({
  //           type: pay.type,
  //           currency: pay.currency,
  //           amount: pay.amount,
  //         }))
  //       : [],
  //   };

  //   const raw = JSON.stringify(canonical);
  //   return createHash("sha256").update(raw).digest("hex");
  // }

  private buildIdempotencyKey(dto: CreateOrderDto, userId: string): string {
    const base = {
      userId,
      offerId: dto.offerId,
      passengers: (dto.passengers || [])
        .map((p) => ({
          id: p.id,
          type: p.type,
          title: p.title,
          given_name: p.given_name,
          family_name: p.family_name,
          born_on: p.born_on,
          gender: p.gender,
          email: p.email ?? null,
          phone_number: p.phone_number ?? null,
        }))
        // Stabilisieren: nach id sortieren
        .sort((a, b) => (a.id || "").localeCompare(b.id || "")),
      payments: (dto.payments || [])
        .map((x) => ({ type: x.type, currency: x.currency, amount: x.amount }))
        .sort((a, b) =>
          (a.type + a.currency + a.amount).localeCompare(
            b.type + b.currency + b.amount
          )
        ),
    };

    const json = JSON.stringify(base);
    return createHash("sha256").update(json).digest("hex");
  }

  private extractChangePolicy(order: any) {
    // Duffel liefert die Policy an zwei Stellen (pro Slice u./o. top-level)
    const top = order?.conditions?.change_before_departure;
    const fromSlices = Array.isArray(order?.slices)
      ? order.slices
          .map((s: any) => s?.conditions?.change_before_departure)
          .filter(Boolean)
      : [];

    // Wenn irgendeine Slice not-allowed ist, behandeln wir overall als not changeable.
    const all = [top, ...fromSlices].filter(Boolean);
    if (!all.length) return { allowed: false, reason: "no_policy" as const };

    const allowed = all.every((p: any) => p?.allowed === true);
    // Penalty konsolidieren (wenn uneinheitlich, geben wir 'mixed' zurück)
    const currencies = [
      ...new Set(
        all.map((p: any) => (p?.penalty_currency || "").toUpperCase())
      ),
    ].filter(Boolean);
    const amounts = [
      ...new Set(all.map((p: any) => String(p?.penalty_amount ?? ""))),
    ].filter(Boolean);

    return {
      allowed,
      penalty_currency: currencies.length === 1 ? currencies[0] : null,
      penalty_amount: amounts.length === 1 ? amounts[0] : null,
    };
  }

  async getChangePolicy(orderId: string) {
    const { data } = await firstValueFrom(this.http.get(`/orders/${orderId}`));
    const o = data?.data ?? data;
    if (!o?.id)
      return {
        ok: false,
        code: "order_not_found",
        message: `Order ${orderId} not found`,
      };

    const policy = this.extractChangePolicy(o);
    return {
      ok: true,
      order_id: o.id,
      type: o.type ?? null,
      policy,
      // nützlich: vorhandene Slice-IDs fürs UI/Test
      slices: Array.isArray(o.slices)
        ? o.slices.map((s: any, idx: number) => ({
            index: idx,
            id: s.id,
            origin: s.origin?.iata_code,
            destination: s.destination?.iata_code,
            departing_at: s.departing_at,
          }))
        : [],
    };
  }

  private resolveStatusFromDuffel(o: any): string | null {
    // Priorität: explicit, dann Ticket vorhanden → confirmed, sonst awaiting_payment → awaiting_payment
    if (o?.status) return String(o.status);
    if (
      Array.isArray(o?.documents) &&
      o.documents.some(
        (d: any) => String(d?.type).toLowerCase() === "electronic_ticket"
      )
    ) {
      return "confirmed";
    }
    if (o?.payment_status?.awaiting_payment === true) return "awaiting_payment";
    return null;
  }

  /** speichert elektronische Tickets stabil anhand unique_identifier */
  async persistTicketDocuments(
    duffelOrderId: string,
    docs: any[]
  ): Promise<number> {
    const list = Array.isArray(docs) ? docs : [];
    const eDocs = list.filter(
      (d) => String(d?.type ?? "").toLowerCase() === "electronic_ticket"
    );
    if (!eDocs.length) return 0;

    // Order-FK sichern
    let dbOrder = await this.prisma.order.findUnique({
      where: { duffelId: duffelOrderId },
      select: { id: true },
    });
    if (!dbOrder) {
      dbOrder = await this.prisma.order.create({
        data: {
          duffelId: duffelOrderId,
          offerId: "unknown",
          userId:
            (await this.prisma.user.findFirst({ select: { id: true } }))?.id ??
            (
              await this.prisma.user.create({
                data: {
                  email: "system@shamgateway.com",
                  password: "N/A",
                  role: "ADMIN" as any,
                },
                select: { id: true },
              })
            ).id,
          amount: "0",
          currency: "USD",
          status: null,
        },
        select: { id: true },
      });
    }

    let saved = 0;

    for (let i = 0; i < eDocs.length; i++) {
      const d = eDocs[i];

      // 1) Rohwert aus Duffel (kann bei Sandbox oft "1" sein)
      const uniqueIdRaw = d?.unique_identifier
        ? String(d.unique_identifier)
        : `${duffelOrderId}:${i + 1}`;

      // 2) Was wir normal speichern wollen (ohne Namespace; Composite-Unique soll das lösen)
      const uniqueId = uniqueIdRaw;

      // 3) Primär: Composite-Unique (orderId, uniqueId) verwenden
      try {
        await this.prisma.ticketDocument.upsert({
          where: { orderId_uniqueId: { orderId: dbOrder.id, uniqueId } },
          update: {
            type: d?.type ?? "electronic_ticket",
            url: d?.url ?? null,
          },
          create: {
            orderId: dbOrder.id,
            type: d?.type ?? "electronic_ticket",
            uniqueId,
            url: d?.url ?? null,
          },
        });
      } catch (e: any) {
        const msg = String(e?.message || e);
        // 3a) DB hat den Composite-Constraint noch nicht -> 42P10
        if (msg.includes("42P10")) {
          const syntheticId = `${dbOrder.id}:${uniqueIdRaw}`; // Primärschlüssel-UPSERT
          try {
            await this.prisma.ticketDocument.upsert({
              where: { id: syntheticId },
              update: {
                type: d?.type ?? "electronic_ticket",
                url: d?.url ?? null,
                uniqueId, // kann bei altem UNIQUE(uniqueId) kollidieren
              },
              create: {
                id: syntheticId,
                orderId: dbOrder.id,
                type: d?.type ?? "electronic_ticket",
                uniqueId,
                url: d?.url ?? null,
              },
            });
          } catch (e2: any) {
            const msg2 = String(e2?.message || e2);
            // 3b) Falls noch globales UNIQUE(uniqueId) existiert -> P2002 / duplicate key
            if (
              msg2.includes("P2002") ||
              msg2.toLowerCase().includes("unique constraint failed") ||
              msg2.includes("duplicate key")
            ) {
              const namespacedUniqueId = `${duffelOrderId}:${uniqueIdRaw}`; // sicher eindeutig je Order
              await this.prisma.ticketDocument.upsert({
                where: { id: syntheticId },
                update: {
                  type: d?.type ?? "electronic_ticket",
                  url: d?.url ?? null,
                  uniqueId: namespacedUniqueId,
                },
                create: {
                  id: syntheticId,
                  orderId: dbOrder.id,
                  type: d?.type ?? "electronic_ticket",
                  uniqueId: namespacedUniqueId,
                  url: d?.url ?? null,
                },
              });
            } else {
              throw e2;
            }
          }
        } else {
          throw e;
        }
      }

      saved += 1;
    }

    if (saved > 0) {
      await this.prisma.order.update({
        where: { duffelId: duffelOrderId },
        data: { status: "confirmed", eticketReady: true as any },
      });
    }

    return saved;
  }

  // -------- CREATE ORDER (Duffel-konform, sofort persistieren) --------
  async create(dto: CreateOrderDto, currentUserId: string) {
    // --- 0) Vorab-Checks ---
    if (!dto?.offerId) {
      throw new BadRequestException({
        code: "missing_offer_id",
        message: "offerId is required",
      });
    }
    if (!Array.isArray(dto?.passengers) || dto.passengers.length === 0) {
      throw new BadRequestException({
        code: "missing_passengers",
        message: "At least one passenger is required",
      });
    }

    // --- 1) Passengers für Duffel (nur erlaubte Felder) ---
    const duffelPassengers = dto.passengers.map((p) => ({
      id: p.id,
      type: p.type, // "adult" | "child" | ...
      gender: p.gender, // "m" | "f" | "x"
      title: p.title, // "mr" | "ms" | ...
      given_name: p.given_name,
      family_name: p.family_name,
      born_on: p.born_on, // "YYYY-MM-DD"
      email: p.email,
      phone_number: p.phone_number, // E.164
    }));

    // --- 2) Offer einlesen + Fähigkeiten/Policies ermitteln ---
    const { data: offerResp } = await firstValueFrom(
      this.http.get(`/offers/${dto.offerId}`)
    );
    const offer = offerResp?.data ?? offerResp;

    if (!offer?.id) {
      throw new BadRequestException({
        code: "offer_not_found",
        message: "Offer could not be loaded",
        offer_id: dto.offerId,
      });
    }

    const pr = offer?.payment_requirements ?? {};
    const requiresInstant = pr?.requires_instant_payment === true;

    // strikte Hold-Fähigkeit: Nur wenn Duffel uns eine Deadline nennt, kann man „hold“ machen
    const supportsHold = !requiresInstant && !!pr?.payment_required_by;

    // deine Changeability-Policy (Top + Slice) bleibt bestehen
    const policy = this.extractChangePolicy({
      conditions: offer?.conditions,
      slices: offer?.slices,
    });
    const isChangeable = !!policy?.allowed;

    // --- 3) Intent bestimmen + Guards ---
    const hasPayments = Array.isArray(dto.payments) && dto.payments.length > 0;
    const wantsHold = !hasPayments; // Keine payments => Kunde beabsichtigt Hold

    // Wenn Kunde Hold will, Offer aber nicht hold-fähig => sauber ablehnen
    if (wantsHold && !supportsHold) {
      throw new BadRequestException({
        code: "offer_not_holdable",
        message:
          "Dieses Angebot kann nicht auf 'Hold' gesetzt werden. Bitte ein hold-fähiges Angebot wählen.",
        offer_id: dto.offerId,
      });
    }

    // Wenn Kunde Instant will (payments geschickt), aber payments leer/fehlerhaft => ablehnen
    if (!wantsHold) {
      // payments müssen vollständig sein (type/currency/amount)
      for (const pay of dto.payments!) {
        if (!pay?.type || !pay?.currency || pay?.amount == null) {
          throw new BadRequestException({
            code: "instant_missing_payments",
            message:
              "Für 'instant' Bestellungen müssen gültige Zahlungen (type, currency, amount) mitgesendet werden.",
            offer_id: dto.offerId,
          });
        }
      }
    }

    // Optionaler Business-Guard (wie zuvor): wir verlangen explizit changeable
    if (!isChangeable) {
      throw new BadRequestException({
        code: "offer_not_changeable",
        message:
          "Dieses Angebot ist nicht änderbar. Bitte ein 'changeable' Angebot wählen.",
        offer_id: dto.offerId,
      });
    }

    // --- 4) Duffel-Body (type IMMER setzen; payments NUR bei instant senden) ---
    const paymentsPayload = !wantsHold
      ? dto.payments!.map((pay) => ({
          type: pay.type, // z.B. "balance"
          currency: String(pay.currency).toUpperCase(),
          amount: String(pay.amount),
        }))
      : undefined;

    const bodyData: any = {
      type: wantsHold ? "hold" : "instant",
      selected_offers: [dto.offerId],
      passengers: duffelPassengers,
    };
    if (paymentsPayload) {
      bodyData.payments = paymentsPayload; // nur bei instant; NIE leeres Array
    }
    const body = { data: bodyData };

    // --- 5) Robuster Idempotency-Key (an das finale Payload gebunden) ---
    const idem = this.buildRobustIdempotencyKey(
      currentUserId,
      dto.offerId,
      bodyData
    );

    // --- 6) Duffel call ---
    let o: any;
    try {
      const { data } = await firstValueFrom(
        this.http.post("/orders", body, {
          headers: { "Idempotency-Key": idem },
        })
      );
      o = data?.data ?? data;
    } catch (err: any) {
      throw new HttpException(
        err?.response?.data ?? err?.message ?? "Unknown error",
        err?.response?.status ?? 500
      );
    }

    if (!o?.id) {
      throw new BadRequestException("Duffel did not return an order");
    }

    // --- 7) Status/Type robust bestimmen (Sandbox kann beim type irren) ---
    const awaitingPayment = o?.payment_status?.awaiting_payment === true;
    const alreadyPaidAt = o?.payment_status?.paid_at ?? null;

    const inferredType: "instant" | "hold" =
      o?.type === "instant" || o?.type === "hold"
        ? o.type
        : awaitingPayment
        ? "hold"
        : "instant";

    const resolvedStatus = this.resolveStatusFromDuffel(o);

    // --- 8) DB upsert (nie hart failen, um Doppelbuchungen zu vermeiden) ---
    const dbData = {
      duffelId: String(o.id),
      offerId: String(o.offer_id ?? dto.offerId ?? "unknown"),
      userId: currentUserId,
      status: resolvedStatus,
      amount: String(o.total_amount ?? "0"),
      currency: String(o.total_currency ?? "USD"),
      owner: o?.owner?.iata_code ?? o?.owner?.name ?? null,
      liveMode: !!o.live_mode,
      paymentStatus: awaitingPayment
        ? "awaiting_payment"
        : alreadyPaidAt
        ? "succeeded"
        : null,
      paidAt: this.asDate(alreadyPaidAt),
      awaitingPayment: awaitingPayment
        ? true
        : o?.payment_status?.awaiting_payment === false
        ? false
        : null,
      paymentRequiredBy: this.asDate(o?.payment_status?.payment_required_by),
      priceGuaranteeExpiresAt: this.asDate(
        o?.payment_status?.price_guarantee_expires_at ??
          o?.price_guarantee_expires_at
      ),
      bookingRef: o?.booking_reference ?? null,
      documents: Array.isArray(o?.documents) ? (o.documents as any) : null,
      segments: Array.isArray(o?.slices) ? (o.slices as any) : null,
      passengers: Array.isArray(o?.passengers) ? (o.passengers as any) : null,
      lastEventType: "order.created",
      idempotencyKey: idem as any,
    };

    try {
      await this.prisma.order.upsert({
        where: { duffelId: o.id },
        create: dbData as any,
        update: dbData as any,
      });

      if (Array.isArray(o?.documents) && o.documents.length > 0) {
        await this.persistTicketDocuments(o.id, o.documents).catch((e) => {
          this.logger.warn(
            `persistTicketDocuments failed for ${o.id}: ${e?.message ?? e}`
          );
        });
      }
    } catch (dbErr: any) {
      this.logger.error(
        `DB upsert failed for Duffel order ${o.id}: ${dbErr?.message ?? dbErr}`
      );
      // absichtlich kein throw, Order existiert bereits bei Duffel
    }

    // --- 9) eTicket-Poller (idempotent enqueue) ---
    try {
      await this.eticketQueue.add(
        "poll",
        { orderId: o.id, attempt: 1 },
        {
          jobId: `poll-${o.id}`,
          delay: 3000,
          removeOnComplete: true,
          removeOnFail: true,
        }
      );
    } catch (qErr) {
      this.logger.warn(
        `eticket-poll enqueue failed for ${o.id}: ${qErr as any}`
      );
    }

    // --- 10) Klare Antwort ---
    return {
      order_id: o.id,
      status: resolvedStatus ?? "unknown",
      order_type: inferredType, // "instant" | "hold"
      awaiting_payment: awaitingPayment,
      paid_at: alreadyPaidAt ?? null,
      total_amount: String(o.total_amount ?? "0"),
      total_currency: String(o.total_currency ?? "USD"),
      owner: o?.owner?.iata_code ?? o?.owner?.name ?? null,
      live_mode: !!o.live_mode,
    };
  }

  /** Robuster Idempotency-Key, der an das finale Payload (data) gebunden ist */
  private buildRobustIdempotencyKey(
    userId: string,
    offerId: string,
    data: any
  ): string {
    // deterministische String-Repräsentation (Keys bereits deterministisch gesetzt)
    const json = JSON.stringify(data);
    const hash = require("crypto")
      .createHash("sha256")
      .update(json)
      .digest("hex");
    return `order:${userId}:${offerId}:${hash}`;
  }

  // ---- List my orders (from DB) ----
  async listMine(userId: string) {
    return this.prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  // ---- Get one order from Duffel ----
  async getOne(orderId: string) {
    try {
      const { data } = await firstValueFrom(
        this.http.get(`/orders/${orderId}`)
      );
      return data?.data ?? data;
    } catch (err: any) {
      throw new HttpException(
        err?.response?.data ?? err,
        err?.response?.status ?? 500
      );
    }
  }

  // ---- Cancellation: create quote ----
  async createCancellationQuote(
    orderId: string,
    userId: string,
    reason?: string
  ) {
    try {
      const { data } = await firstValueFrom(
        this.http.post(`/order_cancellations`, {
          data: { order_id: orderId, reason },
        })
      );
      const quote = data?.data ?? data;

      // optional: persist lightweight cancellation meta
      await this.prisma.orderCancellation.upsert({
        where: { duffelCancellationId: quote.id },
        update: {
          refundAmount: quote.refund_amount ?? null,
          refundCurrency: quote.refund_currency ?? null,
          refundTo: quote.refund_to ?? null,
          expiresAt: quote.expires_at ? new Date(quote.expires_at) : null,
          confirmedAt: quote.confirmed_at ? new Date(quote.confirmed_at) : null,
          liveMode: !!quote.live_mode,
        },
        create: {
          duffelCancellationId: quote.id,
          orderDuffelId: orderId,
          refundAmount: quote.refund_amount ?? null,
          refundCurrency: quote.refund_currency ?? null,
          refundTo: quote.refund_to ?? null,
          expiresAt: quote.expires_at ? new Date(quote.expires_at) : null,
          confirmedAt: quote.confirmed_at ? new Date(quote.confirmed_at) : null,
          liveMode: !!quote.live_mode,
        },
      });

      return quote;
    } catch (err: any) {
      throw new HttpException(
        err?.response?.data ?? err,
        err?.response?.status ?? 500
      );
    }
  }

  // ---- Cancellation: confirm ----
  async confirmCancellation(cancellationId: string, userId: string) {
    try {
      const { data } = await firstValueFrom(
        this.http.post(
          `/order_cancellations/${cancellationId}/actions/confirm`,
          { data: {} }
        )
      );
      const confirmed = data?.data ?? data;

      await this.prisma.orderCancellation.update({
        where: { duffelCancellationId: cancellationId },
        data: {
          confirmedAt: confirmed.confirmed_at
            ? new Date(confirmed.confirmed_at)
            : new Date(),
        },
      });

      return confirmed;
    } catch (err: any) {
      throw new HttpException(
        err?.response?.data ?? err,
        err?.response?.status ?? 500
      );
    }
  }

  // ---- simple refund wrapper (optional) ----
  async refund(_dto: RefundOrderDto, orderId: string) {
    // Duffel v2 behandelt Refunds über order_cancellations (Quote + confirm).
    // Diese Methode kann einen 2-Schritt-Wrapper darstellen, falls gewünscht.
    throw new BadRequestException(
      "Use /orders/:id/cancel (quote) then confirm to refund if refundable."
    );
  }

  // ---- Cancellation: get one by id ----
  async getCancellation(cancellationId: string) {
    try {
      const { data } = await firstValueFrom(
        this.http.get(`/order_cancellations/${cancellationId}`)
      );
      return data?.data ?? data;
    } catch (err: any) {
      throw new HttpException(
        err?.response?.data ?? err?.message ?? "Unknown error",
        err?.response?.status ?? 500
      );
    }
  }

  // ---- List Duffel orders (optional helper; nicht deine DB, sondern /air/orders) ----
  async listDuffelOrders(query?: { after?: string; limit?: number }) {
    try {
      const { data } = await firstValueFrom(
        this.http.get(`/orders`, { params: query ?? {} })
      );
      // Wichtig: Meta/Links können für Pagination nötig sein;
      // falls du nur "data" willst, kannst du hier auch "data?.data ?? data" zurückgeben.
      return data;
    } catch (err: any) {
      throw new HttpException(
        err?.response?.data ?? err?.message ?? "Unknown error",
        err?.response?.status ?? 500
      );
    }
  }

  async persistAirlineChange(duffelOrderId: string, payload: any) {
    await this.prisma.orderScheduleChange.create({
      data: {
        orderId: (
          await this.prisma.order.findUnique({
            where: { duffelId: duffelOrderId },
            select: { id: true },
          })
        )?.id!,
        payload,
      },
    });
    // TODO: Notify User/Backoffice
  }

  async markCancellation(event: "created" | "confirmed", data: any) {
    const id = data?.id;
    if (!id) return;
    if (event === "created") {
      await this.prisma.orderCancellation.upsert({
        where: { duffelCancellationId: id },
        update: {
          refundAmount: data.refund_amount ?? null,
          refundCurrency: data.refund_currency ?? null,
          refundTo: data.refund_to ?? null,
          expiresAt: data.expires_at ? new Date(data.expires_at) : null,
          liveMode: !!data.live_mode,
        },
        create: {
          duffelCancellationId: id,
          orderDuffelId: data.order_id,
          refundAmount: data.refund_amount ?? null,
          refundCurrency: data.refund_currency ?? null,
          refundTo: data.refund_to ?? null,
          expiresAt: data.expires_at ? new Date(data.expires_at) : null,
          liveMode: !!data.live_mode,
        },
      });
    } else {
      await this.prisma.orderCancellation
        .update({
          where: { duffelCancellationId: id },
          data: {
            confirmedAt: data.confirmed_at
              ? new Date(data.confirmed_at)
              : new Date(),
          },
        })
        .catch(() => {});
      await this.prisma.order
        .update({
          where: { duffelId: data.order_id },
          data: { status: "cancelled", paymentStatus: "cancelled" }, // ⬅️ NEU
        })
        .catch(() => {});
    }
  }

  /** Markiert DB-Order als eTicket-bereit (Status optional setzen). */
  async markEticketReady(duffelOrderId: string, status?: string) {
    await this.prisma.order.update({
      where: { duffelId: duffelOrderId },
      data: { eticketReady: true as any, ...(status ? { status } : {}) },
    });
  }

  // --- helper: pre-check (nicht zwingend, aber nice)
  async isOrderChangeable(orderId: string) {
    const { data } = await firstValueFrom(this.http.get(`/orders/${orderId}`));
    const o = data?.data ?? data;
    const allowed = !!o?.conditions?.change_before_departure?.allowed;
    return {
      ok: true,
      order_id: orderId,
      change_allowed: allowed,
      penalty: {
        amount: o?.conditions?.change_before_departure?.penalty_amount ?? null,
        currency:
          o?.conditions?.change_before_departure?.penalty_currency ?? null,
      },
      raw: o,
    };
  }

  // --- v2 step 1: create order_change_request (quote)
  // async createOrderChangeRequest(
  //   orderId: string,
  //   dto: CreateOrderChangeRequestDto
  // ) {
  //   const toSlice = (s: ChangeSliceDto) =>
  //     s.slice_id
  //       ? { slice_id: s.slice_id }
  //       : {
  //           origin: s.origin,
  //           destination: s.destination,
  //           departure_date: s.departure_date,
  //         };

  //   const body: any = { data: { order_id: orderId } };
  //   if (dto.slices) {
  //     body.data.slices = {};
  //     if (dto.slices.add?.length)
  //       body.data.slices.add = dto.slices.add.map(toSlice);
  //     if (dto.slices.remove?.length)
  //       body.data.slices.remove = dto.slices.remove.map(toSlice);
  //   }
  //   if (dto.services?.length) body.data.services = dto.services;

  //   try {
  //     const { data } = await firstValueFrom(
  //       this.http.post(`/order_change_requests`, body)
  //     );
  //     const req = data?.data ?? data;

  //     // optional: leicht in DB merken (nur IDs/Beträge)
  //     await this.prisma.orderChangeRequest
  //       ?.upsert?.({
  //         where: { duffelRequestId: req.id },
  //         update: {
  //           orderDuffelId: orderId,
  //           liveMode: !!req.live_mode,
  //           expiresAt: req.expires_at ? new Date(req.expires_at) : null,
  //         },
  //         create: {
  //           duffelRequestId: req.id,
  //           orderDuffelId: orderId,
  //           liveMode: !!req.live_mode,
  //           expiresAt: req.expires_at ? new Date(req.expires_at) : null,
  //         },
  //       })
  //       .catch(() => {});

  //     return {
  //       ok: true,
  //       order_change_request_id: req.id, // req_...
  //       expires_at: req.expires_at ?? null,
  //       // Manche Duffel-Accounts liefern Offers inline in req; sonst leer:
  //       offers_inline: req.order_change_offers ?? [],
  //       raw: req,
  //     };
  //   } catch (err: any) {
  //     return {
  //       ok: false,
  //       code: "change_request_failed",
  //       message:
  //         err?.response?.data?.error ??
  //         err?.message ??
  //         "Order change request failed",
  //       details: err?.response?.data ?? null,
  //     };
  //   }
  // }

  async createOrderChangeRequest(
    orderId: string,
    dto: CreateOrderChangeRequestDto
  ) {
    const toSlice = (s: ChangeSliceDto) =>
      s.slice_id
        ? { slice_id: s.slice_id }
        : {
            origin: s.origin,
            destination: s.destination,
            departure_date: s.departure_date,
          };

    const body: any = { data: { order_id: orderId } };
    if (dto.slices) {
      body.data.slices = {};
      if (dto.slices.add?.length)
        body.data.slices.add = dto.slices.add.map(toSlice);
      if (dto.slices.remove?.length)
        body.data.slices.remove = dto.slices.remove.map(toSlice);
    }
    if (dto.services?.length) body.data.services = dto.services;

    try {
      const { data } = await firstValueFrom(
        this.http.post(`/order_change_requests`, body)
      );
      const req = data?.data ?? data;

      // 🔸 Minimal persistieren (Option-B)
      await this.prisma.orderChangeRequest.upsert({
        where: { duffelRequestId: req.id },
        update: {
          orderDuffelId: orderId,
          liveMode: !!req.live_mode,
          expiresAt: req.expires_at ? new Date(req.expires_at) : null,
          raw: req,
        },
        create: {
          duffelRequestId: req.id,
          orderDuffelId: orderId,
          liveMode: !!req.live_mode,
          expiresAt: req.expires_at ? new Date(req.expires_at) : null,
          raw: req,
        },
      });

      return {
        ok: true,
        order_change_request_id: req.id,
        expires_at: req.expires_at ?? null,
        offers_inline: Array.isArray(req.order_change_offers)
          ? req.order_change_offers
          : [],
        raw: req,
      };
    } catch (err: any) {
      return {
        ok: false,
        code: "change_request_failed",
        message:
          err?.response?.data?.error ??
          err?.message ??
          "Order change request failed",
        details: err?.response?.data ?? null,
      };
    }
  }

  // --- v2 step 2: list order_change_offers for a request
  // async listOrderChangeOffers(
  //   order_change_request_id: string,
  //   query?: { after?: string; limit?: number }
  // ) {
  //   try {
  //     const { data } = await firstValueFrom(
  //       this.http.get(`/order_change_offers`, {
  //         params: { order_change_request_id, ...(query ?? {}) },
  //       })
  //     );
  //     const res = data?.data ?? data;
  //     return {
  //       ok: true,
  //       order_change_request_id,
  //       offers: Array.isArray(res) ? res : res?.order_change_offers ?? [],
  //       raw: res,
  //     };
  //   } catch (err: any) {
  //     return {
  //       ok: false,
  //       code: "offers_list_failed",
  //       message:
  //         err?.response?.data?.error ??
  //         err?.message ??
  //         "Order change offers list failed",
  //       details: err?.response?.data ?? null,
  //     };
  //   }
  // }

  async listOrderChangeOffers(
    order_change_request_id: string,
    query?: { after?: string; limit?: number }
  ) {
    try {
      const { data } = await firstValueFrom(
        this.http.get(`/order_change_offers`, {
          params: { order_change_request_id, ...(query ?? {}) },
        })
      );
      const payload = data?.data ?? data;
      const offers: any[] = Array.isArray(payload)
        ? payload
        : payload?.order_change_offers ?? [];

      // 🔸 Offers in DB spiegeln (Option-B)
      for (const off of offers) {
        await this.prisma.orderChangeOffer.upsert({
          where: { duffelOfferId: off.id },
          update: {
            requestDuffelId: order_change_request_id,
            penaltyAmount: off.penalty_total_amount ?? null,
            penaltyCurrency: off.penalty_total_currency ?? null,
            changeTotalAmount: off.change_total_amount ?? null,
            changeTotalCurrency: off.change_total_currency ?? null,
            newTotalAmount: off.new_total_amount ?? null,
            newTotalCurrency: off.new_total_currency ?? null,
            availablePaymentTypes: Array.isArray(off.available_payment_types)
              ? off.available_payment_types
              : [],
            raw: off,
          },
          create: {
            duffelOfferId: off.id,
            requestDuffelId: order_change_request_id,
            penaltyAmount: off.penalty_total_amount ?? null,
            penaltyCurrency: off.penalty_total_currency ?? null,
            changeTotalAmount: off.change_total_amount ?? null,
            changeTotalCurrency: off.change_total_currency ?? null,
            newTotalAmount: off.new_total_amount ?? null,
            newTotalCurrency: off.new_total_currency ?? null,
            availablePaymentTypes: Array.isArray(off.available_payment_types)
              ? off.available_payment_types
              : [],
            raw: off,
          },
        });
      }

      return {
        ok: true,
        order_change_request_id,
        count: offers.length,
        offers,
        raw: payload,
      };
    } catch (err: any) {
      return {
        ok: false,
        code: "offers_list_failed",
        message:
          err?.response?.data?.error ??
          err?.message ??
          "Order change offers list failed",
        details: err?.response?.data ?? null,
      };
    }
  }

  // --- v2 step 3: confirm (creates /air/order_changes)
  // async confirmOrderChange(dto: ConfirmOrderChangeDto) {
  //   const payload: any = {
  //     data: {
  //       order_change_request_id: dto.order_change_request_id,
  //       selected_order_change_offer: dto.selected_order_change_offer,
  //       ...(dto.payments?.length ? { payments: dto.payments } : {}),
  //     },
  //   };

  //   try {
  //     const { data } = await firstValueFrom(
  //       this.http.post(`/order_changes`, payload)
  //     );
  //     const confirmed = data?.data ?? data;

  //     // optional DB update + eTicket poll
  //     if (confirmed?.order_id) {
  //       await this.prisma.order
  //         .update({
  //           where: { duffelId: confirmed.order_id },
  //           data: { status: "confirmed", lastEventType: "order.changed" },
  //         })
  //         .catch(() => {});
  //       await this.eticketQueue
  //         .add(
  //           "poll",
  //           { orderId: confirmed.order_id, attempt: 1 },
  //           {
  //             jobId: `poll:${confirmed.order_id}`,
  //             delay: 3000,
  //             removeOnComplete: true,
  //             removeOnFail: true,
  //           }
  //         )
  //         .catch(() => {});
  //     }

  //     return {
  //       ok: true,
  //       change_id: confirmed.id, // ocr_...
  //       order_id: confirmed.order_id ?? null,
  //       confirmed_at: confirmed.confirmed_at ?? new Date().toISOString(),
  //       new_total_amount: confirmed.new_total_amount ?? null,
  //       new_total_currency: confirmed.new_total_currency ?? null,
  //       penalty_amount: confirmed.penalty_total_amount ?? null,
  //       penalty_currency: confirmed.penalty_total_currency ?? null,
  //       raw: confirmed,
  //     };
  //   } catch (err: any) {
  //     return {
  //       ok: false,
  //       code: "change_confirm_failed",
  //       message:
  //         err?.response?.data?.error ??
  //         err?.message ??
  //         "Order change confirmation failed",
  //       details: err?.response?.data ?? null,
  //     };
  //   }
  // }

  // dto: { order_change_request_id: string; selected_order_change_offer: string; payments?: [...] }
  async confirmOrderChange(dto: ConfirmOrderChangeDto) {
    const payload: any = {
      data: {
        order_change_request_id: dto.order_change_request_id,
        selected_order_change_offer: dto.selected_order_change_offer,
        ...(dto.payments?.length ? { payments: dto.payments } : {}),
      },
    };

    try {
      const { data } = await firstValueFrom(
        this.http.post(`/order_changes`, payload)
      );
      const confirmed = data?.data ?? data;

      // 🔸 Persist Change (Option-B)
      await this.prisma.orderChange.upsert({
        where: { duffelChangeId: confirmed.id },
        update: {
          orderDuffelId: confirmed.order_id ?? null,
          requestDuffelId: dto.order_change_request_id,
          offerDuffelId: dto.selected_order_change_offer,
          penaltyAmount: confirmed.penalty_total_amount ?? null,
          penaltyCurrency: confirmed.penalty_total_currency ?? null,
          changeTotalAmount: confirmed.change_total_amount ?? null,
          changeTotalCurrency: confirmed.change_total_currency ?? null,
          newTotalAmount: confirmed.new_total_amount ?? null,
          newTotalCurrency: confirmed.new_total_currency ?? null,
          confirmedAt: confirmed.confirmed_at
            ? new Date(confirmed.confirmed_at)
            : new Date(),
          raw: confirmed,
        },
        create: {
          duffelChangeId: confirmed.id,
          orderDuffelId: confirmed.order_id ?? null,
          requestDuffelId: dto.order_change_request_id,
          offerDuffelId: dto.selected_order_change_offer,
          penaltyAmount: confirmed.penalty_total_amount ?? null,
          penaltyCurrency: confirmed.penalty_total_currency ?? null,
          changeTotalAmount: confirmed.change_total_amount ?? null,
          changeTotalCurrency: confirmed.change_total_currency ?? null,
          newTotalAmount: confirmed.new_total_amount ?? null,
          newTotalCurrency: confirmed.new_total_currency ?? null,
          confirmedAt: confirmed.confirmed_at
            ? new Date(confirmed.confirmed_at)
            : new Date(),
          raw: confirmed,
        },
      });

      // 🔸 kleine DB-Order-Infos aktualisieren & eTicket-Poller
      if (confirmed?.order_id) {
        await this.prisma.order
          .update({
            where: { duffelId: confirmed.order_id },
            data: { status: "confirmed", lastEventType: "order.changed" },
          })
          .catch(() => {});

        await this.eticketQueue
          .add(
            "poll",
            { orderId: confirmed.order_id, attempt: 1 },
            {
              jobId: `poll:${confirmed.order_id}`,
              delay: 3000,
              removeOnComplete: true,
              removeOnFail: true,
            }
          )
          .catch(() => {});
      }

      return {
        ok: true,
        change_id: confirmed.id,
        order_id: confirmed.order_id ?? null,
        confirmed_at: confirmed.confirmed_at ?? new Date().toISOString(),
        new_total_amount: confirmed.new_total_amount ?? null,
        new_total_currency: confirmed.new_total_currency ?? null,
        penalty_amount: confirmed.penalty_total_amount ?? null,
        penalty_currency: confirmed.penalty_total_currency ?? null,
        raw: confirmed,
      };
    } catch (err: any) {
      return {
        ok: false,
        code: "change_confirm_failed",
        message:
          err?.response?.data?.error ??
          err?.message ??
          "Order change confirmation failed",
        details: err?.response?.data ?? null,
      };
    }
  }
}

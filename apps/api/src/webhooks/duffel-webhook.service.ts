import { Injectable, Logger } from "@nestjs/common";
import * as crypto from "crypto";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { PrismaService } from "../../prisma/prisma.service";
import type { DuffelWebhook } from "./duffel.types";

@Injectable()
export class DuffelWebhookService {
  private readonly logger = new Logger(DuffelWebhookService.name);
  private readonly secret = Buffer.from(
    process.env.DUFFEL_WEBHOOK_SECRET ?? "",
    "utf8"
  );

  constructor(
    @InjectQueue("duffel-webhooks") private readonly queue: Queue,
    private readonly prisma: PrismaService
  ) {}

  verifySignature(header: string, rawBody: Buffer): boolean {
    try {
      // Header-Beispiel: "t=1699999999,v1=abc...,v2=def..."
      const pairs = header.split(",").map((s) => s.trim().split("="));
      const map = Object.fromEntries(pairs);

      const t = map["t"];
      // v1 bevorzugen; wenn nicht vorhanden, nimm erstes v{num}
      let providedSig = map["v1"];
      if (!providedSig) {
        const anyV = pairs.find(
          ([k, v]) => /^v\d+$/.test(k) && v && v.length > 0
        );
        providedSig = anyV?.[1];
      }
      if (!t || !providedSig) return false;

      const msg = Buffer.concat([
        Buffer.from(String(t)),
        Buffer.from("."),
        rawBody,
      ]);

      const secretRaw = (process.env.DUFFEL_WEBHOOK_SECRET || "").trim();
      if (!secretRaw) return false;

      const safeEq = (a: string, b: string) => {
        try {
          return crypto.timingSafeEqual(
            Buffer.from(a, "utf8"),
            Buffer.from(b, "utf8")
          );
        } catch {
          return false;
        }
      };

      // A) Secret als UTF-8
      const hmacUtf8 = crypto
        .createHmac("sha256", Buffer.from(secretRaw, "utf8"))
        .update(msg)
        .digest("hex");
      if (safeEq(hmacUtf8, providedSig)) return true;

      // B) Secret Base64-decodiert
      try {
        const kB64 = Buffer.from(secretRaw, "base64");
        if (kB64.length) {
          const hmacB64 = crypto
            .createHmac("sha256", kB64)
            .update(msg)
            .digest("hex");
          if (safeEq(hmacB64, providedSig)) return true;
        }
      } catch {}

      // C) URL-safe Base64 ( -/_ ; evtl. ohne Padding)
      try {
        let norm = secretRaw.replace(/-/g, "+").replace(/_/g, "/");
        while (norm.length % 4) norm += "=";
        const kB64u = Buffer.from(norm, "base64");
        if (kB64u.length) {
          const hmacB64u = crypto
            .createHmac("sha256", kB64u)
            .update(msg)
            .digest("hex");
          if (safeEq(hmacB64u, providedSig)) return true;
        }
      } catch {}

      console.warn("[Duffel] signature mismatch", {
        gotPrefix: providedSig.slice(0, 8),
        t,
        rawLen: rawBody.length,
      });
      return false;
    } catch (e) {
      console.error("[Duffel] verify error", e);
      return false;
    }
  }

  async enqueueAndPersist(event: DuffelWebhook, signature: string) {
    // Audit (dupes ok)
    try {
      await this.prisma.webhookEvent.create({
        data: {
          id: event.id,
          type: event.type,
          idempotencyKey: event.idempotency_key ?? null,
          apiVersion: event.api_version ?? "v2",
          liveMode: !!event.live_mode,
          createdAtRemote: event.created_at
            ? new Date(event.created_at)
            : new Date(),
          raw: event as any,
        },
      });
    } catch {
      /* duplicate okay */
    }

    await this.queue.add("process", event as any, {
      // jobId: event.id,
      removeOnComplete: 500,
      removeOnFail: 500,
    });
  }
}

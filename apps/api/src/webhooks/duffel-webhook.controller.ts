// apps/api/src/modules/webhooks/duffel-webhook.controller.ts
import {
  Controller,
  Post,
  Req,
  Res,
  Headers,
  HttpCode,
  UnauthorizedException,
} from "@nestjs/common";
import { Request, Response } from "express";
import { DuffelWebhookService } from "./duffel-webhook.service";

@Controller("webhooks/duffel")
export class DuffelWebhookController {
  constructor(private readonly service: DuffelWebhookService) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Req() req: Request,
    @Res() res: Response,
    @Headers("x-duffel-signature") signature?: string
  ) {
    const raw: Buffer = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(req.body ?? "");
    const devBypass =
      process.env.DUFFEL_WEBHOOK_DEV_ACCEPT_UNVERIFIED === "true";

    if (!signature) {
      if (devBypass) {
        console.warn(
          "[Duffel] Missing signature but accepting due to DEV flag"
        );
      } else {
        throw new UnauthorizedException("Missing signature");
      }
    } else {
      const ok = this.service.verifySignature(signature, raw);
      if (!ok && !devBypass) {
        throw new UnauthorizedException("Invalid signature");
      }
      if (!ok && devBypass) {
        console.warn(
          "[Duffel] Invalid signature but accepting due to DEV flag"
        );
      }
    }

    // Nur für Diagnose:
    console.log(
      "[Duffel] hit /webhooks/duffel",
      "sig:",
      signature?.slice(0, 16),
      "bytes:",
      raw.length
    );

    const event = JSON.parse(raw.toString("utf8"));
    await this.service.enqueueAndPersist(event, signature ?? "");
    return res.send({ ok: true });
  }
}

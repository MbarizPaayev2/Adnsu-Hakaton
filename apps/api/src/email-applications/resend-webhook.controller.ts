import { BadRequestException, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { DeliveryEvidenceService } from './delivery-evidence.service';

/**
 * Provider webhooks. There is no session: the Svix signature over the exact raw
 * bytes is the only credential. main.ts mounts the raw body parser for this path.
 */
@Controller('webhooks')
export class ResendWebhookController {
  constructor(private readonly evidence: DeliveryEvidenceService) {}

  @Post('resend')
  @HttpCode(200)
  @SkipThrottle()
  async receive(@Req() req: Request & { body: unknown; rawBody?: Buffer }) {
    // main.ts mounts a raw parser for this path; test apps use Nest's rawBody option. Parsed JSON is never signed bytes.
    const raw = Buffer.isBuffer(req.body) ? req.body : req.rawBody;
    if (!raw || !Buffer.isBuffer(raw)) throw new BadRequestException('Raw body required');
    const outcome = await this.evidence.handle(raw, {
      id: req.header('svix-id') ?? undefined,
      timestamp: req.header('svix-timestamp') ?? undefined,
      signature: req.header('svix-signature') ?? undefined,
    });
    return { received: true, outcome };
  }
}

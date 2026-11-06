import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { SkipThrottle } from '@nestjs/throttler';
import { Queue } from 'bullmq';
import type { Response } from 'express';
import { PrismaService } from '../database/database.service';

const TIMEOUT_MS = 2000;

function within<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS))]);
}

/**
 * Public probes for the deploy script, the reverse proxy and uptime
 * monitoring. They reveal only up/down per dependency and the short release
 * SHA — no hosts, versions, counts or error text (the operator view with
 * details is /admin/system).
 */
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('job-ingested') private queue: Queue,
  ) {}

  /** The process is up. */
  @Get('live')
  @HttpCode(200)
  live() {
    return { status: 'ok' };
  }

  /** Ready to serve: database and Redis answer. 503 otherwise. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const [database, redis] = await Promise.all([
      within(this.prisma.$queryRaw`SELECT 1`).then(() => true, () => false),
      within(this.queue.client.then((c) => (c as unknown as { ping(): Promise<string> }).ping())).then(() => true, () => false),
    ]);
    const ok = database && redis;
    res.status(ok ? 200 : 503);
    return {
      status: ok ? 'ok' : 'unavailable',
      checks: { database: database ? 'ok' : 'fail', redis: redis ? 'ok' : 'fail' },
      release: (process.env.RELEASE_SHA || '').slice(0, 12) || null,
    };
  }
}

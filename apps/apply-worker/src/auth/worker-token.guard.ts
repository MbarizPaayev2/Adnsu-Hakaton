import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Mirrors apps/api's ApiKeyGuard (see apps/api/src/jobs/api-key.guard.ts), with
 * one deliberate difference: if APPLY_WORKER_TOKEN is unset, this guard fails
 * CLOSED (rejects every request) rather than allowing requests through. This
 * service drives a real browser filling in real users' PII (ID photos, phone
 * numbers, addresses) on glorri.az, so it must never be reachable unauthenticated.
 */
@Injectable()
export class WorkerTokenGuard implements CanActivate {
  constructor(private configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expectedToken = this.configService.get<string>('APPLY_WORKER_TOKEN');

    if (!expectedToken) {
      throw new UnauthorizedException('Service token is not configured');
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid service token');
    }

    const token = authHeader.split(' ')[1];

    if (!safeEqual(token, expectedToken)) {
      throw new UnauthorizedException('Invalid service token');
    }

    return true;
  }
}

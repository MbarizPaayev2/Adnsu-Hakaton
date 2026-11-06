import { Controller, Get } from '@nestjs/common';

// Deliberately unguarded and outside SessionsController: a bare liveness probe
// for container orchestration (docker-compose healthcheck, etc). It exposes no
// PII and no session state, so it doesn't need the worker token.
@Controller()
export class AppController {
  @Get('health')
  health() {
    return { ok: true };
  }
}

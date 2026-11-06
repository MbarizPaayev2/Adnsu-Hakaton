import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PostHog } from 'posthog-node';

// Server-side pipeline monitoring: lets the team see in PostHog whether the
// actual background pipeline (ingestion -> matching -> notification,
// applications, billing) is producing events during testing, not just
// whether individual HTTP requests succeed. Mirrors EmailService's
// mock-key convention — a missing/placeholder key no-ops instead of
// throwing, so this never blocks local dev or CI.
@Injectable()
export class PostHogService implements OnModuleDestroy {
  private client: PostHog | null = null;

  constructor() {
    const apiKey = process.env.POSTHOG_API_KEY;
    if (!apiKey || apiKey.includes('mock')) {
      console.log('[POSTHOG MOCK] No POSTHOG_API_KEY configured — server-side events will be logged, not sent.');
      return;
    }

    this.client = new PostHog(apiKey, {
      host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
    });
  }

  capture(distinctId: string, event: string, properties?: Record<string, unknown>): void {
    if (!this.client) {
      console.log(`[POSTHOG MOCK] ${event}`, { distinctId, ...properties });
      return;
    }
    this.client.capture({ distinctId, event, properties });
  }

  async onModuleDestroy() {
    await this.client?.shutdown();
  }
}

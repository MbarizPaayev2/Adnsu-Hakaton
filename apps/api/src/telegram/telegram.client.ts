import { Injectable } from '@nestjs/common';
import { telegramConfig } from './telegram.config';

/** The only code that talks to api.telegram.org. Tests replace it; with the adapter disabled it never performs a request. */
@Injectable()
export class TelegramClient {
  async sendMessage(chatId: string, text: string): Promise<void> {
    const cfg = telegramConfig();
    if (!cfg.enabled) throw Object.assign(new Error('telegram disabled'), { code: 'telegram_disabled' });
    const res = await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw Object.assign(new Error('telegram send failed'), { code: `telegram_${res.status}` });
  }
}

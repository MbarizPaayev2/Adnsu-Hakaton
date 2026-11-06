import type { ThrottlerModuleOptions } from '@nestjs/throttler';

/** Rate-limit message in the product's language: pages show the API's message as is, and the library default reached candidates in English. */
export function rateLimitMessage(waitSeconds: number): string {
  return `Qısa müddətdə çox sorğu göndərildi. ${Math.max(1, Math.ceil(waitSeconds || 0))} saniyə sonra yenidən cəhd edin.`;
}

export const throttleOptions: ThrottlerModuleOptions = {
  throttlers: [{ name: 'default', ttl: 60_000, limit: 60 }],
  errorMessage: (_context, detail) => rateLimitMessage(detail.isBlocked ? detail.timeToBlockExpire : detail.timeToExpire),
};

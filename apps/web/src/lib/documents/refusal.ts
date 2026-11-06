import { formatBakuDateTime } from './baku-date';

/** What the server says when a generation cannot start (quote.refusal, or the body of a 402/429). Never invented client-side. */
export interface QuoteRefusal {
  code?: 'ALLOWANCE_EXHAUSTED' | 'CONCURRENCY_LIMIT' | 'HOURLY_LIMIT' | string;
  limit?: number | null;
  remaining?: number | null;
  resetsAt?: string;
  concurrent?: number;
  perHour?: number;
  message?: string;
}

/**
 * Wording per refusal: a monthly allowance that is used up (with the reset time), versus a short protection that clears by itself — those must never be
 * described as "your allowance is finished" or answered with "upgrade your plan".
 */
export function refusalMessage(refusal: QuoteRefusal | null | undefined): string {
  switch (refusal?.code) {
    case 'ALLOWANCE_EXHAUSTED': {
      const when = formatBakuDateTime(refusal.resetsAt);
      return `Bu ay üçün sənəd generasiya limitiniz çatmır${when ? `; limit ${when} (Bakı vaxtı) tarixində yenilənir` : ''}. Mövcud sənədləri redaktə etmək, yükləmək və təsdiqləmək ödənişsizdir.`;
    }
    case 'CONCURRENCY_LIMIT':
      return `Eyni anda ən çox ${refusal.concurrent ?? 3} sənəd hazırlana bilər. Biri bitəndən sonra yenidən cəhd edin; bu aylıq limit deyil.`;
    case 'HOURLY_LIMIT':
      return `Saatda ən çox ${refusal.perHour ?? 30} sənəd hazırlana bilər. Bir az sonra yenidən cəhd edin; bu aylıq limit deyil.`;
    default:
      return refusal?.message || 'Hazırda sənəd generasiyası başladıla bilmir.';
  }
}

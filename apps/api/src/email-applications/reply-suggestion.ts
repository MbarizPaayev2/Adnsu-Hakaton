import type { RecruitmentState } from '@prisma/client';

/**
 * A deterministic reading of a reply's subject line (no model, no purchase). It only ever
 * SUGGESTS a stage; the candidate confirms or dismisses it. Nothing here changes a status.
 */
export interface ReplySuggestion { state: RecruitmentState; reason: string }

const RULES: { state: RecruitmentState; reason: string; pattern: RegExp }[] = [
  { state: 'REJECTED', reason: 'subject mentions a rejection', pattern: /unfortunately|regret to inform|not (be )?moving forward|not selected|təəssüf|rədd|namizədliyiniz.*uyğun gəlmir|к сожалению|отказ/i },
  { state: 'OFFER', reason: 'subject mentions an offer', pattern: /\boffer\b|job offer|iş təklifi|təklif məktubu|предложени[ея] о работе|оффер/i },
  { state: 'INTERVIEW_INVITED', reason: 'subject mentions an interview', pattern: /interview|müsahibə|собеседован/i },
  { state: 'ACKNOWLEDGED', reason: 'subject looks like an acknowledgement of the application', pattern: /received your application|thank you for (applying|your application)|application received|müraciətiniz (qəbul|alındı)|müraciət üçün təşəkkür|получили ваш|спасибо за (отклик|заявку)/i },
];

export function suggestFromSubject(subject: string): ReplySuggestion | null {
  for (const rule of RULES) if (rule.pattern.test(subject)) return { state: rule.state, reason: rule.reason };
  return null;
}

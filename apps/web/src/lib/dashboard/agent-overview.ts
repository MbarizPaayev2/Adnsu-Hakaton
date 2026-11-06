import type { DeliveryState, EmailApplicationSummary } from '@/lib/email-application';

/**
 * The application agent's numbers for the dashboard, from the delivery states the server recorded. Nothing is estimated and nothing waiting,
 * queued or unconfirmed is ever counted as sent: "sent" means the e-mail provider accepted the message (or the recipient's server did).
 */
export interface AgentPipeline {
  /** Prepared and waiting for the candidate's approval (by the agent or by the candidate). */
  awaiting: number;
  /** Of `awaiting`, the ones the agent prepared in the background. */
  awaitingFromAgent: number;
  /** Approved and in the send queue or being handed to the provider: not sent yet. */
  sending: number;
  /** Accepted by the e-mail provider or delivered to the recipient's server. */
  sent: number;
  /** Failed, bounced, uncertain or held (paused, limit): the candidate should look. */
  attention: number;
}

const SENDING = new Set<DeliveryState>(['QUEUED', 'SENDING']);
const SENT = new Set<DeliveryState>(['PROVIDER_ACCEPTED', 'DELIVERED']);
const PROBLEM = new Set<DeliveryState>(['FAILED', 'UNCERTAIN', 'BOUNCED', 'COMPLAINED']);

export function agentPipeline(rows: EmailApplicationSummary[]): AgentPipeline {
  const p: AgentPipeline = { awaiting: 0, awaitingFromAgent: 0, sending: 0, sent: 0, attention: 0 };
  for (const r of rows) {
    if (r.deliveryState === 'AWAITING_APPROVAL') { p.awaiting++; if (r.preparedByAgentAt) p.awaitingFromAgent++; }
    if (PROBLEM.has(r.deliveryState) || (SENDING.has(r.deliveryState) && r.holdReason)) p.attention++;
    else if (SENDING.has(r.deliveryState)) p.sending++;
    if (SENT.has(r.deliveryState)) p.sent++;
  }
  return p;
}

export interface NextAction { tone: 'act' | 'attention' | 'calm'; title: string; detail: string; href: string; cta: string }

/** The one thing the candidate should do next, in priority order: approve, fix a problem, look at new vacancies, finish the profile, wait. */
export function nextAction(input: { pipeline: AgentPipeline | null; newMatches: number; profileReady: boolean; agentOn: boolean }): NextAction {
  const { pipeline: p, newMatches, profileReady, agentOn } = input;
  if (p && p.awaiting > 0) {
    return {
      tone: 'act',
      title: p.awaiting === 1 ? '1 müraciət təsdiqinizi gözləyir' : `${p.awaiting} müraciət təsdiqinizi gözləyir`,
      detail: p.awaitingFromAgent === 0 ? 'Hazırdır, amma göndərilməyib. Alıcını, mətni və sənədləri yoxlayıb təsdiqləyin.'
        : `${p.awaitingFromAgent === p.awaiting ? 'AISE bunları' : `Onlardan ${p.awaitingFromAgent}-ni AISE`} qaydalarınıza uyğun yeni elanlar üçün hazırladı. Siz təsdiqləməyincə heç biri göndərilmir.`,
      href: '/dashboard/applications#review', cta: 'Yoxla və təsdiqlə',
    };
  }
  if (p && p.attention > 0) {
    return { tone: 'attention', title: p.attention === 1 ? '1 müraciət diqqət tələb edir' : `${p.attention} müraciət diqqət tələb edir`, detail: 'Göndərilmədi, nəticəsi bəlli deyil və ya dayandırılıb. Nə baş verdiyini və nə edə biləcəyinizi müraciətin səhifəsində görürsünüz.', href: '/dashboard/applications', cta: 'Müraciətlərə bax' };
  }
  if (!profileReady) {
    return { tone: 'act', title: 'Profilinizi tamamlayın', detail: 'Uyğun vakansiya seçmək və sənəd hazırlamaq üçün AISE profilinizdəki təcrübəyə əsaslanır.', href: '/dashboard/profile', cta: 'Profilə keç' };
  }
  if (newMatches > 0) {
    return { tone: 'act', title: newMatches === 1 ? '1 yeni uyğun vakansiya' : `${newMatches} yeni uyğun vakansiya`, detail: 'Baxın, saxlayın və ya müraciət hazırlayın. Hər elanda nəyin profilinizdə göstərildiyi yazılıb.', href: '/dashboard/matches', cta: 'Vakansiyalara bax' };
  }
  return agentOn
    ? { tone: 'calm', title: 'Hazırda sizdən heç nə tələb olunmur', detail: 'Axtarışı və hazırlığı AISE görür: qaydalarınıza uyğun yeni e-poçt elanı çıxanda müraciəti hazırlayıb sizə xəbər verəcəyik.', href: '/jobs', cta: 'Bütün vakansiyalar' }
    : { tone: 'calm', title: 'Hazırda sizdən heç nə tələb olunmur', detail: 'Yeni uyğun vakansiya çıxanda burada görəcəksiniz. İstəsəniz bütün elanlara özünüz baxın.', href: '/jobs', cta: 'Bütün vakansiyalar' };
}

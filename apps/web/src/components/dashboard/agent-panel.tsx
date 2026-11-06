import Link from 'next/link';
import { ArrowRight, Bot } from 'lucide-react';
import { Badge, BUTTON } from '@/components/ui';
import type { AgentPipeline } from '@/lib/dashboard/agent-overview';
import { AgentControls } from './agent-controls';

export interface AgentState {
  reviewQueue?: { available: boolean; enabled: boolean; pending: number; maxPending: number };
  enabled: boolean;
  available?: boolean;
  premiumRequired?: boolean;
  rules: { allowedRoles: string[]; allowedLocations: string[]; dailyLimit: number };
}
export interface EmailAllowance { limit: number | null; used: number; remaining: number | null; resetsAt?: string }
export interface DocumentAllowance { limit: number | null; used: number; remaining: number | null; resetsAt?: string }
export interface SendingSettings { sendingPausedAt: string | null; consentRevokedAt: string | null }

const STAGES: { key: keyof AgentPipeline; label: string; hint: string }[] = [
  { key: 'awaiting', label: 'Təsdiqinizi gözləyir', hint: 'hazırdır, göndərilməyib' },
  { key: 'sending', label: 'Göndərilir', hint: 'təsdiqlənib, növbədədir' },
  { key: 'sent', label: 'Göndərildi', hint: 'e-poçt xidməti qəbul etdi' },
  { key: 'attention', label: 'Diqqət tələb edir', hint: 'xəta, şübhə və ya fasilə' },
];

/**
 * The application agent on the dashboard: what it looks for, what it prepared, what waits for approval, what was sent and what needs
 * attention, with the remaining allowances and the pause controls. Counts come from recorded delivery states only (lib/dashboard/agent-overview).
 */
export function AgentPanel({
  state,
  pipeline,
  allowance,
  docAllowance,
  sending,
}: {
  state: AgentState | null;
  pipeline: AgentPipeline | null;
  allowance: EmailAllowance | null;
  docAllowance?: DocumentAllowance | null;
  sending: SendingSettings | null;
}) {
  if (!state) return <section className="ui-card space-y-3" aria-labelledby="agent-panel-title" data-testid="agent-panel">
    <h2 id="agent-panel-title" className="text-lg font-semibold">E-poçt müraciət agenti</h2>
    <p className="text-sm text-neutral-dark/75">Agentin vəziyyəti hazırda alınmadı. Müraciətlərinizi və qaydalarınızı aşağıdakı keçidlərdən aça bilərsiniz.</p>
    <div className="flex flex-wrap gap-3"><Link href="/dashboard/email-applications/settings" className={BUTTON.secondary}>Agent və e-poçt qaydaları</Link><Link href="/dashboard/applications#review" className={BUTTON.quiet}>Təsdiq gözləyən müraciətlər</Link></div>
  </section>;
  const queueOn = !!state.reviewQueue?.enabled;
  const on = queueOn || state.enabled;
  const paused = !!sending?.sendingPausedAt;
  const unavailable = !state.premiumRequired && state.reviewQueue?.available === false && state.available === false;
  const status = unavailable ? { tone: 'warn' as const, label: 'Hazırda əlçatan deyil' } : state.premiumRequired ? { tone: 'neutral' as const, label: 'Premium planında' }
    : paused ? { tone: 'warn' as const, label: 'Göndəriş dayandırılıb' }
    : state.enabled ? { tone: 'good' as const, label: 'Aktiv · qaydalarla göndərir' }
    : queueOn ? { tone: 'good' as const, label: 'Aktiv · hazırlayır, siz təsdiqləyirsiniz' }
    : { tone: 'neutral' as const, label: 'Söndürülüb' };
  return (
    <section aria-labelledby="agent-panel-title" className="ui-card space-y-5" data-testid="agent-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="agent-panel-title" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-neutral-dark"><Bot aria-hidden="true" className="h-5 w-5 text-secondary" />Müraciət agenti</h2>
          {on && !state.premiumRequired && (
            <p className="mt-1 text-sm text-neutral-dark/75">
              Axtarır: <strong className="font-semibold">{state.rules.allowedRoles.join(', ') || 'vəzifə seçilməyib'}</strong> · {state.rules.allowedLocations.join(', ') || 'şəhər seçilməyib'} · gündə ən çox {state.rules.dailyLimit}
            </p>
          )}
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      {unavailable && <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">E-poçt göndərişi bu mühitdə aktiv deyil. Müraciət tarixçəniz saxlanılır; bu vəziyyətdə heç nə göndərilmir.</p>}

      {paused && (
        <div role="status" className="rounded-xl border border-amber-300 bg-amber-50/80 p-3 text-sm text-amber-900" data-testid="agent-paused-banner">
          Müraciətlərin göndərişi müvəqqəti dayandırılıb. Təsdiq gözləyən müraciətlər təhlükəsiz şəkildə saxlanılır və siz davam etdirməyincə heç nə göndərilmir.
        </div>
      )}

      {state.premiumRequired ? (
        <p className="text-sm leading-relaxed text-neutral-dark/80">
          Agent Premium planına daxildir: qaydalarınıza uyğun yeni e-poçt elanları üçün müraciəti hazırlayır, siz hər birini yoxlayıb təsdiqləyirsiniz. E-poçt müraciətlərini özünüz hazırlamaq və müraciət cədvəli bütün planlarda var.
        </p>
      ) : !on ? (
        <p className="text-sm leading-relaxed text-neutral-dark/80">
          Vəzifə və şəhər qaydalarınızı yazın: uyğun yeni e-poçt elanı çıxanda AISE müraciəti serverdə hazırlayıb təsdiqinizə qoyacaq. Siz təsdiqləməyincə heç nə göndərilmir. Brauzer genişlənməsi lazım deyil.
        </p>
      ) : (
        <p className="text-sm leading-relaxed text-neutral-dark/80">
          {state.enabled ? 'Ayrıca verdiyiniz icazə ilə qaydalara tam uyğun elanlara özü göndərir; qalanlarını təsdiqinizə qoyur.' : 'Yalnız e-poçtla müraciət qəbul edən elanlara baxır və müraciəti hazırlayıb təsdiqinizə qoyur; özü göndərmir.'} Serverdə işləyir, kompüteriniz bağlı olanda da.
        </p>
      )}

      {pipeline && (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="E-poçt müraciətləri mərhələlər üzrə">
          {STAGES.map((s) => (
            <div key={s.key} className={`rounded-xl border p-3 ${s.key === 'awaiting' && pipeline.awaiting > 0 ? 'border-primary/40 bg-highlight/25' : s.key === 'attention' && pipeline.attention > 0 ? 'border-amber-300 bg-amber-50/60' : 'border-outline-variant'}`}>
              <dt className="text-xs font-medium text-neutral-dark/75">{s.label}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-neutral-dark">{pipeline[s.key]}</dd>
              <dd className="text-[11px] leading-snug text-neutral-dark/60">{s.hint}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="space-y-1.5 pt-1 text-xs text-neutral-dark/75" data-testid="agent-allowances">
        {allowance && allowance.limit !== null && allowance.remaining !== null && (
          <p>Bu ay e-poçt müraciəti: <strong className="font-semibold text-neutral-dark">{allowance.remaining}</strong> / {allowance.limit} qalıb. Göndərilməyən müraciət limitdən çıxılmır.</p>
        )}
        {docAllowance && docAllowance.limit !== null && docAllowance.remaining !== null && (
          <p>Bu ay sənəd hazırlığı: <strong className="font-semibold text-neutral-dark">{docAllowance.remaining}</strong> / {docAllowance.limit} qalıb.</p>
        )}
      </div>

      <details className="group rounded-xl border border-neutral-dark/10 bg-background/60 p-3 text-xs text-neutral-dark/80" data-testid="agent-supported-routes">
        <summary className="cursor-pointer font-semibold text-neutral-dark hover:underline">
          AISE-nin dəstəklədiyi 4 müraciət yolu və iş prinsipi ▾
        </summary>
        <div className="mt-3 space-y-2.5 leading-relaxed">
          <p>
            <strong>1. AISE e-poçt müraciəti:</strong> AISE vakansiyanı tapır, CV və motivasiya məktubunu hazırlayır. Siz yoxlayıb təsdiqlədikdən sonra işəgötürənin rəsmi e-poçt ünvanına göndərilir.
          </p>
          <p>
            <strong>2. Formada kömək (brauzer köməkçisi):</strong> Glorri və digər kənar portallarda yalnız ad, soyad, əlaqə və təsdiqlənmiş motivasiya məktubu sahələrini doldurur. CV əlavə etmək və göndərmək sizin nəzarətinizdədir.
          </p>
          <p>
            <strong>3. Təsdiqlə göndəriş (dəstəklənən portallar):</strong> Lever kimi dəstəklənən sistemlərdə formanı hazırlayır, yalnız siz təsdiqlədikdən sonra göndərir. CAPTCHA və ya əlavə sual çıxsa, köməkçi dərhal dayanır.
          </p>
          <p>
            <strong>4. Sərbəst xarici müraciət:</strong> Kənar şirkət saytlarında AISE sənədləri və rəsmi keçidi təqdim edir, müraciəti portalda tam sərbəst şəkildə özünüz tamamlayırsınız.
          </p>
          <p className="pt-1 font-medium text-neutral-dark/90">
            AISE hazırlıq və ya forma doldurma mərhələsini heç vaxt avtomatik göndəriş kimi qələmə vermir. Hər addımda şəffaflıq və sizin təsdiqiniz əsasdır.
          </p>
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-3">
        {pipeline && pipeline.awaiting > 0 && <Link href="/dashboard/applications#review" className={BUTTON.primary}>Gözləyənləri yoxla <ArrowRight aria-hidden="true" className="h-4 w-4" /></Link>}
        {state.premiumRequired ? (
          <Link href="/pricing" className={BUTTON.secondary}>Planları müqayisə et</Link>
        ) : (
          <Link href="/dashboard/email-applications/settings" className={pipeline && pipeline.awaiting > 0 ? BUTTON.quiet : BUTTON.secondary}>{on ? 'Qaydaları dəyiş' : 'Agenti qur'}</Link>
        )}
        {!state.premiumRequired && <AgentControls queueOn={queueOn} paused={paused} />}
      </div>
    </section>
  );
}

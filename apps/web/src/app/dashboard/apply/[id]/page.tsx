'use client';

import React, { use, useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { RECEIPT_UNVERIFIABLE_TITLE, receiptUnverifiable, receiptUnverifiableText, type DestinationCapability } from '@/lib/external-apply';
import { useAuthedFileUrl } from '@/hooks/use-authed-file-url';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Send,
  Pencil,
  Ban,
  ClipboardCheck,
  ChevronLeft,
  ExternalLink,
  ShieldCheck,
  HelpCircle,
} from 'lucide-react';

interface MissingField {
  fieldKey: string;
  label: string;
  type: 'text' | 'radio' | 'checkbox';
  options?: string[];
}

type ExternalApplicationStatus =
  | 'DRAFT'
  | 'FILLING'
  | 'NEEDS_INPUT'
  | 'READY_FOR_REVIEW'
  | 'SUBMITTING'
  | 'AWAITING_OTP'
  | 'SUBMITTED'
  | 'SUBMITTED_DRY_RUN'
  | 'DELIVERY_UNCONFIRMED'
  | 'FAILED'
  | 'EXPIRED'
  | 'CANCELLED';

interface ExternalApplication {
  id: string;
  matchId: string;
  status: ExternalApplicationStatus;
  stateReason: string | null;
  applyUrl: string;
  destinationHost: string | null;
  destinationName: string | null;
  destinationCapability: DestinationCapability | null;
  vacancy: { title: string; company: string; url: string } | null;
  previewData: Record<string, string> | null;
  missingFields: MissingField[] | null;
  reviewScreenshotUrl: string | null;
  reviewVersion: number;
  otpAttempts: number;
  errorMessage: string | null;
  submittedAt: string | null;
  receiptConfirmed: boolean;
  receiptReference: string | null;
  dryRun: boolean;
  disclosedFields: { key: string; label: string; value: string }[];
  answers: { fieldKey: string; label: string; value: string }[];
  consent: {
    destinationHost: string;
    noticeVersion: string;
    noticeUrl: string;
    approvedDocuments: { kind: 'CV' | 'ID_DOCUMENT'; sha256: string; reason: string }[];
    disclosure: { motivationLetter?: string } | null;
    grantedAt: string;
    revokedAt: string | null;
  } | null;
}

interface Preparation {
  status: ExternalApplicationStatus;
  destination: { key: string; displayName: string; host: string | null; applyUrl: string };
  destinationCapability: DestinationCapability;
  employer: string;
  vacancyTitle: string;
  postingUrl: string;
  notice: { url: string; version: string; declarationText: string; hash: string } | null;
  fields: { key: string; label: string; value: string }[];
  missingFields: string[];
  disclosureHash: string;
  approvedFieldKeys: string[];
  motivationLetter: string;
  documents: { kind: 'CV' | 'ID_DOCUMENT'; label: string; reason: string; sha256: string | null }[];
  blockers: string[];
  blockerMessages: (string | null)[];
  canConsent: boolean;
}

const MAX_OTP_ATTEMPTS = 5;
// Mirrors apps/api ENDED_AFTER_ACTIVATION: the final control was already
// activated, so a new automated application could duplicate it.
const ENDED_AFTER_ACTIVATION = [
  'OTP_SESSION_LOST_AFTER_SEND',
  'OTP_SESSION_EXPIRED_AFTER_SEND',
  'OTP_ATTEMPTS_EXHAUSTED',
  'CANCELLED_AFTER_SEND_PENDING_OTP',
];

const DOCUMENT_LABELS: Record<string, string> = {
  CV: 'CV (razılıq verdiyiniz anda saxlanılan surət)',
  ID_DOCUMENT: 'Şəxsiyyət vəsiqəsinin şəkli',
};

const UNCONFIRMED_REASONS: Record<string, string> = {
  NO_RECEIPT_EVIDENCE: 'Göndəriş düyməsi basıldı, lakin sayt müraciətin qəbul olunduğunu təsdiqləyən nömrə göstərmədi.',
  WORKER_TIMEOUT_OR_ERROR: 'Göndəriş zamanı cavab gözlənilən vaxtda gəlmədi.',
  STALE_IN_FLIGHT: 'Göndəriş sistem kəsintisi səbəbindən yarımçıq qaldı.',
  DESTINATION_ERROR_OBSERVED: 'Göndərişdən sonra saytda xəta mesajı göründü, lakin müraciətin rədd edildiyi dəqiq deyil.',
  CHALLENGE_AFTER_SEND: 'Göndəriş düyməsi basıldıqdan sonra sayt insan yoxlaması (CAPTCHA) göstərdi. AISE bunu keçmir; müraciətin çatıb-çatmadığı bilinmir.',
};

function messageOf(err: unknown, fallback = 'Xəta baş verdi.'): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function newAttemptId(): string {
  return crypto.randomUUID();
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700 border border-red-100" role="alert">
      {children}
    </div>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-background border border-neutral-dark/5 shadow-xs p-6 space-y-5 ${className}`}>{children}</div>;
}

function BackToMatches() {
  return (
    <Link href="/dashboard/matches" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
      <ChevronLeft className="h-4 w-4" /> Uyğunluqlara qayıt
    </Link>
  );
}

/** The assisted route: the candidate applies on the source site themselves. */
function AssistedApply({ url, note }: { url?: string | null; note?: string }) {
  return (
    <div className="rounded-xl border border-neutral-dark/10 bg-neutral-dark/[0.03] p-4 space-y-2">
      <p className="text-sm font-semibold text-neutral-dark">Özünüz müraciət edin</p>
      <p className="text-xs text-neutral-dark/70">
        {note || 'Vakansiyanın öz saytında müraciət edə bilərsiniz. Göndərdikdən sonra uyğunluqlar səhifəsində “Müraciət etdim” düyməsi ilə qeyd edin.'}
      </p>
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline">
          Vakansiyanı mənbə saytda aç <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}

function CancelApplicationButton({ onCancel, disabled }: { onCancel: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onCancel}
      disabled={disabled}
      className="inline-flex items-center gap-1 text-xs font-bold bg-background border border-neutral-dark/20 hover:bg-neutral-dark/5 text-neutral-dark px-3.5 py-2 rounded-xl transition-all disabled:opacity-60"
    >
      <Ban className="h-3.5 w-3.5" /> {disabled ? 'Ləğv edilir...' : 'Müraciəti Ləğv Et'}
    </button>
  );
}

function AnswersForm({
  missingFields,
  submitting,
  onSubmit,
  onCancel,
}: {
  missingFields: MissingField[];
  submitting: boolean;
  onSubmit: (answers: { fieldKey: string; value: string }[], motivationLetter?: string) => void;
  onCancel?: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [motivationLetter, setMotivationLetter] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const answers = missingFields.map((field) => ({ fieldKey: field.fieldKey, value: values[field.fieldKey] || '' }));
    onSubmit(answers, motivationLetter.trim() ? motivationLetter.trim() : undefined);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {missingFields.map((field) => (
        <fieldset key={field.fieldKey}>
          <legend className="block text-xs font-semibold text-neutral-dark/85 mb-1.5">{field.label}</legend>
          {field.type === 'text' && (
            <input
              type="text"
              aria-label={field.label}
              value={values[field.fieldKey] || ''}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.fieldKey]: e.target.value }))}
              className="block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
              required
            />
          )}
          {field.type === 'radio' && (
            <div className="mt-1 space-y-1.5">
              {(field.options || []).map((opt) => (
                <label key={opt} className="tap flex items-center gap-2 text-sm text-neutral-dark cursor-pointer">
                  <input
                    type="radio"
                    name={field.fieldKey}
                    value={opt}
                    checked={values[field.fieldKey] === opt}
                    onChange={() => setValues((prev) => ({ ...prev, [field.fieldKey]: opt }))}
                    required
                  />
                  {opt}
                </label>
              ))}
            </div>
          )}
          {field.type === 'checkbox' && (
            <label className="mt-1 flex items-center gap-2 text-sm text-neutral-dark cursor-pointer">
              <input
                type="checkbox"
                checked={values[field.fieldKey] === 'true'}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.fieldKey]: e.target.checked ? 'true' : 'false' }))}
              />
              Bəli
            </label>
          )}
        </fieldset>
      ))}

      <div>
        <label htmlFor="motivation-override" className="block text-xs font-semibold text-neutral-dark/85 mb-1.5">
          Motivasiya məktubu (istəyə bağlı dəyişiklik)
        </label>
        <textarea
          id="motivation-override"
          value={motivationLetter}
          onChange={(e) => setMotivationLetter(e.target.value)}
          rows={4}
          placeholder="Boş buraxsanız, razılıq verdiyiniz məktub olduğu kimi qalacaq."
          className="block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
        />
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center justify-center gap-2 product-action rounded-full bg-primary py-2.5 px-4 text-sm font-semibold text-white shadow-xs hover:bg-primary-hover disabled:opacity-50 transition-all"
        >
          {submitting ? 'Formaya yazılır...' : 'Cavabları Formaya Yaz'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-neutral-dark/20 bg-background py-2.5 px-4 text-sm font-semibold text-neutral-dark hover:bg-neutral-dark/5 transition-all"
          >
            İmtina
          </button>
        )}
      </div>
      <p className="text-xs text-neutral-dark/60">Cavablar yalnız formaya yazılır; yekun göndəriş ayrıca təsdiqinizlə olacaq.</p>
    </form>
  );
}

/** DRAFT: destination, the recipient's actual notice and the exact disclosure, before anything is transmitted. */
function ConsentStep({
  app,
  onGranted,
  onCancel,
  cancelling,
}: {
  app: ExternalApplication;
  onGranted: (a: ExternalApplication) => void;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const [prep, setPrep] = useState<Preparation | null>(null);
  const [prepError, setPrepError] = useState<string | null>(null);
  const [readNotice, setReadNotice] = useState(false);
  const [authorise, setAuthorise] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPrepError(null);
    try {
      const res = await apiFetch(`/external-applications/${app.id}/preparation`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Hazırlıq məlumatları yüklənə bilmədi.');
      setPrep(data);
    } catch (err) {
      setPrepError(messageOf(err, 'Xəta baş verdi.'));
    }
  }, [app.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (prepError) return <ErrorBox>{prepError}</ErrorBox>;
  if (!prep) return <p className="text-sm text-neutral-dark/65">Hazırlıq məlumatları yüklənir...</p>;

  const grant = async () => {
    if (!prep.notice) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(`/external-applications/${app.id}/consent`, {
        method: 'POST',
        body: JSON.stringify({
          destinationHost: prep.destination.host,
          noticeHash: prep.notice.hash,
          noticeVersion: prep.notice.version,
          disclosureHash: prep.disclosureHash,
          approvedFields: prep.approvedFieldKeys,
          approvedDocuments: prep.documents.map((d) => ({ kind: d.kind, sha256: d.sha256 })),
          motivationLetter: prep.motivationLetter,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Something shown here changed: reload it, and ask for a fresh review.
        if (res.status === 409) {
          setReadNotice(false);
          setAuthorise(false);
          await load();
        }
        throw new Error(data.message || 'Razılıq qeydə alınmadı.');
      }
      onGranted(data);
    } catch (err) {
      setError(messageOf(err, 'Xəta baş verdi.'));
    } finally {
      setSubmitting(false);
    }
  };

  const missing = new Set(prep.missingFields);
  const blockingMessages = prep.blockerMessages.filter(Boolean) as string[];
  const blockedByDestination = prep.blockers.some((b) => !['PROFILE_INCOMPLETE', 'CV_MISSING', 'ID_DOCUMENT_MISSING'].includes(b));
  const letterTooShort = prep.motivationLetter.trim().length < 20;

  return (
    <div className="space-y-5">
      <Card>
        <div>
          <h2 className="font-serif text-lg font-bold text-neutral-dark">Kimə və nə göndəriləcək</h2>
          <p className="text-xs text-neutral-dark/60 mt-1">Razılıq verənə qədər heç bir məlumat bu sayta ötürülmür.</p>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="font-semibold text-neutral-dark/70">Vakansiya</dt>
          <dd>{prep.vacancyTitle} — {prep.employer}</dd>
          <dt className="font-semibold text-neutral-dark/70">Qəbul edən sayt</dt>
          <dd>{prep.destination.displayName} (<span className="font-mono text-xs">{prep.destination.host}</span>)</dd>
          <dt className="font-semibold text-neutral-dark/70">Müraciət ünvanı</dt>
          <dd className="font-mono text-xs break-all">{prep.destination.applyUrl}</dd>
        </dl>
      </Card>

      {blockedByDestination ? (
        <Card>
          <div className="flex items-start gap-2">
            <HelpCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h2 className="font-serif text-lg font-bold text-neutral-dark">Avtomatik müraciət bu vakansiya üçün mümkün deyil</h2>
              {blockingMessages.map((m) => <p key={m} className="text-sm text-neutral-dark/75">{m}</p>)}
            </div>
          </div>
          <AssistedApply url={prep.postingUrl} />
          <CancelApplicationButton onCancel={onCancel} disabled={cancelling} />
        </Card>
      ) : (
        <>
          {receiptUnverifiable(prep.destinationCapability) && (
            <Card>
              <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 border border-amber-200" role="note" data-testid="receipt-unverifiable">
                <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h2 className="text-sm font-bold text-amber-900">{RECEIPT_UNVERIFIABLE_TITLE}</h2>
                  <p className="text-sm text-amber-900">{receiptUnverifiableText(prep.destination.displayName)}</p>
                </div>
              </div>
            </Card>
          )}
          <Card>
            <h2 className="font-serif text-lg font-bold text-neutral-dark">Qəbul edən saytın bəyanatı</h2>
            {prep.notice && (
              <>
                <blockquote className="rounded-xl bg-neutral-dark/[0.03] p-4 text-sm text-neutral-dark whitespace-pre-wrap">
                  {prep.notice.declarationText}
                </blockquote>
                <p className="text-xs text-neutral-dark/60">
                  Versiya: {prep.notice.version} ·{' '}
                  <a href={prep.notice.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    Saytın məxfilik şərtləri
                  </a>
                  . Formadakı bəyanat bu mətndən fərqlənsə, hazırlıq dayandırılacaq və heç nə göndərilməyəcək.
                </p>
              </>
            )}
          </Card>

          <Card>
            <h2 className="font-serif text-lg font-bold text-neutral-dark">Ötürüləcək məlumatlar</h2>
            <table className="w-full text-sm">
              <tbody>
                {prep.fields.map((f) => (
                  <tr key={f.key} className="border-b border-neutral-dark/5 last:border-0">
                    <th scope="row" className="py-1.5 pr-4 text-left font-semibold text-neutral-dark/70">{f.label}</th>
                    <td className="py-1.5">{missing.has(f.key) ? <span className="text-red-700">Profildə yoxdur</span> : f.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div>
              <p className="text-xs font-semibold text-neutral-dark/70 mb-1">Motivasiya məktubu</p>
              {letterTooShort ? (
                <p className="text-sm text-red-700">Profilinizdə ən azı 20 simvolluq motivasiya məktubu yoxdur.</p>
              ) : (
                <p className="text-sm text-neutral-dark whitespace-pre-wrap">{prep.motivationLetter}</p>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-neutral-dark/70 mb-1">Sənədlər</p>
              <ul className="space-y-1.5">
                {prep.documents.map((d) => (
                  <li key={d.kind} className="text-sm">
                    <span className="font-semibold">{d.label}</span>
                    {!d.sha256 && <span className="text-red-700"> — yüklənməyib</span>}
                    <span className="block text-xs text-neutral-dark/60">Niyə lazımdır: {d.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
            {(missing.size > 0 || prep.documents.some((d) => !d.sha256) || letterTooShort) && (
              <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 border border-amber-200" role="status">
                Çatışmayan məlumatları <Link href="/dashboard/profile" className="font-semibold underline">profilinizdə</Link> tamamlayın, sonra bu səhifəni yeniləyin.
              </div>
            )}
          </Card>

          <Card>
            <h2 className="font-serif text-lg font-bold text-neutral-dark flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-accent" /> Razılığınız
            </h2>
            <label className="flex items-start gap-2 text-sm text-neutral-dark cursor-pointer">
              <input type="checkbox" checked={readNotice} onChange={(e) => setReadNotice(e.target.checked)} className="mt-1" />
              <span>Yuxarıdakı bəyanatı ({prep.notice?.version}) oxudum və onu mənim adımdan qəbul etməyə icazə verirəm.</span>
            </label>
            <label className="flex items-start gap-2 text-sm text-neutral-dark cursor-pointer">
              <input type="checkbox" checked={authorise} onChange={(e) => setAuthorise(e.target.checked)} className="mt-1" />
              <span>
                Yalnız yuxarıda göstərilən məlumatların və sənədlərin yalnız bu vakansiya üçün {prep.destination.host} saytındakı formaya
                doldurulmasına icazə verirəm. Yekun göndəriş ayrıca təsdiqimlə olacaq.
              </span>
            </label>
            {error && <ErrorBox>{error}</ErrorBox>}
            {prep.canConsent && (letterTooShort || !readNotice || !authorise) && (
              <p id="consent-missing" className="text-xs text-neutral-dark/70">
                Davam etmək üçün:{' '}
                {[
                  letterTooShort && 'motivasiya məktubunu tamamlayın',
                  !readNotice && 'bəyanatı oxuduğunuzu təsdiqləyin',
                  !authorise && 'məlumatların doldurulmasına icazə verin',
                ].filter(Boolean).join('; ')}
                .
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <button
                onClick={grant}
                aria-describedby={prep.canConsent && (letterTooShort || !readNotice || !authorise) ? 'consent-missing' : undefined}
                disabled={!prep.canConsent || letterTooShort || !readNotice || !authorise || submitting}
                className="inline-flex items-center gap-2 product-action rounded-full bg-primary py-2.5 px-4 text-sm font-bold text-white shadow-xs hover:bg-primary-hover disabled:opacity-50 transition-all"
              >
                {submitting ? 'Qeydə alınır...' : 'Razılıq ver və formanı hazırla'}
              </button>
              <CancelApplicationButton onCancel={onCancel} disabled={cancelling} />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function ReviewSummary({ app }: { app: ExternalApplication }) {
  const letter = app.consent?.disclosure?.motivationLetter;
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold text-neutral-dark/70 mb-1.5">Göndəriləcək məlumatlar</p>
        <table className="w-full text-sm">
          <tbody>
            {app.disclosedFields.map((f) => (
              <tr key={f.key} className="border-b border-neutral-dark/5 last:border-0">
                <th scope="row" className="py-1 pr-4 text-left font-semibold text-neutral-dark/70">{f.label}</th>
                <td className="py-1">{f.value}</td>
              </tr>
            ))}
            {app.answers.map((a) => (
              <tr key={a.fieldKey} className="border-b border-neutral-dark/5 last:border-0">
                <th scope="row" className="py-1 pr-4 text-left font-semibold text-neutral-dark/70">{a.label}</th>
                <td className="py-1">{a.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {letter && (
        <div>
          <p className="text-xs font-semibold text-neutral-dark/70 mb-1">Motivasiya məktubu</p>
          <p className="text-sm text-neutral-dark whitespace-pre-wrap">{letter}</p>
        </div>
      )}
      <div>
        <p className="text-xs font-semibold text-neutral-dark/70 mb-1">Sənədlər</p>
        <ul className="list-disc pl-5 text-sm">
          {(app.consent?.approvedDocuments || []).map((d) => (
            <li key={d.kind}>{DOCUMENT_LABELS[d.kind] || d.kind}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function ApplyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [app, setApp] = useState<ExternalApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [answersSubmitting, setAnswersSubmitting] = useState(false);
  const [answersError, setAnswersError] = useState<string | null>(null);
  const [editingAnswers, setEditingAnswers] = useState(false);
  const [lastMissingFields, setLastMissingFields] = useState<MissingField[]>([]);

  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // One id per deliberate confirmation. A retry after a lost reply reuses it,
  // so the server replays the first result instead of sending twice.
  const confirmAttempt = useRef<string | null>(null);

  const screenshotUrl = useAuthedFileUrl(app?.reviewScreenshotUrl);

  const [otpCode, setOtpCode] = useState('');
  const [otpSubmitting, setOtpSubmitting] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const otpAttempt = useRef<{ id: string; code: string } | null>(null);

  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);

  const applyAppUpdate = (data: ExternalApplication) => {
    setApp(data);
    if (data.missingFields && data.missingFields.length > 0) setLastMissingFields(data.missingFields);
  };

  const fetchApp = useCallback(async () => {
    try {
      const res = await apiFetch(`/external-applications/${id}`);
      if (!res.ok) throw new Error('Müraciət məlumatları yüklənə bilmədi.');
      applyAppUpdate(await res.json());
    } catch (err) {
      setLoadError(messageOf(err, 'Xəta baş verdi.'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchApp();
  }, [fetchApp]);

  // Preparation and a send in flight finish asynchronously: poll until they settle.
  useEffect(() => {
    if (!app || (app.status !== 'FILLING' && app.status !== 'SUBMITTING')) return;
    const interval = setInterval(fetchApp, 3000);
    return () => clearInterval(interval);
  }, [app, fetchApp]);

  const handleSubmitAnswers = async (answers: { fieldKey: string; value: string }[], motivationLetter?: string) => {
    if (!app) return;
    setAnswersSubmitting(true);
    setAnswersError(null);
    try {
      const body: Record<string, unknown> = { answers };
      if (motivationLetter) body.motivationLetter = motivationLetter;
      const res = await apiFetch(`/external-applications/${app.id}/answers`, { method: 'PATCH', body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        await fetchApp();
        throw new Error(data.message || 'Cavablar formaya yazıla bilmədi.');
      }
      applyAppUpdate(data);
      setEditingAnswers(false);
    } catch (err) {
      setAnswersError(messageOf(err, 'Xəta baş verdi.'));
    } finally {
      setAnswersSubmitting(false);
    }
  };

  const openConfirm = () => {
    confirmAttempt.current = newAttemptId();
    setConfirmError(null);
    setShowConfirmModal(true);
  };

  const handleConfirmSubmit = async () => {
    if (!app || confirmSubmitting) return;
    if (!confirmAttempt.current) confirmAttempt.current = newAttemptId();
    setConfirmSubmitting(true);
    setConfirmError(null);
    try {
      const res = await apiFetch(`/external-applications/${app.id}/confirm-submit`, {
        method: 'POST',
        body: JSON.stringify({ attemptId: confirmAttempt.current, reviewVersion: app.reviewVersion }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        confirmAttempt.current = null;
        await fetchApp();
        throw new Error(data.message || 'Göndərmək mümkün olmadı.');
      }
      confirmAttempt.current = null;
      applyAppUpdate(data);
      setShowConfirmModal(false);
    } catch (err) {
      // No reply (network): the attempt id is kept, so a retry is a replay.
      setConfirmError(err instanceof TypeError
        ? 'Əlaqə kəsildi və nəticə bilinmir. Yenidən cəhd etsəniz, eyni göndəriş təkrarlanmayacaq.'
        : messageOf(err));
    } finally {
      setConfirmSubmitting(false);
    }
  };

  const handleSubmitOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!app || otpSubmitting) return;
    if (!otpAttempt.current || otpAttempt.current.code !== otpCode) otpAttempt.current = { id: newAttemptId(), code: otpCode };
    setOtpSubmitting(true);
    setOtpError(null);
    try {
      const res = await apiFetch(`/external-applications/${app.id}/otp`, {
        method: 'POST',
        body: JSON.stringify({ code: otpCode, attemptId: otpAttempt.current.id }),
      });
      const data = await res.json().catch(() => ({}));
      otpAttempt.current = null;
      if (!res.ok) {
        setOtpError(data.message || 'OTP kodu qəbul edilmədi.');
        await fetchApp();
        return;
      }
      applyAppUpdate(data);
      setOtpCode('');
      if (data.status === 'AWAITING_OTP' && data.stateReason === 'OTP_INVALID') setOtpError('Kod yanlışdır. Yenidən yoxlayıb daxil edin.');
    } catch (err) {
      setOtpError(err instanceof TypeError
        ? 'Əlaqə kəsildi. Eyni kodu yenidən göndərsəniz, təkrar cəhd sayılmayacaq.'
        : messageOf(err));
    } finally {
      setOtpSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!app) return;
    const warning = app.status === 'AWAITING_OTP'
      ? 'Forma artıq göndərilib və OTP gözləyir. Ləğv etmək AISE-ni dayandırır, lakin saytdakı müraciəti geri götürmür. Davam edilsin?'
      : 'Bu müraciəti ləğv etmək istədiyinizə əminsiniz?';
    if (!confirm(warning)) return;
    setCancelling(true);
    setActionError(null);
    try {
      const res = await apiFetch(`/external-applications/${app.id}/cancel`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        await fetchApp();
        throw new Error(data.message || 'Ləğv etmək mümkün olmadı.');
      }
      applyAppUpdate(data);
    } catch (err) {
      setActionError(messageOf(err, 'Xəta baş verdi.'));
    } finally {
      setCancelling(false);
    }
  };

  const handleRestart = async () => {
    if (!app) return;
    setRestarting(true);
    setActionError(null);
    try {
      const res = await apiFetch('/external-applications', { method: 'POST', body: JSON.stringify({ matchId: app.matchId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Yenidən başlamaq mümkün olmadı.');
      if (data.id === app.id) applyAppUpdate(data);
      else window.location.assign(`/dashboard/apply/${data.id}`);
    } catch (err) {
      setActionError(messageOf(err, 'Xəta baş verdi.'));
    } finally {
      setRestarting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-neutral-dark/65">Müraciət yüklənir...</p>
      </div>
    );
  }

  if (loadError && !app) {
    return (
      <div className="max-w-2xl space-y-4">
        <ErrorBox>{loadError}</ErrorBox>
        <BackToMatches />
      </div>
    );
  }

  if (!app) return null;

  const host = app.consent?.destinationHost || app.destinationHost || 'mənbə sayt';
  const postingUrl = app.vacancy?.url;
  const afterActivation = ENDED_AFTER_ACTIVATION.includes(app.stateReason || '');
  const restartBlock = (
    <div className="flex flex-wrap gap-3 items-center">
      <button
        onClick={handleRestart}
        disabled={restarting}
        className="inline-flex items-center gap-2 product-action rounded-full bg-primary py-2.5 px-4 text-sm font-bold text-white shadow-xs hover:bg-primary-hover disabled:opacity-50 transition-all"
      >
        {restarting ? 'Başladılır...' : 'Yenidən Başla'}
      </button>
      <BackToMatches />
    </div>
  );
  const mayHaveReachedSite = (
    <>
      <p className="text-sm text-neutral-dark/75">
        Məlumatlarınız {host} saytına çatmış ola bilər. Təkrar müraciət yaranmasın deyə AISE bunu avtomatik yenidən göndərmir.
      </p>
      <AssistedApply url={postingUrl} note="Vəziyyəti vakansiyanın saytında yoxlayın və ya işəgötürənlə birbaşa əlaqə saxlayın. Lazım olsa, müraciəti orada özünüz tamamlayın." />
      <BackToMatches />
    </>
  );

  let body: React.ReactNode = null;

  switch (app.status) {
    case 'DRAFT':
      body = <ConsentStep app={app} onGranted={applyAppUpdate} onCancel={handleCancel} cancelling={cancelling} />;
      break;

    case 'FILLING':
      body = (
        <Card className="flex flex-col items-center text-center">
          <Loader2 className="h-8 w-8 text-primary animate-spin" />
          <p className="text-sm font-semibold text-neutral-dark">Forma {host} saytında hazırlanır...</p>
          <p className="text-xs text-neutral-dark/60 max-w-sm">
            Razılıq verdiyiniz məlumatlar formaya yazılır. Yekun göndəriş düyməsi basılmır — onu yalnız siz təsdiqləyəcəksiniz.
          </p>
          <CancelApplicationButton onCancel={handleCancel} disabled={cancelling} />
        </Card>
      );
      break;

    case 'NEEDS_INPUT':
      body = (
        <Card>
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h2 className="font-serif text-lg font-bold text-neutral-dark">Sizin cavabınız lazımdır</h2>
              <p className="text-xs text-neutral-dark/60 mt-1">
                Bu vakansiyanın sualları var. AISE cavabları təxmin etmir — yalnız sizin seçdiyiniz cavab formaya yazılacaq.
              </p>
            </div>
          </div>
          {answersError && <ErrorBox>{answersError}</ErrorBox>}
          <AnswersForm missingFields={app.missingFields || []} submitting={answersSubmitting} onSubmit={handleSubmitAnswers} />
          <div className="pt-2 border-t border-neutral-dark/5">
            <CancelApplicationButton onCancel={handleCancel} disabled={cancelling} />
          </div>
        </Card>
      );
      break;

    case 'READY_FOR_REVIEW': {
      const previewEntries = app.previewData ? Object.entries(app.previewData) : [];
      body = (
        <div className="space-y-6">
          <Card>
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-serif text-lg font-bold text-neutral-dark flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5 text-accent" /> Göndərişdən əvvəl yoxlayın
              </h2>
              {lastMissingFields.length > 0 && !editingAnswers && (
                <button onClick={() => setEditingAnswers(true)} className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline">
                  <Pencil className="h-3.5 w-3.5" /> Cavabı redaktə et
                </button>
              )}
            </div>
            {app.stateReason === 'WORKER_GATE_OFF' || app.stateReason === 'WORKER_UNREACHABLE' || app.stateReason === 'SESSION_BUSY' ? (
              <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 border border-amber-200" role="status">
                Əvvəlki göndəriş cəhdi başlamadı; heç nə göndərilmədi. Bir az sonra yenidən təsdiqləyə bilərsiniz.
              </p>
            ) : null}

            {editingAnswers ? (
              <div className="space-y-4">
                {answersError && <ErrorBox>{answersError}</ErrorBox>}
                <AnswersForm missingFields={lastMissingFields} submitting={answersSubmitting} onSubmit={handleSubmitAnswers} onCancel={() => setEditingAnswers(false)} />
              </div>
            ) : (
              <>
                <ReviewSummary app={app} />
                <div>
                  <p className="text-xs font-semibold text-neutral-dark/70 mb-2">{host} saytındakı formanın göstərdiyi</p>
                  {previewEntries.length > 0 ? (
                    <div className="rounded-xl bg-neutral-dark/[0.03] p-4 space-y-1 text-xs text-neutral-dark">
                      {previewEntries.map(([key, value]) => <p key={key}>{value}</p>)}
                    </div>
                  ) : (
                    <p className="text-xs text-neutral-dark/50">Saytdan mətn önizləməsi alınmadı.</p>
                  )}
                </div>
                <div>
                  {screenshotUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={screenshotUrl} alt="Formanın nəzərdən keçirmə skrinşotu" className="w-full rounded-xl border border-neutral-dark/10" />
                  ) : app.reviewScreenshotUrl ? (
                    <div className="h-40 rounded-xl border border-neutral-dark/10 bg-neutral-dark/5 animate-pulse" />
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-3 pt-2 border-t border-neutral-dark/5">
                  <button
                    onClick={openConfirm}
                    className="inline-flex items-center gap-2 product-action rounded-full bg-primary py-2.5 px-4 text-sm font-bold text-white shadow-xs hover:bg-primary-hover transition-all"
                  >
                    <Send className="h-4 w-4" /> Göndərişi təsdiqlə
                  </button>
                  <CancelApplicationButton onCancel={handleCancel} disabled={cancelling} />
                </div>
              </>
            )}
          </Card>

          {showConfirmModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <div role="dialog" aria-modal="true" aria-labelledby="confirm-title" className="bg-background rounded-2xl p-6 max-w-md w-full space-y-4 shadow-xl border border-neutral-dark/10">
                <h3 id="confirm-title" className="font-serif text-lg font-bold text-neutral-dark flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-600" /> Bu addım geri qaytarılmır
                </h3>
                <p className="text-sm text-neutral-dark/80 leading-relaxed">
                  Davam etsəniz, yuxarıdakı məlumatlar və sənədlər {host} saytında “{app.vacancy?.title}” vakansiyasına real olaraq göndəriləcək.
                  {receiptUnverifiable(app.destinationCapability)
                    ? receiptUnverifiableText(app.destinationName ?? host ?? 'Bu sayt')
                    : 'Qəbul yalnız sayt təsdiq nömrəsi göstərərsə təsdiqlənmiş sayılacaq.'}
                </p>
                {confirmError && <ErrorBox>{confirmError}</ErrorBox>}
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    onClick={() => setShowConfirmModal(false)}
                    disabled={confirmSubmitting}
                    className="rounded-xl border border-neutral-dark/20 bg-background px-4 py-2 text-sm font-semibold text-neutral-dark hover:bg-neutral-dark/5 transition-all disabled:opacity-50"
                  >
                    İmtina et
                  </button>
                  <button
                    onClick={handleConfirmSubmit}
                    disabled={confirmSubmitting}
                    className="product-action rounded-full bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-hover transition-all disabled:opacity-50"
                  >
                    {confirmSubmitting ? 'Göndərilir...' : 'Bəli, real olaraq göndər'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      );
      break;
    }

    case 'SUBMITTING':
      body = (
        <Card className="flex flex-col items-center text-center">
          <Loader2 className="h-8 w-8 text-primary animate-spin" />
          <p className="text-sm font-semibold text-neutral-dark">Göndəriş davam edir...</p>
          <p className="text-xs text-neutral-dark/60 max-w-sm">
            Nəticə gözlənilir. Səhifəni bağlasanız belə göndəriş təkrarlanmayacaq; nəticə burada görünəcək.
          </p>
        </Card>
      );
      break;

    case 'AWAITING_OTP': {
      const remaining = Math.max(0, MAX_OTP_ATTEMPTS - app.otpAttempts);
      body = (
        <Card className="max-w-md">
          <div>
            <h2 className="font-serif text-lg font-bold text-neutral-dark">Təsdiq kodunu daxil edin</h2>
            <p className="text-xs text-neutral-dark/60 mt-1">
              {host} müraciəti təsdiqləmək üçün sizə birdəfəlik kod (OTP) göndərdi. Kod daxil edilənə qədər müraciət tamamlanmış sayılmır.
            </p>
          </div>
          <p className="text-xs font-semibold text-neutral-dark/70">Qalan cəhd: {remaining} / {MAX_OTP_ATTEMPTS}</p>
          {otpError && <ErrorBox>{otpError}</ErrorBox>}
          <form onSubmit={handleSubmitOtp} className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label="Təsdiq kodu"
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.trim())}
              placeholder="Kodu daxil edin"
              pattern="[A-Za-z0-9]{3,12}"
              className="block w-full rounded-xl border border-neutral-dark/20 bg-background-warm/25 py-2.5 px-3 text-neutral-dark text-sm focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
              required
            />
            <button
              type="submit"
              disabled={otpSubmitting}
              className="shrink-0 product-action rounded-full bg-primary py-2.5 px-4 text-sm font-bold text-white hover:bg-primary-hover disabled:opacity-50 transition-all"
            >
              {otpSubmitting ? 'Yoxlanılır...' : 'Təsdiqlə'}
            </button>
          </form>
          <div className="pt-2 border-t border-neutral-dark/5">
            <CancelApplicationButton onCancel={handleCancel} disabled={cancelling} />
          </div>
        </Card>
      );
      break;
    }

    case 'SUBMITTED':
      body = app.receiptConfirmed ? (
        <Card className="flex flex-col items-center text-center">
          <CheckCircle2 className="h-10 w-10 text-green-600" />
          <h2 className="font-serif text-xl font-bold text-neutral-dark">Müraciətin qəbulu təsdiqləndi</h2>
          <p className="text-sm text-neutral-dark/70 max-w-sm">
            {host} müraciətinizi qəbul etdi. Təsdiq nömrəsi: <span className="font-mono font-semibold">{app.receiptReference}</span>
          </p>
          <BackToMatches />
        </Card>
      ) : (
        <Card>
          <h2 className="font-serif text-lg font-bold text-neutral-dark flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-amber-600" /> Göndərilib, qəbul təsdiqlənməyib
          </h2>
          {mayHaveReachedSite}
        </Card>
      );
      break;

    case 'DELIVERY_UNCONFIRMED':
      body = (
        <Card>
          <h2 className="font-serif text-lg font-bold text-neutral-dark flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-amber-600" /> Çatdırılma təsdiqlənməyib
          </h2>
          <p className="text-sm text-neutral-dark/75">
            {UNCONFIRMED_REASONS[app.stateReason || ''] || 'Göndərişin nəticəsi etibarlı şəkildə müəyyən edilə bilmədi.'}
          </p>
          {mayHaveReachedSite}
        </Card>
      );
      break;

    case 'SUBMITTED_DRY_RUN':
      body = (
        <Card className="bg-amber-50 border-amber-200 flex flex-col items-center text-center">
          <CheckCircle2 className="h-10 w-10 text-amber-600" />
          <h2 className="font-serif text-xl font-bold text-neutral-dark">Sınaq rejimi tamamlandı</h2>
          <p className="text-sm text-neutral-dark/70 max-w-sm">
            Forma yoxlanıldı, lakin göndəriş düyməsi basılmadı. Heç nə {host} saytına göndərilmədi.
          </p>
          <BackToMatches />
        </Card>
      );
      break;

    case 'FAILED':
      body = (
        <Card>
          <div className="flex items-start gap-2">
            <XCircle className="h-6 w-6 text-red-600 shrink-0 mt-0.5" />
            <div>
              <h2 className="font-serif text-lg font-bold text-neutral-dark">
                {app.stateReason === 'OTP_ATTEMPTS_EXHAUSTED' ? 'Bütün OTP cəhdləri istifadə olundu' : 'Müraciət tamamlanmadı'}
              </h2>
              <p className="text-sm text-neutral-dark/70 mt-1">{app.errorMessage || 'Heç nə göndərilmədi.'}</p>
            </div>
          </div>
          {afterActivation
            ? mayHaveReachedSite
            : app.stateReason === 'MANUAL_INTERVENTION_REQUIRED'
              ? (
                <>
                  <AssistedApply url={postingUrl} />
                  <BackToMatches />
                </>
              )
              : restartBlock}
        </Card>
      );
      break;

    case 'EXPIRED':
      body = (
        <Card>
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-6 w-6 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h2 className="font-serif text-lg font-bold text-neutral-dark">Sessiyanın vaxtı bitdi</h2>
              {!afterActivation && (
                <p className="text-sm text-neutral-dark/70 mt-1">Hazırlıq sessiyası başa çatdı. Yekun göndəriş edilmədi; yenidən başlaya bilərsiniz.</p>
              )}
            </div>
          </div>
          {afterActivation ? mayHaveReachedSite : restartBlock}
        </Card>
      );
      break;

    case 'CANCELLED':
      body = (
        <Card className={afterActivation ? '' : 'flex flex-col items-center text-center'}>
          <Ban className="h-8 w-8 text-neutral-dark/40" />
          <h2 className="font-serif text-lg font-bold text-neutral-dark">Bu müraciəti ləğv etdiniz</h2>
          {afterActivation ? (
            <>
              <p className="text-sm text-neutral-dark/75">AISE dayandırıldı. Forma OTP gözləyərkən ləğv edildi — bu, saytdakı müraciəti geri götürmür.</p>
              {mayHaveReachedSite}
            </>
          ) : (
            <>
              <p className="text-sm text-neutral-dark/70">Yekun göndəriş edilmədi. Razılığınız geri götürüldü.</p>
              <BackToMatches />
            </>
          )}
        </Card>
      );
      break;

    default:
      body = null;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-2xl">
      <Link href="/dashboard/matches" className="inline-flex items-center gap-1 text-xs font-medium text-neutral-dark/60 hover:text-neutral-dark transition-colors">
        <ChevronLeft className="h-3.5 w-3.5" /> Uyğunluqlara qayıt
      </Link>
      <div>
        <h1 className="font-serif text-2xl font-bold text-neutral-dark">Xarici saytda müraciət</h1>
        {app.vacancy && (
          <p className="mt-1 text-sm text-neutral-dark/70">
            {app.vacancy.title} — {app.vacancy.company} · <span className="font-mono text-xs">{host}</span>
          </p>
        )}
      </div>
      {actionError && <ErrorBox>{actionError}</ErrorBox>}
      {body}
    </div>
  );
}

'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { errorOf, type AgentCapabilities } from '@/lib/agent';

const BOX = 'product-card rounded-2xl border border-neutral-dark/10 bg-background p-5 space-y-4';
const INPUT = 'w-full rounded-xl border border-neutral-dark/20 bg-background px-3 py-2 text-sm text-neutral-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';
const BTN = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const lines = (v: string) => v.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
const ASK = [['salary', 'Maaş gözləntisi'], ['work_authorization', 'İş icazəsi sualları'], ['notice', 'Başlama müddəti'], ['cover', 'Motivasiya qeydi'], ['phone', 'Telefon nömrəsi sualı'], ['unknown', 'İşəgötürənin xüsusi sualları (həmişə soruşulur)']] as const;

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return <div className="space-y-1"><label htmlFor={id} className="block text-sm font-medium text-neutral-dark">{label}</label>{children}{hint && <p id={`${id}-h`} className="text-xs text-neutral-dark/60">{hint}</p>}</div>;
}

interface Preview { consentHash: string; scope: Record<string, unknown>; resume: { id: string; sha256: string; bytes: number }; portals: { key: string; name: string; limitations: string[] }[] }

export default function NewCampaignPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [caps, setCaps] = useState<AgentCapabilities | null>(null);
  const [resumes, setResumes] = useState<{ id: string; isBase: boolean; status: string; createdAt: string }[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [ack, setAck] = useState(false);

  const [name, setName] = useState('');
  const [mode, setMode] = useState<'ASSISTED' | 'AUTONOMOUS'>('ASSISTED');
  const [employers, setEmployers] = useState('');
  const [excluded, setExcluded] = useState('');
  const [roles, setRoles] = useState('');
  const [locations, setLocations] = useState('');
  const [minScore, setMinScore] = useState(50);
  const [include, setInclude] = useState('');
  const [exclude, setExclude] = useState('');
  const [resumeId, setResumeId] = useState('');
  const [cover, setCover] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [place, setPlace] = useState('');
  const [company, setCompany] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [github, setGithub] = useState('');
  const [portfolio, setPortfolio] = useState('');
  const [auth, setAuth] = useState<'' | 'yes' | 'no'>('');
  const [salary, setSalary] = useState('');
  const [currency, setCurrency] = useState('AZN');
  const [notice, setNotice] = useState('');
  const [alwaysAsk, setAlwaysAsk] = useState<string[]>(['unknown']);
  const [useLetters, setUseLetters] = useState(true);
  const [dailyLimit, setDailyLimit] = useState(3);
  const [days, setDays] = useState(7);

  useEffect(() => {
    (async () => {
      const [c, r, p] = await Promise.all([apiFetch('/agent/capabilities', { cache: 'no-store' }), apiFetch('/resumes', { cache: 'no-store' }), apiFetch('/profile', { cache: 'no-store' })]).catch(() => [null, null, null] as const);
      if (c?.ok) setCaps(await c.json());
      if (r?.ok) { const list = await r.json(); setResumes(Array.isArray(list) ? list.filter((x: { isBase: boolean; status: string }) => x.isBase && x.status === 'READY') : []); }
      if (p?.ok) { const prof = await p.json().catch(() => null); if (prof) { setPhone((v) => v || prof.phone || ''); setPlace((v) => v || prof.location || ''); } }
    })();
  }, []);
  useEffect(() => { setFullName((v) => v || session?.user?.name || ''); setEmail((v) => v || session?.user?.email || ''); }, [session]);

  const scope = useMemo(() => ({
    name: name.trim(), mode, portals: ['lever'], employerAllow: lines(employers), employerDeny: lines(excluded), targetRoles: lines(roles), locations: lines(locations),
    criteria: { minScore: minScore / 100, mustInclude: lines(include), mustExclude: lines(exclude) }, resumeId, coverNote: cover.trim() || null, useApprovedLetters: useLetters, alwaysAsk,
    dailyLimit, expiresAt: new Date(Date.now() + days * 86_400_000).toISOString(),
    answers: { fullName: fullName.trim(), email: email.trim(), phone: phone.trim(), location: place.trim(), currentCompany: company.trim(), links: { linkedin: linkedin.trim(), github: github.trim(), portfolio: portfolio.trim() }, workAuthorization: auth || null, salary: salary ? { amount: Number(salary), currency, period: 'month' } : null, noticePeriod: notice.trim() },
  }), [name, mode, employers, excluded, roles, locations, minScore, include, exclude, resumeId, cover, useLetters, alwaysAsk, dailyLimit, days, fullName, email, phone, place, company, linkedin, github, portfolio, auth, salary, currency, notice]);

  async function review(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setAck(false);
    const res = await apiFetch('/agent/campaigns/preview', { method: 'POST', body: JSON.stringify(scope) }).catch(() => null);
    if (!res) setError('Bağlantı xətası.');
    else if (!res.ok) { const m = await errorOf(res); const bad = /INVALID_SCOPE:([\w.,]+)/.exec(JSON.stringify(await res.clone().json().catch(() => ({})))); setError(bad ? `Bu sahələri yoxlayın: ${bad[1].replace(/,/g, ', ')}` : m); }
    else setPreview(await res.json());
    setBusy(false);
  }
  async function create() {
    if (!preview) return; setBusy(true); setError('');
    const res = await apiFetch('/agent/campaigns', { method: 'POST', body: JSON.stringify({ scope, consentHash: preview.consentHash, acknowledged: true }) }).catch(() => null);
    if (res?.ok) router.push('/dashboard/agent'); else { setError(res ? await errorOf(res) : 'Bağlantı xətası.'); setBusy(false); }
  }

  if (!caps) return <div role="status" className="flex items-center gap-2 p-6 text-sm"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Yüklənir…</div>;
  if (!caps.enabled) return <div className="m-6 space-y-2"><h1 className="font-serif text-2xl font-bold text-neutral-dark">Yeni müraciət icazəsi</h1><p className="text-sm">Brauzer köməkçisi hələ aktiv deyil. <Link href="/dashboard/agent" className="underline">Geri</Link></p></div>;
  const autonomousOk = caps.autonomous;

  if (preview) {
    const s = preview.scope as { mode: string; employerAllow: string[]; employerDeny: string[]; targetRoles: string[]; locations: string[]; criteria: { minScore: number }; dailyLimit: number; expiresAt: string; coverNote: string | null; useApprovedLetters?: boolean };
    return (
      <div className="mx-auto w-full max-w-3xl space-y-5 p-4 sm:p-6">
        <button className="inline-flex items-center gap-1 text-sm underline" onClick={() => setPreview(null)}><ChevronLeft aria-hidden="true" className="h-4 w-4" />Dəyişiklik et</button>
        <h1 className="font-serif text-2xl font-bold">Razılığınızı yoxlayın</h1>
        <section className={BOX} aria-label="Razılığın məzmunu">
          <p className="text-sm">Bu icazəni başlatmaqla aşağıdakılara <strong>yalnız öz adınıza</strong> icazə verirsiniz:</p>
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            <li>Portal: <strong>{preview.portals.map((p) => p.name).join(', ')}</strong>; işəgötürənlər: <strong>{s.employerAllow.join(', ')}</strong>{s.employerDeny.length ? ` (istisna: ${s.employerDeny.join(', ')})` : ''}.</li>
            <li>Yalnız adında bu ifadələr olan vakansiyalar: <strong>{s.targetRoles.join(', ')}</strong>{s.locations.length ? `; yer: ${s.locations.join(', ')}` : ''}; AISE uyğunluq xalı ən azı <strong>{Math.round(s.criteria.minScore * 100)}%</strong> (xal tək başına heç nə göndərməz).</li>
            <li>Göndəriləcək CV: seçdiyiniz təsdiqlənmiş fayl (SHA-256 <code className="break-all text-xs">{preview.resume.sha256.slice(0, 16)}…</code>). Fayl dəyişərsə, <strong>heç vaxt göndərilməz</strong>.</li>
            <li>{s.useApprovedLetters ? <>Motivasiya məktubu: “Cover letter” sahəsinə <strong>həmin vakansiya üçün sizin təsdiqlədiyiniz məktub</strong> yazılır; belə məktub yoxdursa{s.coverNote ? ' yuxarıdakı ümumi qeyd' : ' sahə doldurulmur və sizdən soruşulur'}. Agent özü məktub yaratmır və təsdiqlənməmiş qaralamanı göndərmir.</> : <>Motivasiya məktubu: {s.coverNote ? 'yalnız yuxarıdakı ümumi qeyd' : 'sahə doldurulmur və sizdən soruşulur'}; vakansiyaya xas məktub göndərilmir.</>}</li>
            <li>Cavablar: yalnız yuxarıda yazdığınız təsdiqlənmiş məlumatlar. Tanış olmayan, həssas (cins, irq, sağlamlıq və s.) və hüquqi suallar <strong>sizdən soruşulur</strong>.</li>
            <li>Gündə ən çox <strong>{s.dailyLimit}</strong> müraciət; müraciət icazəsi <strong>{formatDate(s.expiresAt)}</strong> tarixində bitir.</li>
            <li>{s.mode === 'ASSISTED' ? <>Rejim: <strong>hər müraciəti siz təsdiq edirsiniz</strong>. Təsdiqiniz olmadan heç nə göndərilmir.</> : <>Rejim: <strong>avtonom</strong>. Agent bu şərtlər daxilində sizdən ayrıca soruşmadan göndərə bilər.</>}</li>
          </ul>
          <p className="text-sm font-medium">Bilməli olduqlarınız</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-neutral-dark/80">
            {preview.portals.flatMap((p) => p.limitations).map((l) => <li key={l}>{l}</li>)}
            <li>İşəgötürənin və ya portalın istifadə şərtləri avtomatik doldurmanı məhdudlaşdıra bilər; nəticə üçün məsuliyyət sizdədir. Razılığı istənilən vaxt geri götürə bilərsiniz: növbədəki hər şey dərhal ləğv olur.</li>
          </ul>
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5" checked={ack} onChange={(e) => setAck(e.target.checked)} /><span>Yuxarıdakıları oxudum və öz adıma bu müraciət icazəsinə razıyam.</span></label>
          {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          <button className={`${BTN} bg-primary text-white`} disabled={!ack || busy} onClick={create}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Razıyam, icazəni başlat</button>
        </section>
      </div>
    );
  }

  return (
    <form onSubmit={review} className="mx-auto w-full max-w-3xl space-y-5 p-4 sm:p-6" aria-label="Yeni müraciət icazəsi">
      <Link href="/dashboard/agent" className="inline-flex items-center gap-1 text-sm underline"><ChevronLeft aria-hidden="true" className="h-4 w-4" />Agent</Link>
      <h1 className="font-serif text-2xl font-bold">Yeni müraciət icazəsi</h1>
      <p className="text-sm text-neutral-dark/70">Müraciət icazəsi sizin yazılı razılığınızdır. Yaratdıqdan sonra məzmunu dəyişmək olmur: dəyişmək üçün yenisini yaradırsınız.</p>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      <fieldset className={BOX}><legend className="px-1 font-semibold">1. Hara və nəyə</legend>
        <Field id="name" label="İcazənin adı"><input id="name" className={INPUT} required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field id="emp" label="İcazə verilən işəgötürənlər (Lever ünvanındakı ad)" hint="Məsələn: xsolla. jobs.lever.co/xsolla/… ünvanındakı “xsolla”. Hər sətirdə biri."><textarea id="emp" aria-describedby="emp-h" className={INPUT} rows={2} required value={employers} onChange={(e) => setEmployers(e.target.value)} /></Field>
        <Field id="exc" label="İstisna işəgötürənlər (ixtiyari)"><textarea id="exc" className={INPUT} rows={1} value={excluded} onChange={(e) => setExcluded(e.target.value)} /></Field>
        <Field id="roles" label="Hədəf vəzifələr" hint="Vakansiyanın adında bu ifadələrdən biri olmalıdır. Məsələn: qa engineer"><textarea id="roles" aria-describedby="roles-h" className={INPUT} rows={2} required value={roles} onChange={(e) => setRoles(e.target.value)} /></Field>
        <Field id="loc" label="Yer (boşdursa istənilən)"><textarea id="loc" className={INPUT} rows={1} value={locations} onChange={(e) => setLocations(e.target.value)} /></Field>
        <Field id="score" label={`Minimum uyğunluq xalı: ${minScore}%`} hint="Bu xal yalnız şərtlərdən biridir; tək başına heç nə göndərməz."><input id="score" aria-describedby="score-h" type="range" min={0} max={100} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} className="w-full" /></Field>
        <div className="grid gap-4 sm:grid-cols-2"><Field id="inc" label="Elanda olmalı sözlər (ixtiyari)"><textarea id="inc" className={INPUT} rows={1} value={include} onChange={(e) => setInclude(e.target.value)} /></Field><Field id="exw" label="Elanda olmamalı sözlər (ixtiyari)"><textarea id="exw" className={INPUT} rows={1} value={exclude} onChange={(e) => setExclude(e.target.value)} /></Field></div>
      </fieldset>

      <fieldset className={BOX}><legend className="px-1 font-semibold">2. Sənədlər</legend>
        <Field id="cv" label="Göndəriləcək təsdiqlənmiş CV" hint="Yeni CV hazırlamaq üçün CV bölməsinə baxın; müraciət icazəsi yalnız burada seçdiyiniz fayl versiyasını göndərir.">
          <select id="cv" aria-describedby="cv-h" className={INPUT} required value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
            <option value="">Seçin…</option>
            {resumes.map((r, i) => <option key={r.id} value={r.id}>CV {i + 1} — {formatDate(r.createdAt)}</option>)}
          </select>
        </Field>
        {resumes.length === 0 && <p className="text-sm text-amber-900">Hazır baza CV-niz yoxdur. <Link className="underline" href="/dashboard/resumes">CV bölməsində</Link> yükləyin.</p>}
        <Field id="cn" label="Təsdiqlənmiş motivasiya qeydi (ixtiyari)" hint="Yalnız “Cover letter” adlı sahəyə yazılır. Vakansiya üçün təsdiqlədiyiniz məktub yoxdursa, bu qeyd istifadə olunur."><textarea id="cn" aria-describedby="cn-h" className={INPUT} rows={4} maxLength={3000} value={cover} onChange={(e) => setCover(e.target.value)} /></Field>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5" checked={useLetters} onChange={(e) => setUseLetters(e.target.checked)} /><span>Vakansiya üçün <strong>özümün təsdiqlədiyim</strong> motivasiya məktubunu istifadə et (varsa). Məktubu <Link className="underline" href="/dashboard/resumes">Sənədlər</Link> bölməsində hazırlayıb təsdiqləyirsiniz; agent heç vaxt özü məktub yaratmır və qaralama göndərmir.</span></label>
      </fieldset>

      <fieldset className={BOX}><legend className="px-1 font-semibold">3. Təsdiqlənmiş cavablar</legend>
        <p className="text-sm text-neutral-dark/70">Yalnız burada yazdıqlarınız formalara yazılır. Burada olmayan məcburi sual sizdən soruşulur.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="fn" label="Ad və soyad"><input id="fn" className={INPUT} required value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
          <Field id="em" label="E-poçt"><input id="em" type="email" className={INPUT} required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field id="ph" label="Telefon"><input id="ph" className={INPUT} value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <Field id="pl" label="Yaşadığınız yer"><input id="pl" className={INPUT} value={place} onChange={(e) => setPlace(e.target.value)} /></Field>
          <Field id="co" label="Hazırkı şirkət (ixtiyari)"><input id="co" className={INPUT} value={company} onChange={(e) => setCompany(e.target.value)} /></Field>
          <Field id="li" label="LinkedIn ünvanı" hint="Bir çox Lever formu bunu tələb edir."><input id="li" aria-describedby="li-h" className={INPUT} placeholder="https://www.linkedin.com/in/…" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} /></Field>
          <Field id="gh" label="GitHub (ixtiyari)"><input id="gh" className={INPUT} value={github} onChange={(e) => setGithub(e.target.value)} /></Field>
          <Field id="pf" label="Portfolio (ixtiyari)"><input id="pf" className={INPUT} value={portfolio} onChange={(e) => setPortfolio(e.target.value)} /></Field>
          <Field id="wa" label="Vakansiyanın yerləşdiyi ölkədə işləmək hüququ"><select id="wa" className={INPUT} value={auth} onChange={(e) => setAuth(e.target.value as '' | 'yes' | 'no')}><option value="">Cavab vermirəm (soruşulsun)</option><option value="yes">Bəli</option><option value="no">Xeyr</option></select></Field>
          <Field id="nt" label="Başlama müddəti (ixtiyari)"><input id="nt" className={INPUT} placeholder="məs. 30 gün" value={notice} onChange={(e) => setNotice(e.target.value)} /></Field>
          <div className="flex gap-2"><Field id="sa" label="Aylıq maaş gözləntisi (ixtiyari)"><input id="sa" type="number" min={0} className={INPUT} value={salary} onChange={(e) => setSalary(e.target.value)} /></Field><Field id="cu" label="Valyuta"><select id="cu" className={INPUT} value={currency} onChange={(e) => setCurrency(e.target.value)}>{['AZN', 'USD', 'EUR', 'GBP'].map((c) => <option key={c}>{c}</option>)}</select></Field></div>
        </div>
        <fieldset className="space-y-1"><legend className="text-sm font-medium">Bu kateqoriyalar üçün həmişə soruşulsun</legend>
          {ASK.map(([k, l]) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={alwaysAsk.includes(k)} onChange={(e) => setAlwaysAsk((a) => (e.target.checked ? [...a, k] : a.filter((x) => x !== k)))} />{l}</label>)}
        </fieldset>
      </fieldset>

      <fieldset className={BOX}><legend className="px-1 font-semibold">4. Rejim və limitlər</legend>
        <div role="radiogroup" aria-label="Rejim" className="space-y-2">
          <label className="flex items-start gap-3 text-sm"><input type="radio" name="mode" className="mt-1 h-5 w-5" checked={mode === 'ASSISTED'} onChange={() => setMode('ASSISTED')} /><span><strong>Hər müraciəti mən təsdiq edirəm.</strong> Agent formanı doldurur, siz planı görüb təsdiq edirsiniz. (Tövsiyə olunur)</span></label>
          <label className={`flex items-start gap-3 text-sm ${autonomousOk ? '' : 'opacity-60'}`}><input type="radio" name="mode" className="mt-1 h-5 w-5" disabled={!autonomousOk} checked={mode === 'AUTONOMOUS'} onChange={() => setMode('AUTONOMOUS')} /><span><strong>Avtonom.</strong> Agent bu razılıq daxilində göndərir. {autonomousOk ? '' : 'Bu rejim hələ açılmayıb: portal adapteri real göndərişlə təsdiqlənməyib.'}</span></label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="dl" label={`Gündəlik limit (1–${caps.limits.userDailyLimit})`}><input id="dl" type="number" min={1} max={caps.limits.userDailyLimit} className={INPUT} required value={dailyLimit} onChange={(e) => setDailyLimit(Number(e.target.value))} /></Field>
          <Field id="dy" label={`Müddət, gün (1–${caps.limits.maxCampaignDays})`}><input id="dy" type="number" min={1} max={caps.limits.maxCampaignDays} className={INPUT} required value={days} onChange={(e) => setDays(Number(e.target.value))} /></Field>
        </div>
      </fieldset>
      <button type="submit" className={`${BTN} bg-primary text-white`} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Nəzərdən keçir</button>
    </form>
  );
}

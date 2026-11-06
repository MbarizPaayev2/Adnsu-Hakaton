'use client';

import { useId, useState } from 'react';
import Link from 'next/link';

const fieldClass = 'mt-1 w-full rounded-xl border border-outline-variant bg-background px-3 py-2.5 text-sm';
const sentence = (value: string) => value.trim().replace(/[.!?]+$/u, '');
const oneLine = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();

function CopyButton({ value, label, disabled }: { value: string; label: string; disabled?: boolean }) {
  const [copied, setCopied] = useState<{ value: string; ok: boolean } | null>(null);
  const current = copied?.value === value ? copied : null;
  return <div className="space-y-2">
    <button type="button" disabled={disabled || !value} className="min-h-11 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={async () => {
      try { await navigator.clipboard.writeText(value); setCopied({ value, ok: true }); }
      catch { setCopied({ value, ok: false }); }
    }}>{label}</button>
    <p role="status" className="text-xs text-on-surface-variant">{current ? current.ok ? 'Köçürüldü. Göndərməzdən əvvəl mətni yoxlayın.' : 'Köçürmək alınmadı. Aşağıdakı mətni seçib əl ilə köçürün.' : ''}</p>
  </div>;
}

function EvidenceBuilder() {
  const id = useId();
  const [focus, setFocus] = useState('SQL');
  const [kind, setKind] = useState('Tədris layihəsi');
  const [name, setName] = useState('');
  const [action, setAction] = useState('');
  const [result, setResult] = useState('');
  const [tools, setTools] = useState('');
  const ready = !!name.trim() && action.trim().length >= 4;
  const draft = ready ? `${oneLine(name)} — ${kind}\n${sentence(action)}.${result.trim() ? ` ${sentence(result)}.` : ''}${tools.trim() ? `\nAlətlər: ${oneLine(tools)}` : ''}` : '';
  const hint = focus === 'SQL' ? 'Hansı məlumatları birləşdirdiniz və nəticəni necə yoxladınız? Öz yazdığınız sorğunu izah edin.' : focus === 'Power BI' ? 'Hesabat hansı suala cavab verir? Model, ölçü və vizuallarda şəxsən gördüyünüz işi ayırın.' : 'Boş və təkrarlanan qeydləri necə tapdınız? Yoxlamanın qaydasını və nəticəsini öz sözlərinizlə yazın.';
  return <>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-medium" htmlFor={`${id}-focus`}>Əsas istiqamət<select id={`${id}-focus`} className={fieldClass} value={focus} onChange={e=>setFocus(e.target.value)}><option>SQL</option><option>Power BI</option><option>Məlumat keyfiyyəti</option></select></label>
      <label className="text-sm font-medium" htmlFor={`${id}-kind`}>Fəaliyyətin həqiqi növü<select id={`${id}-kind`} className={fieldClass} value={kind} onChange={e=>setKind(e.target.value)}><option>Tədris layihəsi</option><option>Şəxsi layihə</option><option>Təcrübə proqramı</option><option>İş çərçivəsində</option></select></label>
    </div>
    <p className="text-sm text-on-surface-variant">{hint} İstiqamət seçmək həmin bacarığı CV-yə avtomatik əlavə etmir.</p>
    <label className="block text-sm font-medium" htmlFor={`${id}-name`}>Layihənin adı<input id={`${id}-name`} maxLength={120} className={fieldClass} value={name} onChange={e=>setName(e.target.value)} placeholder="Öz layihənizin adı" /></label>
    <label className="block text-sm font-medium" htmlFor={`${id}-action`}>Şəxsən nə etdiniz?<textarea id={`${id}-action`} rows={3} maxLength={500} className={fieldClass} value={action} onChange={e=>setAction(e.target.value)} placeholder="Gördüyünüz işi öz sözlərinizlə yazın: nəyi və necə hazırladınız?" /></label>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-medium" htmlFor={`${id}-result`}>Yoxlanmış nəticə — varsa<textarea id={`${id}-result`} rows={2} maxLength={300} className={fieldClass} value={result} onChange={e=>setResult(e.target.value)} placeholder="Rəqəm şərt deyil. Ortaya çıxan iş məhsulunu izah edə bilərsiniz." /></label>
      <label className="text-sm font-medium" htmlFor={`${id}-tools`}>İstifadə etdiyiniz alətlər — varsa<input id={`${id}-tools`} maxLength={160} className={fieldClass} value={tools} onChange={e=>setTools(e.target.value)} placeholder="Yalnız həqiqətən istifadə etdikləriniz" /></label>
    </div>
    <label className="block text-sm font-semibold" htmlFor={`${id}-preview`}>Sizin məlumatlarınızdan hazırlanan CV bəndi<textarea id={`${id}-preview`} readOnly rows={5} className={fieldClass} value={draft} placeholder="Layihənin adını və öz töhfənizi yazdıqda bənd burada görünəcək." /></label>
    <CopyButton value={draft} label="CV bəndini köçür" disabled={!ready} />
    <p className="text-xs text-on-surface-variant">Nəticə uydurulmur və bu qeyd profilinizə avtomatik yazılmır. Fəaliyyət növünü, öz töhfənizi və rəqəmlərin mənbəyini yoxlayın.</p>
  </>;
}

function EmailBuilder() {
  const id=useId();
  const [name,setName]=useState('');
  const [role,setRole]=useState('Junior Backend Developer');
  const [company,setCompany]=useState('');
  const [fact,setFact]=useState('');
  const [link,setLink]=useState('');
  const [customSubject,setCustomSubject]=useState('');
  let validLink=!link.trim();
  try { const url=new URL(link.trim()); validLink=['https:','http:'].includes(url.protocol); } catch { /* A missing/invalid link is never opened or fetched. */ }
  const ready=!!name.trim() && !!role.trim();
  const subject=ready ? oneLine(customSubject) || `${oneLine(role)} — ${oneLine(name)}` : '';
  const body=ready && fact.trim().length>=4 && validLink ? `Hörmətli ${company.trim() ? `«${oneLine(company)}» komandası` : 'işə qəbul komandası'},\n\n${oneLine(role)} vakansiyasına müraciət edirəm. ${sentence(fact)}.\n\nCV-mi${link.trim() ? ' və layihə keçidimi' : ''} nəzərdən keçirməyinizi xahiş edirəm.${link.trim() ? `\nLayihə: ${link.trim()}` : ''}\n\nHörmətlə,\n${oneLine(name)}` : '';
  return <>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-medium" htmlFor={`${id}-name`}>Ad və soyad<input id={`${id}-name`} autoComplete="off" maxLength={100} className={fieldClass} value={name} onChange={e=>setName(e.target.value)} /></label>
      <label className="text-sm font-medium" htmlFor={`${id}-role`}>Elandakı vəzifə adı<input id={`${id}-role`} maxLength={160} className={fieldClass} value={role} onChange={e=>setRole(e.target.value)} /></label>
      <label className="text-sm font-medium" htmlFor={`${id}-company`}>Şirkət — istəyə bağlı<input id={`${id}-company`} maxLength={120} className={fieldClass} value={company} onChange={e=>setCompany(e.target.value)} /></label>
      <div><label className="text-sm font-medium" htmlFor={`${id}-link`}>Açıq layihə keçidi — istəyə bağlı<input id={`${id}-link`} type="url" maxLength={300} className={fieldClass} value={link} onChange={e=>setLink(e.target.value)} placeholder="https://github.com/..." aria-invalid={!validLink} aria-describedby={!validLink?`${id}-link-error`:undefined}/></label>{!validLink && <p id={`${id}-link-error`} role="alert" className="text-xs text-red-700">Düzgün http və ya https keçidi yazın, yaxud sahəni boş saxlayın.</p>}</div>
    </div>
    <label className="block text-sm font-medium" htmlFor={`${id}-fact`}>Rola aid gördüyünüz bir real iş<textarea id={`${id}-fact`} maxLength={500} rows={3} className={fieldClass} value={fact} onChange={e=>setFact(e.target.value)} placeholder="İşin növünü və öz töhfənizi dəqiq yazın. Kurs layihəsini kommersiya təcrübəsi kimi göstərməyin." /></label>
    <details className="text-sm"><summary className="min-h-8 cursor-pointer font-medium">Elan xüsusi mövzu sətri tələb edirsə</summary><label htmlFor={`${id}-custom`} className="mt-2 block">Elanın tələb etdiyi mövzu<input id={`${id}-custom`} maxLength={200} className={fieldClass} value={customSubject} onChange={e=>setCustomSubject(e.target.value)} /></label></details>
    <label className="block text-sm font-semibold" htmlFor={`${id}-subject`}>E-poçtun mövzusu<input id={`${id}-subject`} readOnly className={fieldClass} value={subject} /></label>
    <CopyButton value={subject} label="Mövzunu köçür" />
    <label className="block text-sm font-semibold" htmlFor={`${id}-body`}>Müraciət mətni<textarea id={`${id}-body`} rows={9} readOnly className={fieldClass} value={body} placeholder="Adınızı, vəzifəni və bir real iş nümunəsini yazın." /></label>
    <CopyButton value={body} label="Mətni köçür" />
    <p className="text-xs text-on-surface-variant">Bu alət məktub göndərmir və fayl əlavə etmir. Alıcını, mətninizi, CV əlavəsini və elanın göndəriş qaydasını e-poçt proqramınızda yoxlayın.</p>
  </>;
}

function ImpactBuilder() {
  const id = useId();
  const [problem, setProblem] = useState('');
  const [action, setAction] = useState('');
  const [reason, setReason] = useState('');
  const [result, setResult] = useState('');
  const [scope, setScope] = useState('');
  const [check, setCheck] = useState('');
  const ready = problem.trim().length >= 4 && action.trim().length >= 4;
  const bullet = ready ? `${sentence(action)}.${result.trim() ? ` ${sentence(result)}.` : ''}${scope.trim() ? `\nMəsuliyyət sərhədi: ${sentence(scope)}.` : ''}` : '';
  const story = ready ? [
    `Vəziyyət: ${sentence(problem)}.`,
    `Şəxsi qərarım və ya işim: ${sentence(action)}.`,
    reason.trim() ? `Seçimin səbəbi və alternativ: ${sentence(reason)}.` : 'Hazırlıq sualı: hansı alternativi nəzərdən keçirdiniz və niyə bu yolu seçdiniz?',
    scope.trim() ? `Məsuliyyət sərhədi: ${sentence(scope)}.` : 'Hazırlıq sualı: qərarı kim verdi və komanda işində sizin töhfəniz hansı idi?',
    result.trim() ? `Nəticə: ${sentence(result)}.` : 'Hazırlıq sualı: hansı nəticə müşahidə olundu? Ölçülməyən təsiri rəqəmlə göstərməyin.',
    check.trim() ? `Yoxlama: ${sentence(check)}.` : 'Hazırlıq sualı: nəticəni hansı mənbə və ya yoxlama təsdiqləyir?',
  ].join('\n\n') : '';
  const fields = [
    { key: 'problem', label: 'Hansı problem və ya ehtiyac var idi?', value: problem, set: setProblem, hint: 'Bir konkret hadisə seçin; məxfi ad və məlumat yazmayın.' },
    { key: 'action', label: 'Şəxsən hansı qərarı verdiniz və ya işi gördünüz?', value: action, set: setAction, hint: 'Məsələn, tövsiyə etdim, hazırladım və ya təsdiqlənmiş qərarı tətbiq etdim — öz real işiniz.' },
    { key: 'scope', label: 'Öz töhfəniz və komandanın işi — varsa', value: scope, set: setScope, hint: 'Qərar və icra kimə aid idi? Mentor, iştirakçı və rəhbər rollarını ayırın.' },
    { key: 'reason', label: 'Niyə bu yol? Alternativ nə idi? — varsa', value: reason, set: setReason, hint: 'Vaxt, xərc, etibarlılıq və ya başqa amil: yalnız həqiqətən nəzərə aldıqlarınız.' },
    { key: 'result', label: 'Müşahidə olunan nəticə — varsa', value: result, set: setResult, hint: 'Ölçülmüş nəticəni və dövrünü yazın. Rəqəm yoxdursa, iş məhsulunu izah edin.' },
    { key: 'check', label: 'Nəticəni necə yoxladınız? — varsa', value: check, set: setCheck, hint: 'Yoxlama üsulunu öz sözlərinizlə yazın; daxili sənəd və keçid paylaşmayın.' },
  ];
  return <>
    <div className="grid gap-4 sm:grid-cols-2">{fields.map(field => <label key={field.key} className="text-sm font-medium" htmlFor={`${id}-${field.key}`}>{field.label}<textarea id={`${id}-${field.key}`} rows={3} maxLength={500} className={fieldClass} value={field.value} onChange={e => field.set(e.target.value)} placeholder={field.hint} /></label>)}</div>
    <label className="block text-sm font-semibold" htmlFor={`${id}-bullet`}>CV üçün qısa nailiyyət bəndi<textarea id={`${id}-bullet`} readOnly rows={5} className={fieldClass} value={bullet} placeholder="Problemi və şəxsi işinizi yazdıqda bənd burada görünəcək." /></label>
    <CopyButton value={bullet} label="Nailiyyət bəndini köçür" disabled={!ready} />
    <details className="rounded-xl border border-primary/20 p-4"><summary className="cursor-pointer text-sm font-semibold">Müsahibə üçün qərar hekayəsini hazırla</summary><label className="mt-4 block text-sm" htmlFor={`${id}-story`}>Müsahibə qeydi və qalan hazırlıq sualları<textarea id={`${id}-story`} readOnly rows={12} className={fieldClass} value={story} /></label><CopyButton value={story} label="Müsahibə qeydini köçür" disabled={!ready} /></details>
    <p className="text-xs text-on-surface-variant">Bu alət yalnız yazdıqlarınızı birləşdirir. Boş nəticə, rəhbərlik təcrübəsi və rəqəmlər uydurulmur; hazırlıq sualları CV bəndinə əlavə edilmir.</p>
  </>;
}

export function ArticleTool({ kind }: { kind: 'evidence' | 'email' | 'impact' }) {
  return <section id="praktik-alet" style={{scrollMarginTop:112}} className="ph-no-capture space-y-5 rounded-3xl border border-primary/25 bg-primary/5 p-5 sm:p-7" aria-label="İnteraktiv hazırlıq aləti">
    <div><p className="text-xs font-semibold uppercase tracking-wide text-primary">İnteraktiv · qeydiyyat tələb olunmur</p><h2 className="mt-2 text-xl font-semibold">{kind==='evidence' ? 'Öz layihənizdən CV bəndi hazırlayın' : kind==='impact' ? 'Bir qərardan CV bəndi və müsahibə qeydi hazırlayın' : 'Öz nümunənizlə müraciət e-poçtu hazırlayın'}</h2><p className="mt-2 text-sm text-on-surface-variant">Yalnız öz məlumatlarınızı yazın. Hazır mətni yoxlayıb dəyişə və köçürə bilərsiniz.</p></div>
    {kind==='evidence' ? <EvidenceBuilder/> : kind==='impact' ? <ImpactBuilder/> : <EmailBuilder/>}
    <div className="flex flex-wrap gap-4 border-t border-primary/15 pt-4 text-sm"><Link className="font-semibold text-primary underline" href="/register">AISE-də profilimi qurmaq istəyirəm</Link><Link className="text-primary underline" href="/jobs">Vakansiyaları araşdır</Link></div>
  </section>;
}

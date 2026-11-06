'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Check, FileText, Menu, X } from 'lucide-react';
import { BrandLogo } from './brand-logo';
import styles from '@/app/home.module.css';

const links = [
  { href: '/jobs', label: 'Vakansiyalar' },
  { href: '/#how-it-works', label: 'Necə işləyir' },
  { href: '/pricing', label: 'Planlar' },
  { href: '/blog', label: 'Məqalələr' },
  { href: '/institutions', label: 'Akademiyalar' },
  { href: '/#employers', label: 'İşəgötürənlər' },
];

export function HomeNavigation() {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); toggle.current?.focus(); }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);
  return (
    <>
      <a href="#main-content" className={styles.skipLink}>Əsas məzmuna keç</a>
      <header className={styles.header}>
        <BrandLogo className={styles.logo} />
        <nav className={styles.desktopNav} aria-label="Əsas menyu">{links.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}</nav>
        <div className={styles.headerActions}>
          <Link href="/login" className={styles.login}>Daxil ol</Link>
          <Link href="/register" className={styles.headerStart}>Ödənişsiz başla <ArrowUpRight size={16} aria-hidden="true" /></Link>
          <button ref={toggle} type="button" className={styles.menuToggle} aria-label={open ? 'Menyunu bağla' : 'Menyunu aç'} aria-expanded={open} aria-controls="home-mobile-menu" onClick={() => setOpen(!open)}>{open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}</button>
        </div>
        <nav id="home-mobile-menu" hidden={!open} className={styles.mobileNav} aria-label="Mobil menyu">{[...links, { href: '/login', label: 'Daxil ol' }].map((link) => <Link key={link.href} href={link.href} onClick={() => setOpen(false)}>{link.label}<ArrowUpRight size={17} aria-hidden="true" /></Link>)}</nav>
      </header>
    </>
  );
}

type Step = { key: string; label: string; title: string; text: string };

const workflow = (documentsEnabled: boolean | null): Step[] => [
  { key: 'profile', label: 'Profil', title: 'Profilini bir dəfə qur', text: 'CV-ni və ya LinkedIn PDF-ini yüklə. Nəyin oxunduğunu və nəyin əmin olunmadığını göstəririk; tarix yoxdursa, boş qalır, sən düzəldirsən.' },
  { key: 'match', label: 'Vakansiya', title: 'Uyğun vakansiyanı seçir', text: 'Hər elanda hansı tələbin profilində göstərildiyini, hansının göstərilmədiyini və müraciət üsulunu görürsən.' },
  { key: 'prepare', label: 'Hazırlıq', title: 'Müraciəti hazırlayır', text: documentsEnabled === false ? 'Vakansiyaya uyğun CV və motivasiya məktubu tezliklə əlçatan olacaq.' : 'Bu elan üçün CV, məktub və e-poçt mətni yalnız təsdiqlədiyin faktlarla yazılır. Alıcı elanın özündən götürülür.' },
  { key: 'review', label: 'Təsdiq', title: 'Göndərməzdən əvvəl sən baxırsan', text: 'Alıcını, mətni və sənəd versiyalarını yoxlayır, istəsən düzəldir, keçir və ya təsdiqləyirsən. Təsdiqlədiyin nüsxə dəyişsə, yenidən təsdiq istənir.' },
  { key: 'track', label: 'İzləmə', title: 'Hər müraciət bir yerdə', text: 'Çatdırılma sübutu, işəgötürənin cavabı və öz qeydlərin ayrı görünür. Müraciət cədvəli hamı üçün ödənişsizdir.' },
];

/** Product walkthrough with a synthetic candidate. No live vacancy, real person, score or outcome is shown. */
export function WorkflowPreview({ documentsEnabled = null }: { documentsEnabled?: boolean | null }) {
  const steps = workflow(documentsEnabled);
  const [selected, setSelected] = useState(0);
  const step = steps[selected];
  return (
    <div className={styles.workflow}>
      <ol className={styles.workflowSteps} aria-label="AISE ilə müraciət addımları">
        {steps.map((s, i) => (
          <li key={s.key}>
            <button type="button" aria-pressed={selected === i} onClick={() => setSelected(i)}>
              <span aria-hidden="true">{i + 1}</span>{s.label}
            </button>
          </li>
        ))}
      </ol>
      <div className={styles.workflowPanel} aria-live="polite" aria-atomic="true">
        <p className={styles.previewMeta}><span>NÜMUNƏ</span><span>Sintetik namizəd</span></p>
        <h2>{step.title}</h2>
        <p className={styles.workflowText}>{step.text}</p>
        <div className={styles.workflowCard}>{preview(step.key, documentsEnabled)}</div>
      </div>
    </div>
  );
}

function preview(key: string, documentsEnabled: boolean | null) {
  if (key === 'profile') return (
    <dl className={styles.previewRows}>
      <div><dt>Ad</dt><dd>Leyla M.</dd></div>
      <div><dt>Təcrübə</dt><dd>3 vəzifə oxundu</dd></div>
      <div><dt>Təhsil</dt><dd>UNEC, Maliyyə</dd></div>
      <div data-attention="true"><dt>Yoxla</dt><dd>Bir vəzifənin bitmə tarixi yoxdur</dd></div>
    </dl>
  );
  if (key === 'match') return (
    <>
      <strong className={styles.previewRole}>Data analitik · Bakı · e-poçtla müraciət</strong>
      <div className={styles.previewSkills}>
        <span><Check size={12} aria-hidden="true" />SQL</span>
        <span><Check size={12} aria-hidden="true" />Power BI</span>
        <span data-missing="true">Tableau: profilində göstərilməyib</span>
      </div>
      <small className={styles.previewNote}>Bu bacarığın varsa, profilinə əlavə edib təsdiqləyirsən.</small>
    </>
  );
  if (key === 'prepare') return documentsEnabled === false
    ? <small className={styles.previewNote}>Sənəd hazırlama hələ açıq deyil.</small>
    : (
      <>
        <span className={styles.previewBadge}><FileText size={13} aria-hidden="true" />Hazırdır · göndərilməyib</span>
        <dl className={styles.previewRows}>
          <div><dt>Kimə</dt><dd>elanda göstərilən ünvan</dd></div>
          <div><dt>CV</dt><dd>Data analitik üçün, v2</dd></div>
          <div><dt>Məktub</dt><dd>Azərbaycan dilində</dd></div>
          <div data-attention="true"><dt>Sual</dt><dd>Maaş gözləntisi istənir</dd></div>
        </dl>
      </>
    );
  if (key === 'review') return (
    <ul className={styles.previewChecklist}>
      <li><Check size={13} aria-hidden="true" />Alıcı elanın mətnindən götürülüb</li>
      <li><Check size={13} aria-hidden="true" />CV və məktub təsdiqlənib</li>
      <li><Check size={13} aria-hidden="true" />E-poçt mətnini oxudun</li>
      <li data-pending="true">Təsdiq et və göndər · Düzəlt · Keç</li>
    </ul>
  );
  return (
    <dl className={styles.previewRows}>
      <div><dt>Data analitik</dt><dd>E-poçt xidməti qəbul etdi</dd></div>
      <div><dt>Hesabat mütəxəssisi</dt><dd>Təsdiqini gözləyir</dd></div>
      <div><dt>Biznes analitik</dt><dd>Müsahibə · sənin qeydin</dd></div>
    </dl>
  );
}

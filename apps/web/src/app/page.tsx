import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight, Check, Search } from 'lucide-react';
import { CareerGuides } from '@/components/blog/career-guides';
import { BrandLogo } from '@/components/landing/brand-logo';
import { HomeNavigation, WorkflowPreview } from '@/components/landing/home-experience';
import { DocumentBenefits, EmployerSection } from '@/components/landing/product-sections';
import styles from './home.module.css';
import { documentAvailability, emailApplicationAvailability, emailAutomationAvailability } from '@/lib/document-availability';
import { candidatePlansTeaser, type CandidatePlanTeaser } from '@/lib/candidate-plans-public';
import { employerPlansTeaser } from '@/lib/employer-plans-public';

export const metadata: Metadata = {
  title: 'AISE — İş müraciətlərini avtomatlaşdır, vaxtına qənaət et',
  description: 'İş axtarışına və təkrarlanan müraciətlərə daha az vaxt ayır. AISE uyğun vakansiyaları seçir, CV və məktubu hazırlayır, e-poçt müraciətlərini icazənlə göndərir və izləyir.',
  openGraph: {
    title: 'AISE — İş müraciətlərini avtomatlaşdır. Vaxtın özünə qalsın.',
    description: 'Vakansiya axtarışı, fərdiləşdirilmiş sənədlər və e-poçtla müraciət bir yerdə. Daha az təkrar iş, karyeran üçün daha çox vaxt.',
    locale: 'az_AZ', type: 'website',
  },
};

const faqFor = (automationOn: boolean) => [
  { q: 'AISE mənim yerimə müraciət göndərir?', a: 'Yalnız sən təsdiqləyəndən sonra. Hər müraciətdə alıcını, mətni və sənədləri görürsən; təsdiqlədiyin məhz həmin nüsxə göndərilir, sonradan dəyişsə yenidən təsdiq istənir. ' + (automationOn ? 'Premium-da ayrıca icazə ilə qaydalarla avtomatik göndərişi də aça bilərsən: yalnız seçdiyin vəzifə və şəhərlər, gündəlik limitlə; istənilən an dayandırılır.' : 'Qaydalarla avtomatik göndəriş hələ açıq deyil; açılanda yalnız ayrıca icazənlə işləyəcək və istənilən an dayandırıla biləcək.') },
  { q: 'Sənədlərə olmayan təcrübə yazılır?', a: 'Xeyr. CV və məktub yalnız profilindəki və təsdiqlədiyin faktlara əsaslanır. Bir tələb profilində göstərilməyibsə, bunu “profilində göstərilməyib” kimi görürsən, “səndə yoxdur” kimi yox. Məlumat çatışmayanda qısa sual veririk; cavab vermək məcburi deyil.' },
  { q: 'Hansı yolla müraciət edilir?', a: 'Elanın özündə göstərilən üsulla. Elan e-poçt ünvanı verirsə, müraciət AISE-dən həmin ünvana sənin təsdiqinlə gedir. Başqa saytdakı forma tələb olunursa, keçid verilir; Premium-da Chrome brauzer köməkçisi formadakı ad və əlaqə sahələrini doldurur, göndərməni isə sən edirsən.' },
  { q: 'Brauzer genişlənməsini quraşdırmalıyam?', a: 'Xeyr, əksər hallarda lazım deyil. Vakansiyalar, sənədlər, e-poçt müraciəti və müraciət cədvəli saytda işləyir. Genişlənmə yalnız işəgötürənin öz saytındakı formanı kompüterdə doldurmaq üçündür.' },
  { q: 'Sənədlər hansı dillərdə hazırlanır?', a: 'Azərbaycan, ingilis və rus dillərində. Ad, şirkət adları və texniki terminlər olduğu kimi saxlanılır.' },
  { q: 'Vakansiyalar haradan gəlir?', a: 'Açıq iş elanı saytlarından və şirkətlərin öz karyera səhifələrindən. Hər elanda mənbə və müraciət üsulu göstərilir.' },
  { q: 'Müsahibə və ya işə qəbul zəmanəti verirsiniz?', a: 'Xeyr. Məqsəd təcrübəni daha aydın göstərən, elana uyğun müraciətdir. Qərarı işəgötürən verir.' },
];

const control = [
  'Sənin təsdiqin olmadan heç nə göndərilmir.',
  'Hansı vəzifə və şəhərlərə baxılacağını sən seçirsən.',
  'Sənədlərə yalnız təsdiqlədiyin faktlar düşür.',
  'Müraciət cədvəli ödənişsizdir; qeydlərin səndə qalır.',
];

/** "ayda 5 sənəd", "sənəd üçün aylıq limit yoxdur" (fair-use protections still apply, so never "limitsiz"); nothing when the server did not state it. */
function allowanceText(value: number | null | undefined, unit: string) {
  if (value === undefined) return null;
  return value === null ? `${unit} üçün aylıq limit yoxdur` : `ayda ${value} ${unit}`;
}

const categories = [
  { key: 'technology', label: 'Texnologiya', detail: 'Kod. Data. Yeni ideyalar.' },
  { key: 'finance', label: 'Maliyyə', detail: 'Rəqəmlərin arxasındakı imkanlar.' },
  { key: 'sales', label: 'Satış', detail: 'İnsanlar. Əlaqələr. Nəticələr.' },
  { key: 'marketing', label: 'Marketinq', detail: 'Fərqli düşünənlər üçün.' },
  { key: 'hr', label: 'İnsan resursları', detail: 'Yaxşı komandalar səndən başlayır.' },
  { key: 'all', label: 'Bütün sahələr', detail: 'Öz yolunu tap.' },
];

export default async function Home() {
  const [documentsEnabled, emailEnabled, automationEnabled, employerPlans, plans] = await Promise.all([documentAvailability(), emailApplicationAvailability(), emailAutomationAvailability(), employerPlansTeaser(), candidatePlansTeaser()]);
  const automationOn = emailEnabled === true && automationEnabled === true;
  const plan = (id: CandidatePlanTeaser['id']) => plans?.find((p) => p.id === id) ?? null;
  return (
    <div className={styles.home}>
      <HomeNavigation />
      <main id="main-content" tabIndex={-1}>
        <section className={styles.hero} aria-labelledby="home-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}><span aria-hidden="true" />İŞ AXTARIŞI VƏ MÜRACİƏT AGENTİ · AZƏRBAYCANDA İŞ AXTARANLAR ÜÇÜN</p>
            <h1 id="home-title">İş müraciətlərini avtomatlaşdır. <span>Vaxtın özünə qalsın.</span></h1>
            <p className={styles.intro}>
              Hər elanı ayrı axtarmağa, eyni məlumatları yenidən yazmağa daha az vaxt sərf et. Profilini bir dəfə qur: AISE sənə uyğun vakansiyaları seçir, {documentsEnabled === false ? 'tezliklə hər elan üçün ayrıca CV və motivasiya məktubu hazırlayacaq' : 'hər elan üçün təsdiqlədiyin faktlarla CV və motivasiya məktubu hazırlayır'}{emailEnabled === true ? ', sən təsdiqləyəndə elanın e-poçt ünvanına göndərir' : ''} və hər müraciəti bir yerdə izləyir.
            </p>
            <p className={styles.heroMode}>
              {automationOn
                ? 'Premium-da avtomatik e-poçt müraciətini aktiv et: vəzifə və şəhərləri, gündəlik limiti seç, AISE ayrıca icazən əsasında göndərsin. İstənilən an dayandıra bilərsən.'
                : emailEnabled === true
                  ? 'İndi: müraciəti yoxla və təsdiqlə, AISE göndərsin. Hər müraciəti ayrıca təsdiqləmədən avtomatik göndəriş hazırda açıq deyil.'
                  : 'E-poçt göndərişinin əlçatanlığı hazırda təsdiqlənmir. Mövcud imkanları aşağıda yoxlaya bilərsən.'}
            </p>
            <div className={styles.heroActions}>
              <Link href="/register" className={styles.primaryAction}>Ödənişsiz başla <ArrowUpRight size={20} aria-hidden="true" /></Link>
              <Link href="/jobs" className={styles.textAction}>Vakansiyalara bax <ArrowUpRight size={17} aria-hidden="true" /></Link>
              <Link href="/institutions" className={styles.textAction}>Akademiyalar üçün <ArrowUpRight size={17} aria-hidden="true" /></Link>
            </div>
            <ul className={styles.controlList} aria-label="Nəzarət səndədir">
              {control.map((line) => <li key={line}><Check size={15} aria-hidden="true" />{line}</li>)}
            </ul>
            <p className={styles.residency}>
              <span className={styles.residencyMark} aria-hidden="true">06<span>✳</span></span>
              <span className={styles.residencyIdentity}><strong><span>ABB</span> Innovation</strong><small>6-cı inkubasiya proqramı</small><span className={styles.residencyStatus}>Rəsmi rezident startap</span></span>
            </p>
          </div>
          <div id="how-it-works" className={styles.heroVisual}>
            <WorkflowPreview documentsEnabled={documentsEnabled} />
          </div>
        </section>
        <section className={styles.audiences} aria-labelledby="time-saved-title">
          <h2 id="time-saved-title" className={styles.sectionLabel}>DAHA AZ TƏKRAR İŞ. KARYERAN ÜÇÜN DAHA ÇOX VAXT.</h2>
          <div className={styles.audienceGrid}>
            <article>
              <h3>Axtarış bir yerdə</h3>
              <p>Müxtəlif saytlardakı elanları bir yerdə araşdır, profilinə uyğun vakansiyaları seç. Hər dəfə axtarışa sıfırdan başlama.</p>
            </article>
            <article>
              <h3>Məlumatlarını təkrar yazma</h3>
              <p>{documentsEnabled === false
                ? 'Profilini bir dəfə qur. Hər vakansiya üçün CV və motivasiya məktubu hazırlamaq tezliklə əlçatan olacaq.'
                : documentsEnabled === true
                  ? 'Təsdiqlədiyin profil faktlarından hər vakansiya üçün CV və motivasiya məktubu hazırla. Sən yoxla, lazım olanı düzəlt.'
                  : 'Profilini bir dəfə qur. Sənəd hazırlamanın əlçatanlığı hazırda yoxlanıla bilmir.'}</p>
            </article>
            <article>
              <h3>Göndəriş və izləmə bir axında</h3>
              <p>{automationOn
                ? 'Uyğun e-poçt elanlarına qaydaların və ayrıca icazən əsasında avtomatik müraciət et; göndərişləri bir yerdə izlə.'
                : emailEnabled === true
                  ? 'Elanın e-poçt ünvanını və sənədlərini yoxla, göndərişi təsdiqlə. AISE göndərsin, sən müraciətini bir yerdə izlə.'
                  : 'Müraciət tarixçəni və qeydlərini bir yerdə saxla. E-poçt göndərişinin əlçatanlığını aşağıda yoxla.'}</p>
            </article>
          </div>
        </section>
        <section className={styles.availability} aria-labelledby="availability-title">
          <div className={styles.availabilityHead}>
            <p className={styles.sectionLabel}>NƏ HAZIRDIR, NƏ HAZIRLANIR</p>
            <h2 id="availability-title">Bu gün işləyənlər və <span>növbəti addımlar.</span></h2>
            <p>Burada yazılanlar məhsulda olanlardır. Hələ sınaqda olanı ayrıca göstəririk və hazır olmayan imkanı reklam etmirik.</p>
          </div>
          <div className={styles.availabilityGrid}>
            <div>
              <h3>İndi əlçatandır</h3>
              <ul>
                <li><strong>Uyğun vakansiyalar</strong><span>Açıq elanlar profilinlə müqayisə olunur; hər elanda nəyin profilində göstərildiyi, nəyin göstərilmədiyi yazılır.</span></li>
                <li><strong>Elana uyğun CV və məktub</strong><span>{documentsEnabled === false ? 'Hazırda bağlıdır.' : documentsEnabled === null ? 'Əlçatanlıq hazırda yoxlanıla bilmir.' : 'Azərbaycan, ingilis və ya rus dilində. Profilindən nəyin dəyişdirildiyi göstərilir; sən düzəldib təsdiqləyirsən.'}</span></li>
                <li><strong>E-poçtla müraciət</strong><span>{emailEnabled === false ? 'Hazırda bağlıdır.' : emailEnabled === null ? 'Əlçatanlıq hazırda yoxlanıla bilmir.' : 'Elan e-poçt ünvanı verirsə: alıcı, mətn və sənədləri yoxlayırsan, təsdiqləyirsən, AISE göndərir və çatdırılma sübutunu göstərir.'}</span></li>
                <li><strong>Müraciət cədvəli</strong><span>Hamı üçün ödənişsiz. Öz qeydlərin və sistemin sübutları ayrı göstərilir.</span></li>
                <li><strong>Brauzer köməkçisi (Chrome, kompüterdə)</strong><span>İşəgötürənin saytındakı formada ad və əlaqə sahələrini doldurur. Göndərməni sən edirsən. Premium.</span></li>
                {automationOn && <li><strong>Qaydalarla avtomatik e-poçt göndərişi</strong><span>Premium, yalnız ayrıca icazənlə: seçdiyin vəzifə və şəhərlər, gündəlik limit, istənilən an dayandırma.</span></li>}
              </ul>
            </div>
            <div data-tone="planned">
              <h3>Sınaqdadır, hələ açıq deyil</h3>
              <ul>
                <li><strong>Arxa planda hazırlıq</strong><span>Qaydalarına uyğun yeni e-poçt elanı çıxanda müraciəti əvvəlcədən hazırlayıb təsdiqinə qoymaq. Göndəriş yenə sənin təsdiqinlə olacaq.</span></li>
                {!automationOn && <li><strong>Qaydalarla avtomatik göndəriş</strong><span>Yalnız ayrıca, geri götürülə bilən icazənlə, gündəlik limit və dayandırma düyməsi ilə. Yoxlanılmadan açılmayacaq.</span></li>}
                <li><strong>Portallarda tam göndəriş</strong><span>Tələbata görə, bir-bir və yalnız etibarlı işlədiyi yoxlanılandan sonra.</span></li>
              </ul>
            </div>
          </div>
        </section>
        <section className={styles.audiences} aria-labelledby="audiences-title">
          <h2 id="audiences-title" className={styles.sectionLabel}>KİMİN ÜÇÜNDÜR</h2>
          <div className={styles.audienceGrid}>
            <article>
              <h3>Namizədlər</h3>
              <p>Tələbə, məzun, təcrübəli mütəxəssis və ya sahəsini dəyişən: profilini qur, uyğun elanlara hazırlıqlı müraciət et və hamısını bir yerdə izlə.</p>
              <div><Link href="/register">Ödənişsiz başla <ArrowUpRight size={15} aria-hidden="true" /></Link><Link href="/jobs">Elanları araşdır <ArrowUpRight size={15} aria-hidden="true" /></Link></div>
            </article>
            <article>
              <h3>Akademiyalar və universitetlər</h3>
              <p>Tələbələriniz uyğun vakansiyaları tapır və sənədləri hazırlayır; siz kohort tərəqqisini və anonim KPI-ları izləyirsiniz; tələbələrin şəxsi sənədləri onlarda qalır.</p>
              <div><Link href="/institutions">Pilot haqqında <ArrowUpRight size={15} aria-hidden="true" /></Link></div>
            </article>
            <article>
              <h3>İşəgötürənlər</h3>
              <p>Vakansiyanı yerləşdir, müraciətləri və əlavə olunmuş sənədləri bir paneldə yoxla.</p>
              <div><Link href="#employers">İşəgötürənlər üçün <ArrowUpRight size={15} aria-hidden="true" /></Link></div>
            </article>
          </div>
        </section>
        <DocumentBenefits enabled={documentsEnabled} />
        <section id="discover" className={styles.discover} aria-labelledby="discover-title">
          <div className={styles.discoverHeader}>
            <div><p className={styles.sectionLabel}>VAKANSİYALAR</p><h2 id="discover-title">Sənin sahən.<br /><span>Sənin imkanın.</span></h2></div>
            <form action="/jobs" method="get" role="search" className={styles.search}>
              <label htmlFor="home-job-search" className={styles.srOnly}>Vəzifə və ya şirkət axtar</label>
              <Search size={19} aria-hidden="true" />
              <input id="home-job-search" name="q" type="search" maxLength={100} placeholder="Vəzifə və ya şirkət" />
              <button type="submit" aria-label="Vakansiya axtar"><ArrowRight size={20} aria-hidden="true" /></button>
            </form>
          </div>
          <div className={styles.categories}>
            {categories.map((category, i) => (
              <Link key={category.key} href={category.key === 'all' ? '/jobs' : `/jobs?category=${category.key}`} className={styles.category}>
                <span className={styles.categoryNumber}>0{i + 1}</span>
                <span><strong>{category.label}</strong><small>{category.detail}</small></span>
                <ArrowUpRight size={23} aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>
        <EmployerSection plans={employerPlans} />
        <section className={styles.pricingBand} aria-labelledby="pricing-title">
          <div>
            <h2 id="pricing-title">Ödənişsiz başla. <span>Lazım olanda planı artır.</span></h2>
            <p>Vakansiyalar, profil və müraciət cədvəli hamı üçün ödənişsizdir. Planlar sənəd və e-poçt müraciəti sayını artırır.</p>
            {plans && (
              <ul className={styles.planStrip} aria-label="Namizəd planları">
                {(['free', 'plus', 'premium'] as const).map((id) => {
                  const p = plan(id)!;
                  return (
                    <li key={id}>
                      <strong>{id === 'free' ? 'Ödənişsiz' : id === 'plus' ? 'Plus' : 'Premium'}{p.price ? <span> · {p.price} AZN/ay</span> : null}</strong>
                      <span>{allowanceText(p.documents, 'sənəd')}</span>
                      <span>{allowanceText(p.emailApplications, 'e-poçt müraciəti')}</span>
                      {p.browserAssistant && <span>Brauzer köməkçisi</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <Link href="/pricing" className={styles.docsAction}>Planları müqayisə et <ArrowUpRight size={17} aria-hidden="true" /></Link>
        </section>
        <CareerGuides />
        <section id="faq" className={styles.faq} aria-labelledby="faq-title">
          <h2 id="faq-title">Tez-tez verilən suallar</h2>
          <div>
            {faqFor(automationOn).map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>
        <section id="features" className={styles.closing} aria-labelledby="closing-title">
          <div className={styles.closingFlower} aria-hidden="true">✳</div>
          <div className={styles.closingContent}>
            <p className={styles.sectionLabel}>SƏNİN KARYERAN. SƏNİN QƏRARIN.</p>
            <h2 id="closing-title">Profilini qur.<br /><span>Qalanını birlikdə edək.</span></h2>
            <Link href="/register" className={styles.lightAction}>Ödənişsiz başla <ArrowUpRight size={20} aria-hidden="true" /></Link>
            <p>Kart tələb olunmur. Elanlara baxmaq üçün qeydiyyat lazım deyil.</p>
          </div>
          <Link href="/business/register" className={styles.employerLink}>İşəgötürənsiniz? <span>Vakansiya yerləşdirin <ArrowUpRight size={15} aria-hidden="true" /></span></Link>
        </section>
      </main>
      <footer className={styles.footer}>
        <div className={styles.footerTop}>
          <BrandLogo className={styles.logo} />
          <span>Müraciətini hazırlayır, qərarı sənə saxlayır.</span>
          <Link href="/contact">Gəlin danışaq <ArrowUpRight size={15} aria-hidden="true" /></Link>
        </div>
        <div className={styles.footerBottom}>
          <span>© {new Date().getFullYear()} AISE</span>
          <nav aria-label="Məhsul">
            <Link href="/jobs">Vakansiyalar</Link><Link href="/companies">Şirkətlər</Link><Link href="/pricing">Planlar</Link><Link href="/blog">Məqalələr</Link><Link href="/institutions">Akademiyalar üçün</Link><Link href="/business/register">İşəgötürənlər</Link>
          </nav>
          <nav aria-label="Hüquqi və əlavə məlumatlar">
            <Link href="/about">Haqqımızda</Link><Link href="/terms">Şərtlər</Link><Link href="/privacy">Məxfilik</Link><Link href="/legal">Hüquqi məlumatlar</Link>
          </nav>
          <span className={styles.madeIn}>Bakıdan, sənin üçün <span aria-hidden="true">↗</span></span>
        </div>
      </footer>
    </div>
  );
}

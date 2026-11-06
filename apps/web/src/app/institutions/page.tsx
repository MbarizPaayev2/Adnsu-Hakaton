import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check, GraduationCap, ShieldCheck } from 'lucide-react';
import { SiteNav } from '@/components/landing/site-nav';
import { SiteFooter } from '@/components/landing/site-footer';
import { InstitutionEnquiryForm } from '@/components/institutions/enquiry-form';

export const metadata: Metadata = {
  title: 'Akademiyalar və universitetlər üçün — AISE',
  description: 'Tələbələrinizə uyğun vakansiyaları tapmaq, müraciət hazırlamaq və iş axtarışını izləmək üçün AISE təqdim edin. Akademiyalar və universitetlər üçün pilot əməkdaşlıq.',
};

const studentSteps = [
  { title: 'Profilini hazırlayır', text: 'CV və ya LinkedIn PDF-dən məlumatları daxil edir, oxunanları yoxlayır və düzəldir. Layihələrini və kursda qazandığı bacarıqları əlavə edir.' },
  { title: 'Uyğun vakansiyanı seçir', text: 'Vakansiyanın tələblərini öz profili ilə müqayisə edir. Profildə çatışmayan bacarığı yalnız həqiqətən sahibdirsə təsdiqləyib əlavə edir.' },
  { title: 'Müraciətini hazırlayır', text: 'Vakansiyaya uyğun CV və motivasiya məktubunu yoxlayır. Dəstəklənən e-poçt müraciətini təsdiqləyir və ya işəgötürənin formasını brauzer köməkçisi ilə doldurur.' },
  { title: 'Növbəti addımı izləyir', text: 'Müraciətlərini bir cədvəldə saxlayır, mərhələni yeniləyir, qeydlər və növbəti addım əlavə edir.' },
];

const pilotSteps = [
  ['Birlikdə planlaşdıraq', 'Qrupunuzu, hədəf peşələri, tələbə sayını, istifadə limitlərini və ölçəcəyimiz nəticələri razılaşdıraq.'],
  ['Tələbələri qoşaq', 'Bir aylıq pilotda hesabların qurulmasına və ilk müraciətin hazırlanmasına dəstək verək.'],
  ['Nəticəni qiymətləndirək', 'Həftəlik ümumi hesabat və tələbə rəyi ilə nəyin işlədiyini ölçək, sonra davam qərarını birlikdə verək.'],
];

/** Interest-led offer. The institutional dashboard is a future pilot proposal, not a live product. */
export default function InstitutionsPage() {
  const price = process.env.NEXT_PUBLIC_INSTITUTION_PILOT_PRICE;
  return (
    <div className="min-h-screen bg-background-warm text-neutral-dark">
      <SiteNav />
      <main>
        <section className="px-5 pb-16 pt-32 sm:px-8 lg:px-16 lg:pb-24 lg:pt-40">
          <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
            <div>
              <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-white/70 px-4 py-2 text-sm font-medium text-primary"><GraduationCap size={18} aria-hidden="true" /> Akademiyalar · kurslar · universitetlər</p>
              <h1 className="text-4xl font-semibold leading-[1.12] tracking-tight text-primary sm:text-5xl lg:text-6xl">Təhsildən ilk işə gedən yolda tələbələrinizin yanında olun.</h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-neutral-dark/75">AISE-ni tələbələrinizə karyera dəstəyi kimi təqdim edin. Uyğun vakansiyadan hazırlanmış müraciətə qədər təkrarlanan işi azaldaq, tələbənin özünü göstərməsinə daha çox yer açaq.</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a href="#enquiry" className="ui-btn ui-btn-primary gap-2">Pilot əməkdaşlığı müzakirə edək <ArrowRight size={18} aria-hidden="true" /></a>
                <a href="#student-journey" className="ui-btn ui-btn-secondary">Tələbə necə istifadə edir?</a>
              </div>
              <p className="mt-4 text-sm text-neutral-dark/65">İlkin sorğu ödəniş və ya öhdəlik yaratmır.</p>
            </div>
            <aside aria-label="Pilotun məqsədi" className="rounded-3xl bg-primary p-7 text-white sm:p-9">
              <span className="inline-flex rounded-full bg-highlight px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">Tələbələriniz üçün əlavə dəyər</span>
              <h2 className="mt-6 text-2xl font-semibold leading-snug sm:text-3xl">Öyrəndiklərini real müraciətə çevirsinlər.</h2>
              <ul className="mt-7 space-y-5">
                {['Vakansiyaya uyğun CV və motivasiya məktubu', 'Çatışmayan profil məlumatları üçün yönləndirmə', 'Təsdiqlə göndərilən e-poçt müraciətləri', 'İş axtarışı və müraciətlər bir yerdə'].map((text) => (
                  <li key={text} className="flex items-start gap-3 text-sm leading-relaxed sm:text-base"><Check className="mt-0.5 shrink-0 text-highlight" size={19} aria-hidden="true" /><span>{text}</span></li>
                ))}
              </ul>
              <p className="mt-7 border-t border-white/20 pt-5 text-sm leading-relaxed text-white/75">Tələbə sənədlərini yoxlayır və göndərişi təsdiqləyir. İşəgötürən portallarında dəstək formanın imkanlarından asılıdır.</p>
            </aside>
          </div>
        </section>

        <section id="student-journey" aria-labelledby="journey-title" className="scroll-mt-24 border-y border-primary/10 bg-white px-5 py-16 sm:px-8 lg:px-16">
          <div className="mx-auto max-w-6xl">
            <p className="text-sm font-semibold text-primary/70">TƏLƏBƏ TƏCRÜBƏSİ</p>
            <h2 id="journey-title" className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-primary sm:text-4xl">Kurs layihəsindən ilk müraciətə.</h2>
            <div className="mt-10 grid gap-7 sm:grid-cols-2 lg:grid-cols-4">
              {studentSteps.map((step, i) => (
                <div key={step.title}>
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-highlight font-semibold text-primary">{i + 1}</span>
                  <h3 className="mt-5 text-lg font-semibold">{step.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-neutral-dark/75">{step.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="pilot-title" className="px-5 py-16 sm:px-8 lg:px-16 lg:py-24">
          <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-2 lg:gap-16">
            <div>
              <p className="text-sm font-semibold text-primary/70">KİÇİK QRUPLA BAŞLAYAQ</p>
              <h2 id="pilot-title" className="mt-3 text-3xl font-semibold tracking-tight text-primary sm:text-4xl">Əvvəlcə bir pilot. Sonra ehtiyacınıza uyğun sistem.</h2>
              <p className="mt-5 leading-relaxed text-neutral-dark/75">Tələbələr üçün AISE iş axını mövcuddur. Təşkilatlara ayrıca idarəetmə paneli hələ təqdim edilmir. Pilotda qoşulma dəstəyini və razılaşdırılmış ümumi hesabatı komandamız əl ilə təşkil edir.</p>
              <ol className="mt-7 space-y-6">
                {pilotSteps.map(([title, text], i) => (
                  <li key={title} className="flex gap-4"><span className="mt-0.5 font-semibold text-primary/50">0{i + 1}</span><div><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm leading-relaxed text-neutral-dark/75">{text}</p></div></li>
                ))}
              </ol>
              <p className="mt-7 text-sm text-neutral-dark/70">{price ? `Pilot qiyməti: ${price}. Şərtlər yazılı razılaşmada təsdiqlənir.` : 'Qiymət, tələbə sayı və istifadə limitləri pilot razılaşmasında müəyyənləşir.'}</p>
            </div>
            <div className="rounded-3xl border border-primary/15 bg-white p-7 sm:p-8">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary/65">Növbəti mərhələ · planlaşdırılan imkanlar</p>
              <h3 className="mt-3 text-2xl font-semibold text-primary">Qrupunuzun karyera yolunu birlikdə izləyək.</h3>
              <p className="mt-4 text-sm leading-relaxed text-neutral-dark/75">Pilot marağı və real ehtiyaclar təsdiqləndikdən sonra akademiya panelini qura bilərik:</p>
              <ul className="mt-5 space-y-4 text-sm leading-relaxed">
                <li className="border-b border-primary/10 pb-4"><strong>Qrup və dəvətlər</strong><br />Tələbələrin qoşulması, aktivləşməsi və proqram üzrə qruplaşdırılması.</li>
                <li className="border-b border-primary/10 pb-4"><strong>Karyera irəliləyişi</strong><br />Profil hazırlığı, müraciət mərhələləri və tələbənin paylaşdığı müsahibə nəticələri.</li>
                <li><strong>Məsləhətçi üçün ümumi görünüş</strong><br />Dəstəyə ehtiyac olan mərhələlər və razılıq əsasında paylaşılan məlumatlar.</li>
              </ul>
              <p className="mt-6 rounded-xl bg-background-warm p-4 text-sm leading-relaxed text-neutral-dark/75">Bu panel hazır xidmət kimi satılmır. İlk tərəfdaşlarla onun ehtiyaclarını və məxfilik qaydalarını birlikdə müəyyənləşdirəcəyik.</p>
            </div>
          </div>
        </section>

        <section aria-labelledby="privacy-title" className="px-5 pb-16 sm:px-8 lg:px-16">
          <div className="mx-auto flex max-w-6xl flex-col gap-5 rounded-3xl border border-primary/15 bg-primary/5 p-7 sm:flex-row sm:p-8">
            <ShieldCheck size={28} className="shrink-0 text-primary" aria-hidden="true" />
            <div><h2 id="privacy-title" className="text-xl font-semibold text-primary">Tələbənin hesabı və seçimi özündə qalır.</h2>
              <p className="mt-3 leading-relaxed text-neutral-dark/75">Təşkilata fərdi CV və müraciət ünvanları avtomatik açılmır. Pilot hesabatları ümumiləşdirilir; kiçik qruplarda şəxsi müəyyən etməyə imkan verən nəticələr paylaşılmır. Sənədlər yalnız tələbə özü paylaşdıqda göstərilir.</p>
              <p className="mt-3 text-sm leading-relaxed text-neutral-dark/70">AISE-də qeydə alınan göndərişlə tələbənin özü bildirdiyi müsahibə və işə qəbul nəticəsi ayrıca göstərilməlidir. Müsahibə və işə qəbul zəmanəti verilmir. Pilot bitdikdə hesab, profil və sənədlər tələbədə qalır.</p>
            </div>
          </div>
        </section>

        <section id="enquiry" aria-labelledby="enquiry-title" className="scroll-mt-24 px-5 pb-24 sm:px-8 lg:px-16">
          <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
            <div><p className="text-sm font-semibold text-primary/70">ƏMƏKDAŞLIQ ÜÇÜN İLK ADDIM</p><h2 id="enquiry-title" className="mt-3 text-3xl font-semibold tracking-tight text-primary sm:text-4xl">Tələbələriniz üçün nəyi dəyişmək istəyirsiniz?</h2>
              <p className="mt-5 leading-relaxed text-neutral-dark/75">Qrupunuz barədə qısa məlumat yazın. Uyğun pilotu müzakirə etmək üçün sizinlə əlaqə saxlayaq.</p>
              <p className="mt-6 text-sm text-neutral-dark/70">Sualınız var? <Link href="/contact" className="text-primary underline underline-offset-4">Bizimlə əlaqə saxlayın</Link>.</p>
            </div>
            <div className="rounded-3xl border border-primary/15 bg-white p-6 sm:p-8"><InstitutionEnquiryForm /></div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

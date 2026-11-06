import Link from 'next/link';
import { ArrowUpRight, Check, ClipboardCheck, FilePlus2, Users } from 'lucide-react';
import { PRODUCT_SPEC } from '@aise/shared-types';
import styles from '@/app/home.module.css';
import type { EmployerPlansTeaser } from '@/lib/employer-plans-public';

const copy = PRODUCT_SPEC.positioning;

/**
 * Availability comes from the public server capability; unknown never claims a working feature.
 * No success rate, interview promise, ATS claim or Harvard endorsement (docs/cv-harvard-template-evidence-2026-10-03.md).
 */
export function DocumentBenefits({ enabled = false }: { enabled?: boolean | null } = {}) {
  const label = enabled === true ? 'Hazırdır' : enabled === false ? 'Tezliklə' : 'Yoxlanılır';
  return (
    <section id="documents" className={styles.docs} aria-labelledby="documents-title">
      <div className={styles.docsCopy}>
        <p className={styles.sectionLabel}>CV VƏ MÜRACİƏT</p>
        <h2 id="documents-title">Hər elana <span>öz sənədləri.</span></h2>
        <p className={styles.docsLead}>Eyni CV-ni hər yerə göndərmək əvəzinə, seçdiyin elan üçün təcrübəni ən aydın göstərən CV və motivasiya məktubu hazırlanır.</p>
        <ul className={styles.docsList}>
          <li>
            <span className={styles.docsIcon} aria-hidden="true"><FilePlus2 size={19} /></span>
            <div><strong>Vakansiyaya uyğun CV <em className={styles.soon}>{label}</em></strong><small>{enabled === true ? 'Harvard CV şablonu əsasında hazırlanır; yalnız təsdiqlədiyin faktlar istifadə olunur.' : enabled === false ? 'Harvard CV şablonu əsasında olacaq; yalnız profilindəki faktlar istifadə ediləcək. Hələ əlçatan deyil.' : 'Harvard CV şablonu əsasında. Əlçatanlıq hazırda yoxlanıla bilmir.'}</small></div>
          </li>
          <li>
            <span className={styles.docsIcon} aria-hidden="true"><ClipboardCheck size={19} /></span>
            <div><strong>Fərdi motivasiya məktubu <em className={styles.soon}>{label}</em></strong><small>{enabled === true ? 'Təsdiqlədiyin təcrübə və seçdiyin vakansiya əsasında hazırlanır. Sən mətni yoxlayıb təsdiqləyirsən.' : enabled === false ? 'Ümumi cümlələr əvəzinə, sənin konkret təcrübən və seçdiyin vakansiya əsasında hazırlanacaq. Hələ əlçatan deyil.' : 'Təcrübən və seçdiyin vakansiya əsasında. Əlçatanlıq hazırda yoxlanıla bilmir.'}</small></div>
          </li>
          <li>
            <span className={styles.docsIcon} aria-hidden="true"><Check size={19} /></span>
            <div><strong>Göndərməzdən əvvəl sən yoxlayırsan</strong><small>Sənin təsdiqin olmadan heç nə göndərilmir.</small></div>
          </li>
        </ul>
        <p className={styles.docsNote}>Məqsəd daha aydın və vakansiyaya daha uyğun müraciətlərdir; müsahibə vəd edilmir. {copy.finePrintAz}</p>
        <Link href="/register" className={styles.docsAction}>Ödənişsiz hesab yarat <ArrowUpRight size={17} aria-hidden="true" /></Link>
      </div>
      <figure className={styles.docFigure}>
        <div className={styles.docSheet} aria-hidden="true">
          <span className={styles.docName} />
          <span className={styles.docContact} />
          <b>TƏHSİL</b>
          <span className={styles.docLine} /><span className={`${styles.docLine} ${styles.docShort}`} />
          <b>TƏCRÜBƏ</b>
          <span className={styles.docLine} /><span className={styles.docLine} /><span className={`${styles.docLine} ${styles.docShort}`} />
          <b>BACARIQLAR</b>
          <span className={`${styles.docLine} ${styles.docShort}`} />
        </div>
        <figcaption>Nümunə sənəd quruluşu — illüstrasiya. Real CV deyil.</figcaption>
      </figure>
    </section>
  );
}

/** Employer pitch: only capabilities of the existing workspace (publish, review applicants, manage applications). No prices, counts, logos or testimonials. */
export function EmployerSection({ plans = null }: { plans?: EmployerPlansTeaser | null } = {}) {
  return (
    <section id="employers" className={styles.employer} aria-labelledby="employer-title">
      <div className={styles.employerCopy}>
        <p className={styles.sectionLabel}>İŞƏGÖTÜRƏNLƏR ÜÇÜN</p>
        <h2 id="employer-title">Vakansiyanı yaz.<br /><span>Müraciətləri yoxla.</span></h2>
        <div className={styles.employerActions}>
          <Link href="/business/register" className={styles.primaryAction}>İşəgötürən kimi qeydiyyat <ArrowUpRight size={19} aria-hidden="true" /></Link>
          <Link href="/business/login" className={styles.textAction}>Panelə daxil ol <ArrowUpRight size={17} aria-hidden="true" /></Link>
        </div>
      </div>
      <ol className={styles.employerSteps}>
        <li><span aria-hidden="true"><FilePlus2 size={18} /></span><div><strong>Vakansiya yerləşdir</strong><small>Təsvir, tələblər və son tarix.</small></div></li>
        <li><span aria-hidden="true"><Users size={18} /></span><div><strong>Namizədləri yoxla</strong><small>Müraciətləri və əlavə edilmiş sənədləri bir yerdə gör.</small></div></li>
        <li><span aria-hidden="true"><ClipboardCheck size={18} /></span><div><strong>Müraciətləri idarə et</strong><small>Hər müraciətin statusunu özün yenilə.</small></div></li>
      </ol>
      {plans && (
        <div className={styles.employerPlans}>
          <p className={styles.sectionLabel}>PLANLAR</p>
          <ul aria-label="İşəgötürən planları">
            <li><strong>Sınaq</strong><span>İlk vakansiya {plans.trialDays} gün ödənişsiz, kart tələb olunmur. Hər şirkət üçün bir dəfə.</span></li>
            <li><strong>Tək vakansiya</strong><span>{plans.singlePrice !== null ? `${plans.singlePrice} AZN, bir dəfəlik, ${plans.singleDays} gün. Avtomatik yenilənmir.` : 'Ödəniş hazır olduqda burada elan olunacaq.'}</span></li>
            <li><strong>Biznes</strong><span>{plans.businessPrice !== null ? `${plans.businessPrice} AZN / ay. Vakansiya sayı məhdud deyil, qaydalara uyğun olaraq.` : 'Ödəniş hazır olduqda burada elan olunacaq.'}</span></li>
          </ul>
          <Link href="/pricing" className={styles.textAction}>Planları müqayisə et <ArrowUpRight size={17} aria-hidden="true" /></Link>
        </div>
      )}
    </section>
  );
}

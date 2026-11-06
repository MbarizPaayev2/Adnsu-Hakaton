import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";
import { LEGAL } from "@/lib/legal-config";

export const metadata: Metadata = {
  title: "Xidmət təminatçıları — AISE",
  description:
    "AISE hansı xidmət təminatçılarından istifadə edir, onlara hansı məlumatlar ötürülür və hansı məqsədlə.",
};

/**
 * The register is built from what the codebase actually integrates with, not
 * from a generic vendor list: NVIDIA's hosted NIM endpoint in
 * resume-tailor.service.ts, Resend in email.service.ts, PostHog in
 * posthog-provider.tsx / posthog.service.ts, Dodo Payments in
 * billing.service.ts, and glorri.az in the scrapers and apply-worker adapter.
 */
export default function ServiceProvidersPage() {
  return (
    <LegalPage
      title="Xidmət təminatçıları və ötürmələr"
      intro="Məlumatlarınızın hansı təminatçılara, hansı məqsədlə və hansı rolda ötürüldüyü."
    >
      <section>
        <h2>Reyestr</h2>
        <div className="-mx-4 overflow-x-auto px-4" role="region" aria-label="Cədvəl" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>Təminatçı</th>
              <th>Məqsəd</th>
              <th>Ötürülən məlumat</th>
              <th>Rol</th>
            </tr>
          </thead>
          <tbody>
            <tr id="linkedin-reader">
              <td>Jina AI Reader (istəyə bağlı)</td>
              <td>LinkedIn profilinə birbaşa giriş alınmadıqda ictimai səhifənin oxunması</td>
              <td>Yalnız ayrıca seçdiyiniz halda daxil etdiyiniz LinkedIn profil ünvanı və həmin profilin ictimai səhifəsindəki məlumatlar. AISE-dəki CV faylınız, parolunuz və hesab məlumatlarınız ötürülmür</td>
              <td>Alternativ oxuma xidməti; emal Azərbaycan xaricində baş verə bilər. PDF və mətn idxalı üçün istifadə edilmir</td>
            </tr>
            <tr>
              <td>NVIDIA (hostinq edilən NIM modeli)</td>
              <td>CV-nin vakansiyaya uyğun fərdiləşdirilməsi</td>
              <td>
                CV məzmunu, karyera profili və vakansiya təsviri. Şəxsiyyət
                sənədi və birdəfəlik kodlar ötürülmür
              </td>
              <td>Bizim göstərişimizlə emal edən təminatçı</td>
            </tr>
            <tr>
              <td>Resend</td>
              <td>Hesab və xidmət e-poçtları</td>
              <td>E-poçt ünvanı, ad və mesaj məzmunu</td>
              <td>Bizim göstərişimizlə emal edən təminatçı</td>
            </tr>
            <tr>
              <td>PostHog</td>
              <td>Könüllü məhsul analitikası</td>
              <td>
                Səhifə yolu, hadisə adı və hesab identifikatoru — yalnız
                icazə verdikdən sonra
              </td>
              <td>Bizim göstərişimizlə emal edən təminatçı</td>
            </tr>
            <tr>
              <td>Google Analytics</td>
              <td>Könüllü sayt ölçümü</td>
              <td>
                Səhifə yolu (sorğu parametrləri olmadan), brauzer və cihaz
                məlumatı — yalnız icazə verdikdən sonra
              </td>
              <td>Bizim göstərişimizlə emal edən təminatçı</td>
            </tr>
            <tr>
              <td>Dodo Payments</td>
              <td>Ödəniş səhifəsi və təkrarlanan abunəlik</td>
              <td>
                E-poçt, ad, abunəlik və əməliyyat məlumatları.{" "}
                <strong>Kart məlumatları AISE-yə çatmır</strong>
              </td>
              <td>Ödəniş xidməti — öz məqsədlərini özü təyin edir</td>
            </tr>
            <tr>
              <td>glorri.az</td>
              <td>
                Vakansiya mənbəyi və sizin göstərişinizlə müraciətin
                göndərildiyi xidmət
              </td>
              <td>
                Yalnız konkret müraciət üçün təsdiqlədiyiniz CV və cavablar
              </td>
              <td>
                Müstəqil alıcı — işə qəbul emalını özü müəyyən edir
              </td>
            </tr>
            <tr>
              <td>Müraciət etdiyiniz işəgötürənlər</td>
              <td>Müraciətinizin qəbulu və qiymətləndirilməsi</td>
              <td>
                Müraciət axınında göstərilən və sizin təsdiqlədiyiniz
                məlumatlar
              </td>
              <td>Müstəqil alıcı</td>
            </tr>
          </tbody>
        </table>
        </div>
      </section>

      <section>
        <h2>Beynəlxalq ötürmə</h2>
        <p>
          Yuxarıda adı çəkilən təminatçılar beynəlxalq xidmətlərdir və
          məlumatların bir hissəsi {LEGAL.servedCountry} hüdudlarından kənarda
          emal olunur. PostHog və Google Analytics üçün standart region ABŞ ola bilər.
        </p>
        <p>
          Razılıq tələb edən ötürmədən əvvəl təyinatı, məqsədi, məlumat
          kateqoriyalarını və alıcını göstərir və müvafiq icazəni soruşuruq —
          bax <Link href="/privacy">Məxfilik bildirişi</Link>.
        </p>
      </section>

      <section>
        <h2>Öz infrastrukturumuz</h2>
        <p>
          Verilənlər bazası, növbələr və yüklədiyiniz fayllar AISE-nin öz
          idarə etdiyi serverində saxlanılır. Yüklənmiş fayllara — CV,
          şəxsiyyət sənədi şəkli, müraciət əlavələri — giriş yalnız
          autentifikasiya olunmuş sessiya ilə mümkündür.
        </p>
      </section>

      <section>
        <h2>Nəyi etmirik</h2>
        <p>
          CV-nizi ictimai axtarışa açmırıq, profil bazasına kənar
          işəgötürənlərə giriş vermirik və məlumatlarınızı reklam məqsədi ilə
          satmırıq. Bir təminatçının siyahıda olması onun bütün məlumatlara
          çıxışı olduğu demək deyil — hər biri yalnız cədvəldə göstərilən
          məlumatı alır.
        </p>
        <p>
          Suallar üçün{" "}
          <a href={`mailto:${LEGAL.email.privacy}`}>{LEGAL.email.privacy}</a>.
        </p>
      </section>
    </LegalPage>
  );
}

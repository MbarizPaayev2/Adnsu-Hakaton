import { PLAN_WEEKLY_MATCH_QUOTAS, PLAN_PRICES_AZN, PLAN_DAILY_MATCH_QUOTAS, PLAN_MATCH_QUOTAS } from "@aise/shared-types";
import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";
import { LEGAL } from "@/lib/legal-config";

export const metadata: Metadata = {
  title: "Abunəlik və geri ödəniş — AISE",
  description:
    "AISE abunəliklərinin qiyməti, yenilənməsi, ləğvi və geri ödəniş qaydaları, həmçinin qanunla verilən hüquqlarınız.",
};

export default function RefundPage() {
  return (
    <LegalPage
      title="Abunəlik, ləğvetmə və geri ödəniş"
      version="1.1" effectiveDate="2026-10-18"
      intro="Nə üçün ödəyirsiniz, abunəlik necə yenilənir, necə ləğv edilir və hansı hallarda pulunuz geri qaytarılır."
    >
      <section>
        <h2>Ödənişiniz</h2>
        <p>
          Ödənişdən əvvəl planı, daxil olan xüsusiyyətləri, ümumi məbləği və
          valyutanı, ödəniş dövrünü, yenilənmə şərtlərini və ləğvetmə yolunu
          göstəririk. Ödəniş xarici ödəniş xidməti (Dodo Payments) vasitəsilə
          həyata keçirilir və qəbzdə satıcı göstərilir. Ödənişlə bağlı köməklik
          üçün{" "}
          <a href={`mailto:${LEGAL.email.billing}`}>{LEGAL.email.billing}</a>.
        </p>
        <table>
          <thead><tr><th>Plan</th><th>Qiymət (aylıq)</th><th>Yeni iş tövsiyəsi limiti</th></tr></thead>
          <tbody>
            <tr><td>Ödənişsiz</td><td>0 ₼</td><td>Həftədə {PLAN_WEEKLY_MATCH_QUOTAS.FREE}-ə qədər</td></tr>
            <tr><td>Plus</td><td>{PLAN_PRICES_AZN.PLUS} ₼</td><td>Gündə {PLAN_DAILY_MATCH_QUOTAS.PLUS}-ə qədər</td></tr>
            <tr><td>Premium</td><td>{PLAN_PRICES_AZN.PREMIUM} ₼</td><td>Gündə {PLAN_DAILY_MATCH_QUOTAS.PREMIUM}-ə qədər</td></tr>
          </tbody>
        </table>
        <p><strong>İş tövsiyəsi müraciət demək deyil.</strong> Göstərilən say yeni uyğun vakansiyalar olduqda tətbiq olunan yuxarı həddir; eyni elan yenidən tövsiyə edilmir. İşəgötürənin cavabı və ya işə qəbul vədi verilmir.</p>
        <p>Plus və Premium üçün limit hər gün Bakı vaxtı ilə 00:00-da yenilənir. İstifadə olunmayan gündəlik limit yığılmır; ayrıca aylıq tövsiyə limiti yoxdur. Ödənişsiz plan həftədə 3 yeni tövsiyəyə qədərdir; həftə bazar ertəsi Bakı vaxtı ilə 00:00-da yenilənir, istifadə olunmayan limit yığılmır.</p>
        <p>Sənəd və müraciət limitləri ayrıdır: Plus — ayda 30 sənəd və 30 e-poçt müraciəti; Premium — sənədlər üçün aylıq limit yoxdur (eyni anda 3, saatda 30 yaratma qoruması), ayda 100 e-poçt müraciəti və brauzer köməkçisi ilə 50 təsdiqli müraciət. Xidmətin aktivliyi və dəstəklənən müraciət yolları tətbiqdə göstərilir.</p>
        <p>Basic, Standard və Limitsiz yeni satış üçün nəzərdə tutulmur. Əvvəlki müqavilələrə qiymət artımı avtomatik tətbiq edilmir; ödəniş provayderində qəbul etdiyiniz şərtlər və bildiriş qaydaları qüvvədə qalır.</p>
        <p>
          “Limitsiz” yalnız açıq şəkildə göstərilən vahidə aiddir və açıqlanmış
          texniki və qanuni istifadə hədləri çərçivəsindədir. Bu, vakansiyaların
          limitsiz olması demək deyil.
        </p>
      </section>

      <section>
        <h2>Yenilənmə və ləğvetmə</h2>
        <p>
          Təkrarlanan plan ödəniş zamanı qəbul etdiyiniz məbləğ və dövrlə
          yenilənir — ləğv etmədiyiniz halda. Ləğvetməni hesabınızın{" "}
          <Link href="/dashboard/settings">Tənzimləmələr</Link> bölməsindən
          edə bilərsiniz; idarəetmə vasitəsi işləmirsə{" "}
          <a href={`mailto:${LEGAL.email.billing}`}>{LEGAL.email.billing}</a>{" "}
          ünvanına yazın. Ləğvetməni və girişin bitmə tarixini təsdiqləyirik.
        </p>
        <p>
          Adi ləğvetmə ödənilmiş dövrün sonuna qədər girişi saxlayır və növbəti
          yenilənməni dayandırır. Hesabın bağlanması ayrı müraciətdir: gələcək
          yenilənməni dayandırır və adi hesab girişini bitirir, lakin geri
          ödəniş hüququnuzdan imtina demək deyil.
        </p>
      </section>

      <section>
        <h2>Geri ödəniş</h2>
        <p>
          <strong>Qanunla verilən hüquqlar müstəqil tətbiq olunur.</strong>{" "}
          Elektron ticarət haqqında qanunun 9-cu maddəsi müqavilədən imtina
          mexanizmi (<strong>7 iş günü</strong>) və geri ödəniş müddətlərini
          müəyyən edir; 10.2-ci maddə xidmətin göstərilə bilməməsi halını
          tənzimləyir. Bu hüquqlar aşağıdaki kommersiya vədindən asılı deyil.
        </p>
        <p>
          Əlavə olaraq, <strong>ilk ödənişli abunəliyinizdən sonra{" "}
          {LEGAL.refundWindowDays} təqvim günü ərzində</strong> geri ödəniş
          tələb etsəniz, həmin ilk ödənişi qaytarırıq. Bu zəmanət xidmətin
          dərhal başlamasını istəsəniz də qüvvədə qalır. O, daha uzun və ya
          ayrıca tətbiq olunan qanuni hüququ qısaltmır və hər yenilənmədə
          avtomatik təkrarlanmır.
        </p>
        <p>
          Təkrar tutulmuş ödənişləri və ləğvetmə qüvvəyə mindikdən sonra
          tutulan məbləğləri düzəldirik. Ödənişli əhəmiyyətli xidmət
          göstərilə bilmirsə, qanun və razılaşmanın tələb etdiyi kompensasiyanı
          — müvafiq geri ödəniş də daxil olmaqla — təmin edirik.
        </p>
        <p>
          Dövr ortasında adi ləğvetmə halında avtomatik mütənasib geri ödəniş
          nəzərdə tutulmur və giriş dövrün sonuna qədər davam edir.{" "}
          <strong>
            İşəgötürənin müraciətinizi rədd etməsi özlüyündə geri ödəniş əsası
            deyil
          </strong>{" "}
          — başqa müqavilə və ya qanuni əsas olmadıqda.
        </p>
        <p>
          Hesab e-poçtunuzu və əməliyyat nömrəsini{" "}
          <a href={`mailto:${LEGAL.email.billing}`}>{LEGAL.email.billing}</a>{" "}
          ünvanına göndərin — <strong>kart məlumatlarını göndərməyin</strong>.
          İki iş günü ərzində qeydə almağa, beş iş günü ərzində qərar verməyə
          çalışırıq. Qanuni tələb üçün qanunvericiliyin müddəti üstünlük təşkil
          edir. Geri ödəniş ilkin ödəniş üsuluna qaytarılır. Bankın
          əməliyyatı emal müddəti bizim qanuni öhdəliyimizi uzatmır.
        </p>
      </section>

      <section id="isegoturen">
        <h2>İşəgötürən planları: geri ödəniş qaydası</h2>
        <p>
          Bu bölmə şirkət hesabları üçün <strong>Tək vakansiya</strong> (20 AZN,
          bir dəfəlik, 30 gün) və <strong>Biznes</strong> (100 AZN / ay) planlarına
          aiddir. İlk vakansiya üçün 14 günlük <strong>Sınaq</strong> ödənişsizdir və
          geri ödənilməli məbləğ yaranmır. Qiymətlər vergilər daxil yekun
          məbləğdir; ödəniş xarici ödəniş xidməti (Dodo Payments) vasitəsilə
          həyata keçirilir.
        </p>
        <ul>
          <li>
            <strong>İstifadə olunmamış alış.</strong> Tək vakansiya krediti hələ
            heç bir vakansiyada işlənməyibsə, ödənişdən sonra{" "}
            {LEGAL.refundWindowDays} təqvim günü ərzində tam geri ödəyirik. Bu
            müddətdən sonra da istifadə olunmamış kredit üçün sorğunu ayrıca
            nəzərdən keçiririk. Geri ödəniş təsdiqlənəndə kredit ləğv edilir.
          </li>
          <li>
            <strong>AISE tərəfindən çatdırılmayan yayım.</strong> Ödənilmiş
            vakansiya AISE-nin texniki nasazlığı və ya səhvi ucbatından
            yayımlanmayıbsa, yaxud ödənilmiş müddətin bir hissəsində ictimai
            açıq olmayıbsa, bu müddət sizə əlavə olunur və ya seçiminizə görə
            tam geri ödəyirik; bu halda elan dayandırılır, şirkət profili və
            daxil olmuş müraciətlər isə saxlanılır.
          </li>
          <li>
            <strong>Yayımlanmış və göstərilmiş vakansiya.</strong> Fikir
            dəyişikliyi, az sayda müraciət və ya işə qəbul nəticəsi geri ödəniş
            əsası deyil; AISE işə qəbul nəticəsi və ya müəyyən sayda müraciət
            vəd etmir. Elanın qaydalara zidd olduğuna görə dayandırılması da
            geri ödəniş əsası deyil. Qanunla verilən hüquqlarınız qüvvədə qalır.
          </li>
          <li>
            <strong>Biznes abunəliyinin ləğvi.</strong> İstədiyiniz vaxt
            ləğv edə bilərsiniz; abunəlik ödənilmiş dövrün sonuna qədər aktiv
            qalır və yeni dövr üçün ödəniş tutulmur. Cari dövr üçün mütənasib
            geri ödəniş nəzərdə tutulmur. İlk ödənişdən sonra{" "}
            {LEGAL.refundWindowDays} gün ərzində heç bir vakansiya
            yayımlanmayıbsa, ilk ödənişi tam geri ödəyirik.
          </li>
          <li>
            <strong>Platforma xətası.</strong> Təkrar və ya səhvən tutulmuş
            məbləğ, ödənişin alınması ilə yanaşı kreditin və ya abunəliyin
            hesaba yazılmaması, ləğvdən sonra tutulmuş ödəniş tam geri
            ödənilir və ya düzəldilir. Uğursuz ödənişdən heç nə aktivləşmir və
            pul tutulmur.
          </li>
          <li>
            <strong>Ləğv və bitmədən sonra.</strong> Plan bitdikdən, ləğv
            olunduqdan və ya geri ödənildikdən sonra da şirkət profiliniz və
            artıq daxil olmuş müraciətlər sizin üçün əlçatan qalır.
          </li>
        </ul>
        <p>
          Müraciət üçün şirkət hesabının e-poçtunu və ödəniş nömrəsini{" "}
          <a href={`mailto:${LEGAL.email.billing}`}>{LEGAL.email.billing}</a>{" "}
          ünvanına göndərin — <strong>kart məlumatlarını göndərməyin</strong>.
          İki iş günü ərzində qeydə almağa, beş iş günü ərzində qərar
          verməyə çalışırıq. Geri ödəniş ilkin ödəniş üsuluna Dodo Payments
          vasitəsilə qaytarılır; bankın emal müddəti bizim öhdəliyimizi uzatmır.
        </p>
      </section>

      <section>
        <h2>Dəyişikliklər və uğursuz ödənişlər</h2>
        <p>
          Plan dəyişikliyi qəbul edilməzdən əvvəl onun məbləği, kreditləri və
          qüvvəyə minmə tarixi göstərilir. Qəbul edilən təklifdə göstərilmədiyi
          halda mütənasib bölgü (proration) vəd edilmir.
        </p>
        <p>
          Yenilənmə ödənişi alınmazsa, sizə bildiriş veririk və açıqlanmış
          təkrar cəhd/giriş prosedurunu izləyirik.{" "}
          <strong>Sizin xəbəriniz olmadan başqa ödənişli plan yaratmırıq.</strong>{" "}
          Qiymət artımları <Link href="/terms">İstifadə şərtlərindəki</Link>{" "}
          bildiriş və razılıq tələblərinə tabedir.
        </p>
      </section>
    </LegalPage>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, OperatorIdentity } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Haqqımızda — AISE",
  description:
    "AISE nə üçün qurulub, problemi necə həll edir və uyğunluq balı necə hesablanır.",
};

export default function AboutPage() {
  return (
    <LegalPage
      title="Haqqımızda"
      intro="AISE iş axtarışını tərsinə çevirir: siz elanları axtarmaq yerinə, uyğun işlər sizi tapır."
      updatedAt="2026-09-03"
    >
      <section>
        <h2>Həll etdiyimiz problem</h2>
        <p>
          İş axtarmaq vaxt aparan və təkrarlanan işdir: onlarla sayta baxmaq,
          eyni məlumatı yenidən yazmaq, hər vakansiya üçün CV-ni uyğunlaşdırmaq.
          Bu prosesin böyük hissəsi mexanikidir və avtomatlaşdırıla bilər.
        </p>
        <p>
          AISE həmin mexaniki hissəni öz üzərinə götürür. Siz CV-nizi bir dəfə
          yükləyirsiniz — sistem elanları fasiləsiz izləyir, hər birini sizin
          bacarıqlarınızla müqayisə edir və yalnız uyğun olanları uyğunluq balı
          ilə göstərir.
        </p>
      </section>

      <section>
        <h2>Uyğunluq balı necə hesablanır</h2>
        <p>
          Bal təxmin deyil, ölçülə bilən komponentlərin cəmidir və hər elan üçün
          ayrıca hesablanır:
        </p>
        <ul>
          <li>
            <strong>Bacarıqlar</strong> — CV-nizdəki bacarıqların elanın
            tələbləri ilə üst-üstə düşməsi;
          </li>
          <li>
            <strong>Təcrübə</strong> — vəzifə tarixçənizin tələb olunan
            səviyyəyə uyğunluğu;
          </li>
          <li>
            <strong>Yerləşmə və format</strong> — şəhər və iş formatı
            tərcihləriniz;
          </li>
          <li>
            <strong>Mətn oxşarlığı</strong> — profilinizin və elanın mənaca
            yaxınlığı.
          </li>
        </ul>
        <p>
          Balın hansı komponentlərdən ibarət olduğunu həmişə görürsünüz —
          beləliklə hansı işə vaxt ayıracağınıza özünüz qərar verirsiniz.
        </p>
      </section>

      <section>
        <h2>Prinsiplərimiz</h2>
        <ul>
          <li>
            <strong>Şəffaflıq.</strong> Bal “qara qutu” deyil; onun
            komponentləri açıq göstərilir.
          </li>
          <li>
            <strong>Nəzarət sizdədir.</strong> Heç bir müraciət sizin açıq
            təsdiqiniz olmadan göndərilmir.
          </li>
          <li>
            <strong>Məlumatınız sizindir.</strong> CV-nizi satmırıq, reklam
            şəbəkələrinə vermirik və istədiyiniz vaxt silə bilərsiniz.
          </li>
          <li>
            <strong>Ödənişsiz başlanğıc.</strong> Kart məlumatı tələb etmədən
            sınaya bilərsiniz.
          </li>
        </ul>
      </section>

      <section>
        <h2>İşəgötürənlər üçün</h2>
        <p>
          Vakansiyanızı yerləşdirdikdə AISE onu uyğun namizədlərə özü çatdırır
          və müraciətləri bir paneldən idarə etməyə imkan verir.{" "}
          <Link href="/business/register">Şirkət hesabı yaradın</Link>.
        </p>
      </section>

      <section>
        <h2>Şirkət məlumatları</h2>
        <OperatorIdentity />
        <p>
          Bütün hüquqi sənədlərimiz <Link href="/legal">Hüquqi məlumatlar</Link>{" "}
          səhifəsində toplanıb. Suallar və əməkdaşlıq üçün{" "}
          <Link href="/contact">Əlaqə</Link> səhifəsinə baxın.
        </p>
      </section>
    </LegalPage>
  );
}

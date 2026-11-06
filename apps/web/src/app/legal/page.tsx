import type { Metadata } from "next";
import Link from "next/link";
import {
  LegalPage,
  OperatorIdentity,
  ContactBlock,
  LEGAL_DOCUMENTS,
} from "@/components/legal/legal-page";
import { LEGAL } from "@/lib/legal-config";

export const metadata: Metadata = {
  title: "Hüquqi məlumatlar — AISE",
  description:
    "AISE-nin hüquqi sənədləri: istifadə şərtləri, məxfilik bildirişi, müraciət səlahiyyəti, abunəlik və geri ödəniş qaydaları.",
};

export default function LegalHubPage() {
  return (
    <LegalPage
      title="Hüquqi məlumatlar"
      intro="Bütün hüquqi sənədlərimiz bir yerdə. Hər sənəddə versiya və qüvvəyə minmə tarixi göstərilir."
    >
      <section>
        <h2>Xidməti kim təqdim edir</h2>
        <OperatorIdentity />
        <p>
          Hazırda AISE {LEGAL.servedCountry}da yaşayan və{" "}
          {LEGAL.minimumAge} yaşı tamam olmuş istifadəçilərə xidmət göstərir.
        </p>
      </section>

      <section>
        <h2>Əlaqə</h2>
        <ContactBlock />
        <p>
          Kart məlumatlarınızı, birdəfəlik kodları və ya şifrələrinizi heç vaxt
          e-poçt vasitəsilə bizə göndərməyin.
        </p>
      </section>

      <section>
        <h2>Sənədlər</h2>
        <ul>
          {LEGAL_DOCUMENTS.filter((d) => d.href !== "/legal").map((d) => (
            <li key={d.href}>
              <Link href={d.href}>{d.label}</Link>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Nəyi vəd etmirik</h2>
        <p>
          Vakansiyanın platformada yerləşdirilməsi onun hələ də açıq olduğuna
          və ya sizə iş təklifi ediləcəyinə zəmanət deyil. Üçüncü tərəf
          vakansiyaları üçün işəgötürən AISE deyil — qərarı işəgötürən özü
          verir. Uyğunluq balı ehtimal göstəricisidir, işə qəbul proqnozu və ya
          ixtisasınızın təsdiqi deyil.
        </p>
        <p>
          Süni intellektlə hazırlanan mətnlərdə səhvlər ola bilər. Göndərməzdən
          əvvəl bütün məlumatları özünüz yoxlayın.
        </p>
      </section>

      <section>
        <h2>Məcburi hüquqlar</h2>
        <p>
          Bu sənədlərdəki heç bir müddəa qanunvericiliyin sizə verdiyi məcburi
          hüquqları məhdudlaşdırmır. İstehlakçıların hüquqlarının müdafiəsi
          haqqında qanunun 16-cı maddəsinə əsasən istehlakçının qanuni
          hüquqlarını azaldan şərtlər etibarsızdır. Ziddiyyət olduqda
          qanunvericilik üstünlük təşkil edir.
        </p>
      </section>
    </LegalPage>
  );
}

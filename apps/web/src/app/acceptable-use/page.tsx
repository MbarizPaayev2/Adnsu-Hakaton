import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { LEGAL } from "@/lib/legal-config";

export const metadata: Metadata = {
  title: "İstifadə və elan qaydaları — AISE",
  description:
    "AISE-də nəyə icazə verilir, nə qadağandır və şübhəli elanı necə bildirə bilərsiniz.",
};

export default function AcceptableUsePage() {
  return (
    <LegalPage
      title="İstifadə və elan qaydaları"
      intro="AISE qanuni iş axtarışını və işə qəbulu dəstəkləyir. Bu qaydalar hər iki tərəf üçün keçərlidir."
    >
      <section>
        <h2>İş axtaranlar üçün qadağalar</h2>
        <ul>
          <li>Başqa şəxsi təqlid etmək</li>
          <li>İxtisas, təcrübə və ya sənəd uydurmaq</li>
          <li>Səlahiyyət olmadan başqasının CV-sini göndərmək</li>
          <li>Zərərli fayl yükləmək</li>
          <li>Spam şəklində kütləvi müraciət göndərmək</li>
          <li>
            Giriş nəzarətini keçmək və ya xidmətin işini pozmaq
          </li>
        </ul>
      </section>

      <section>
        <h2>İşəgötürənlər üçün qadağalar</h2>
        <ul>
          <li>Aldadıcı və ya mövcud olmayan vakansiya yerləşdirmək</li>
          <li>Qanunsuz ayrı-seçkilik tələbləri qoymaq</li>
          <li>
            Namizəddən nəzərə alınmaq üçün pul tələb etmək və ya piramida
            sxemləri təklif etmək
          </li>
          <li>
            Bank məlumatları, lazımsız şəxsiyyət və ya həssas sənədlər istəmək
          </li>
          <li>
            Namizəd məlumatlarını satmaq, kənar reklam üçün istifadə etmək və ya
            bazadan məlumat çıxarmaq
          </li>
          <li>
            Namizədləri müraciət etmədikləri məqsədlər üçün əlaqə saxlamaq
          </li>
        </ul>
        <p>
          İşə qəbul agentlikləri öz rolunu açıqlamalı və elan üçün səlahiyyətə
          malik olmalıdır.
        </p>
      </section>

      <section>
        <h2>Elanların dəqiqliyi</h2>
        <p>
          Elanlar və könüllü fəaliyyət bildirişləri təşkilatı, fəaliyyəti və
          varsa əmək haqqını dəqiq təsvir etməlidir. Könüllü fəaliyyət
          bildirişləri iş təklifi deyil və xidmətin yaş həddinə ({LEGAL.minimumAge}+)
          tabedir.
        </p>
      </section>

      <section>
        <h2>Bildiriş və nəticələr</h2>
        <p>
          Şübhəli elanı və ya əqli mülkiyyət pozuntusunu{" "}
          <a href={`mailto:${LEGAL.email.abuse}`}>{LEGAL.email.abuse}</a>{" "}
          ünvanına — elanın linki, problemin təsviri və paylaşmaq hüququnuz olan
          dəstəkləyici məlumatla — bildirin.
        </p>
        <p>
          Bildirişləri qiymətləndirir, müvafiq məzmunu müvəqqəti
          məhdudlaşdıra bilər və mümkün olduqda cavab yaxud etiraz imkanı
          veririk.{" "}
          <strong>
            Hər elanın hər cəhətdən təhlükəsiz və yoxlanılmış olduğuna zəmanət
            vermirik.
          </strong>{" "}
          Təcili təhdidləri həmçinin səlahiyyətli orqanlara bildirin.
        </p>
      </section>
    </LegalPage>
  );
}

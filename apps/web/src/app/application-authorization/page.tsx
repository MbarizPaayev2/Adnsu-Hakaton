import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";
import { LEGAL } from "@/lib/legal-config";

export const metadata: Metadata = {
  title: "Müraciət səlahiyyəti — AISE",
  description:
    "AISE sizin adınızdan müraciət edərkən hansı səlahiyyətə malikdir, nə edə bilməz və göstərişi necə dayandıra bilərsiniz.",
};

export default function ApplicationAuthorizationPage() {
  return (
    <LegalPage
      title="Müraciət səlahiyyəti"
      intro="AISE yalnız sizin verdiyiniz konkret müraciət göstərişi çərçivəsində hərəkət edir. Bu, ümumi etibarnamə deyil."
    >
      <section>
        <h2>Hazırkı vəziyyət</h2>
        <p>
          Xarici saytlarda avtomatik müraciət hazırda sınaq mərhələsindədir və
          canlı istifadədə aktiv deyil. AISE daxilində yerləşdirilən
          vakansiyalara müraciət funksiyası aktivdir.
        </p>
      </section>

      <section>
        <h2>Səlahiyyətin hüdudu</h2>
        <p>
          Bu səlahiyyət <strong>yalnız göstərilən müraciətin hazırlanması və
          göndərilməsi</strong> ilə məhdudlaşır. O, ümumi etibarnamə deyil və
          AISE-yə sizin adınızdan başqa öhdəlik qəbul etmək hüququ vermir.
        </p>
      </section>

      <section>
        <h2>Hazırlıq</h2>
        <p>
          AISE xarici formanı doldurmazdan əvvəl ekranda işəgötürən, vakansiya,
          təyinat xidməti, açıqlanacaq məlumatlar və müvafiq
          məxfilik/şərtlər keçidləri göstərilir. Hazırlığa icazə verməklə
          həmin açıqlamaya və formanın doldurulmasına razılıq verirsiniz.
        </p>
        <p>
          <strong>
            Xarici sayt yekun “göndər” düyməsindən əvvəl də məlumat ala bilər.
          </strong>{" "}
          Bunu istəmirsinizsə, mənbə saytda özünüz müraciət edə bilərsiniz.
        </p>
      </section>

      <section>
        <h2>Yoxlama və göndərmə</h2>
        <p>
          Seçilmiş CV və cavabları — süni intellektin etdiyi dəyişikliklər də
          daxil olmaqla — yoxlayın. Yekun təsdiq göstərilən alıcıya yoxladığınız
          məzmunla <strong>bir müraciət</strong> göndərilməsinə icazə verir.
          Məzmunda əhəmiyyətli dəyişiklik yeni təsdiq tələb edir.
        </p>
        <p>
          Könüllü marketinq, gələcək istedad bazası, həssas suallar və ya kənar
          şərtlərə razılığı <strong>nəticə çıxarma yolu ilə qəbul etmirik</strong>.
          Tələb olunan bəyanat ayrıca və etibarlı şəkildə təsdiqlənə bilmirsə,
          onu mənbə saytda özünüz doldurmalısınız.
        </p>
      </section>

      <section>
        <h2>Təsdiqləmə kodları</h2>
        <p>
          Alıcı birdəfəlik kod tələb edərsə, onu həmin müraciət üçün verib
          verməmək sizin seçiminizdir.{" "}
          <strong>
            Bank kodlarını və ya kənar hesab məlumatlarınızı heç vaxt
            verməyin
          </strong>{" "}
          — AISE onları istəmir və istifadə etmir.
        </p>
        <p>
          Bu səlahiyyətdən iş təklifini qəbul etmək, əmək haqqını müzakirə
          etmək, əmək sənədlərini imzalamaq və ya sizin verməmiş olduğunuz
          faktları təsdiq etmək üçün istifadə etmirik.
        </p>
      </section>

      <section>
        <h2>Dayandırma və nəticələr</h2>
        <p>
          Göstərişi icra edilməzdən əvvəl hesabınızdaki idarəetmə vasitələri
          ilə və ya{" "}
          <a href={`mailto:${LEGAL.email.support}`}>{LEGAL.email.support}</a>{" "}
          vasitəsilə dayandıra bilərsiniz. Geri götürmə artıq tamamlanmış
          hərəkəti ləğv etmir.
        </p>
        <p>
          Texniki vaxt aşımı mütləq müraciətin göndərilmədiyi demək deyil —
          bu halda göndərmə qeyri-müəyyən olduğu üçün{" "}
          <strong>avtomatik təkrar müraciət yaratmırıq</strong>. Status
          hazırlıq, məlumat gözlənilir, cəhd, təsdiqlənmiş göndərmə və
          uğursuzluq mərhələlərini mövcud sübutlar həddində fərqləndirir.
        </p>
      </section>

      <section>
        <h2>Qeydlər</h2>
        <p>
          Göstəriş və göndərmə ilə bağlı mütənasib sübutları{" "}
          <Link href="/privacy">Məxfilik bildirişi</Link> çərçivəsində
          saxlayırıq. Bu, bizim icazəsiz davranışımıza görə məsuliyyəti sizə
          keçirmir. İşəgötürənlər göndərilmiş müraciətləri öz öhdəlikləri
          çərçivəsində idarə edirlər.
        </p>
      </section>

      <section>
        <h2>Avtomatik müraciət hansı planda mövcuddur</h2>
        <p>
          Xarici saytlarda avtomatik müraciət canlı istifadəyə açıldıqda plan,
          razılıq və təhlükəsizlik şərtləri bu səhifədə ayrıca göstəriləcək.
        </p>
        <p>
          Sizin iştirakınız olmadan işləyən “dayanıqlı səlahiyyət” rejimi
          hazırda <strong>mövcud deyil</strong>. Belə rejim tətbiq edilərsə,
          o, ayrıca razılaşma — rollar, yerlər, işəgötürən istisnaları, əmək
          haqqı həddi, CV versiyası, təsdiqlənmiş cavablar, günlük limitlər və
          ləğvetmə şərtləri — tələb edəcək. Abunəlik alınması belə səlahiyyət
          demək deyil.
        </p>
      </section>
    </LegalPage>
  );
}

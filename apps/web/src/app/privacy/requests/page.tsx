import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";
import { LEGAL } from "@/lib/legal-config";

export const metadata: Metadata = {
  title: "Məlumat müraciətləri — AISE",
  description:
    "Şəxsi məlumatlarınızla bağlı sorğu, düzəliş, silinmə və şikayət müraciətlərini necə göndərə bilərsiniz.",
};

export default function PrivacyRequestsPage() {
  return (
    <LegalPage
      title="Məlumatlarla bağlı müraciətlər"
      intro="Məlumatlarınız barədə soruşmaq, düzəliş və ya silinmə tələb etmək, icazəni geri götürmək və şikayət etmək üçün."
    >
      <section>
        <h2>Nə tələb edə bilərsiniz</h2>
        <ul>
          <li>Haqqınızda saxlanılan məlumatlar, mənbəyi və istifadəsi barədə sorğu</li>
          <li>Yanlış məlumatın düzəldilməsi</li>
          <li>Məlumatın silinməsi — tətbiq olunduğu hallarda</li>
          <li>Emala etiraz</li>
          <li>Verdiyiniz icazənin geri götürülməsi</li>
          <li>Məxfiliklə bağlı şikayət</li>
        </ul>
      </section>

      <section>
        <h2>Necə göndərmək olar</h2>
        <p>
          Müraciətinizi{" "}
          <a href={`mailto:${LEGAL.email.privacy}`}>{LEGAL.email.privacy}</a>{" "}
          ünvanına göndərin. Müraciət növünü, hesab e-poçtunuzu və nə tələb
          etdiyinizi yazın.
        </p>
        <p>
          <strong>
            Şifrə, birdəfəlik kod və ya kart məlumatlarını göndərməyin.
          </strong>{" "}
          Onlar müraciətin baxılması üçün lazım deyil.
        </p>
        <p>
          Şəxsiyyətinizi mütənasib üsulla təsdiqləməyimiz lazım gələ bilər.{" "}
          Hər müraciət üçün şəxsiyyət sənədinin yüklənməsini tələb etmirik.
          Səlahiyyətli nümayəndə səlahiyyətini təsdiq edən sənədlə müraciət
          edə bilər.
        </p>
      </section>

      <section>
        <h2>Müddətlər</h2>
        <p>
          Şəxsi məlumatlar haqqında qanunun 12-ci maddəsi müddətləri müəyyən
          edir və biz onlara riayət edirik:
        </p>
        <table>
          <thead>
            <tr>
              <th>Hərəkət</th>
              <th>Müddət</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Müraciətə cavab</td>
              <td>7 iş günü</td>
            </tr>
            <tr>
              <td>
                Üçüncü tərəflə məsləhətləşmə lazım olduqda əlavə müddət
              </td>
              <td>7 iş günü</td>
            </tr>
            <tr>
              <td>Əsaslandırılmış rədd cavabı</td>
              <td>5 gün</td>
            </tr>
            <tr>
              <td>Əvvəlki alıcıların məlumatlandırılması</td>
              <td>3 gün</td>
            </tr>
          </tbody>
        </table>
        <p>
          Qeydə alınma ilə əsaslı cavab fərqli mərhələlərdir; hər ikisini
          bildiririk.
        </p>
      </section>

      <section>
        <h2>Artıq göndərilmiş müraciətlər</h2>
        <p>
          Məlumat artıq işəgötürənə göndərilmişsə, hansı müraciət olduğunu
          göstərin — öz öhdəliklərimizi yerinə yetirir və sorğunuzu həmin
          alıcıya yönəltməyə kömək edirik. İcazənin geri götürülməsi
          tamamlanmış açıqlamaları geri qaytarmır.
        </p>
      </section>

      <section>
        <h2>Şikayət hüququnuz</h2>
        <p>
          Bizim prosedurumuzu gözləmədən səlahiyyətli dövlət orqanına və ya
          məhkəməyə müraciət edə bilərsiniz. Şəxsi məlumatların mühafizəsi
          üzrə dövlət reyestri:{" "}
          <a href="https://registry.pdp.az/" target="_blank" rel="noreferrer">
            registry.pdp.az
          </a>
          .
        </p>
        <p>
          Məlumatların hansı məqsədlə saxlandığı barədə ətraflı məlumat{" "}
          <Link href="/privacy">Məxfilik bildirişindədir</Link>.
        </p>
      </section>
    </LegalPage>
  );
}

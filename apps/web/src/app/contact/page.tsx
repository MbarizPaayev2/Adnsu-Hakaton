import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";
import { LEGAL } from "@/lib/legal-config";

export const metadata: Metadata = {
  title: "Əlaqə və dəstək — AISE",
  description:
    "AISE dəstək kanalları, tez-tez verilən suallar və müraciət qaydası.",
};

const FAQ = [
  {
    q: "AISE ödənişsizdir?",
    a: "Ödənişsiz plan var və kart məlumatı tələb etmir. Ayda 3 uyğunluq alırsınız. Daha çox uyğunluq üçün ödənişli planlar mövcuddur.",
  },
  {
    q: "CV-mi yükləməsəm işləyəcək?",
    a: "Xeyr. Uyğunluq balı CV-nizlə elanın tələblərinin müqayisəsinə əsaslanır, ona görə əsas CV mütləqdir.",
  },
  {
    q: "Uyğunluq tapılmırsa nə etməli?",
    a: "Profilinizdə bacarıqlar, yerləşmə və iş tərcihlərinin doldurulduğundan əmin olun. Tərcihlər çox dar olduqda uyğun elan sayı azalır.",
  },
  {
    q: "Müraciət mənim adımdan göndərilirmi?",
    a: "Yalnız siz təsdiq etdikdən sonra. Sistem forması doldurur, göndərməzdən əvvəl sizə göstərir və təsdiqinizi gözləyir.",
  },
  {
    q: "Hesabımı necə silə bilərəm?",
    a: "Hesab ayarlarından. Silinmə zamanı profil, CV və uyğunluq məlumatları silinir.",
  },
  {
    q: "Abunəliyi necə ləğv edirəm?",
    a: "Hesab ayarlarından. Ödəniş etdiyiniz dövrün sonuna qədər plan aktiv qalır.",
  },
];

export default function ContactPage() {
  return (
    <LegalPage
      title="Əlaqə və dəstək"
      intro="Sualınız varsa, əvvəlcə aşağıdaki suallara baxın — cavabı yoxdursa bizə yazın."
      updatedAt="2026-09-03"
    >
      <section>
        <h2>Dəstək kanalları</h2>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Dəstək kanalları cədvəli">
        <table>
          <thead>
            <tr>
              <th>Mövzu</th>
              <th>Ünvan</th>
              <th>Cavab müddəti</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Ümumi dəstək</td>
              <td>
                <a className="tap-inline" href={`mailto:${LEGAL.email.support}`}>{LEGAL.email.support}</a>
              </td>
              <td>1–2 iş günü</td>
            </tr>
            <tr>
              <td>Ödəniş və abunəlik</td>
              <td>
                <a className="tap-inline" href={`mailto:${LEGAL.email.billing}`}>{LEGAL.email.billing}</a>
              </td>
              <td>1–2 iş günü</td>
            </tr>
            <tr>
              <td>Məxfilik və məlumatlar</td>
              <td>
                <a className="tap-inline" href={`mailto:${LEGAL.email.privacy}`}>{LEGAL.email.privacy}</a>
              </td>
              <td>30 günə qədər</td>
            </tr>
            <tr>
              <td>İşəgötürən əməkdaşlığı</td>
              <td>
                <a className="tap-inline" href={`mailto:${LEGAL.email.support}`}>{LEGAL.email.support}</a>
              </td>
              <td>1–2 iş günü</td>
            </tr>
          </tbody>
        </table>
        </div>
        <p>
          Müraciətinizi sürətləndirmək üçün hesabınızın e-poçt ünvanını və
          problemin baş verdiyi səhifəni qeyd edin.
        </p>
      </section>

      <section>
        <h2>Tez-tez verilən suallar</h2>
        {FAQ.map((item) => (
          <div key={item.q}>
            <h3>{item.q}</h3>
            <p>{item.a}</p>
          </div>
        ))}
      </section>

      <section>
        <h2>Hüquqi sənədlər</h2>
        <p>
          <Link href="/terms">İstifadə şərtləri</Link> ·{" "}
          <Link href="/privacy">Məxfilik siyasəti</Link> ·{" "}
          <Link href="/cookies">Kuki siyasəti</Link> ·{" "}
          <Link href="/refund">Ödəniş və geri qaytarma</Link>
        </p>
      </section>
    </LegalPage>
  );
}

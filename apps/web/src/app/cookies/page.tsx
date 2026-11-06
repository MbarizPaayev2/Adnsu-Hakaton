import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";
import { LEGAL } from "@/lib/legal-config";

export const metadata: Metadata = {
  title: "Kuki və analitika — AISE",
  description:
    "AISE hansı kuki və brauzer yaddaşından istifadə edir, hansıları zəruridir və könüllü analitika seçimini necə dəyişə bilərsiniz.",
};

export default function CookiesPage() {
  return (
    <LegalPage
      title="Kuki və analitika"
      intro="Zəruri yaddaş vasitələri və könüllü analitika arasındaki fərq, tam inventar və seçiminizi dəyişmə yolu."
    >
      <section>
        <h2>Nədən istifadə edirik</h2>
        <p>
          Hesab sessiyalarını saxlamaq, girişi qorumaq və məxfilik
          seçimlərinizi yadda saxlamaq üçün zəruri yaddaş vasitələrindən
          istifadə edirik. Könüllü analitika AISE-dən necə istifadə edildiyini
          anlamağa kömək edir.
        </p>
        <p>
          <strong>
            Könüllü analitika siz icazə verməyincə işə düşmür.
          </strong>{" "}
          Ondan imtina etmək əsas hesab funksiyalarına təsir etmir. Seçiminizi
          istənilən vaxt dəyişə bilərsiniz — imtina gələcək toplanmanı
          dayandırır və müvafiq təmizləməni işə salır.
        </p>
      </section>

      <section>
        <h2>İnventar</h2>
        <p>
          Aşağıdakı cədvəl bu quruluşda faktiki olaraq istifadə edilən kuki və
          brauzer yaddaşını göstərir.
        </p>
        <div className="-mx-4 overflow-x-auto px-4" role="region" aria-label="Cədvəl" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>Ad</th>
              <th>Növ</th>
              <th>Məqsəd</th>
              <th>Zəruri?</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>next-auth.session-token</code>
              </td>
              <td>Kuki</td>
              <td>
                İş axtaran hesabına giriş sessiyası (JWT strategiyası)
              </td>
              <td>Zəruri</td>
            </tr>
            <tr>
              <td>
                <code>next-auth.csrf-token</code>
              </td>
              <td>Kuki</td>
              <td>Giriş formasının CSRF müdafiəsi</td>
              <td>Zəruri</td>
            </tr>
            <tr>
              <td>
                <code>next-auth.callback-url</code>
              </td>
              <td>Kuki</td>
              <td>Girişdən sonra qayıdış ünvanı</td>
              <td>Zəruri</td>
            </tr>
            <tr>
              <td>
                <code>business_session</code>
              </td>
              <td>Kuki</td>
              <td>İşəgötürən hesabına giriş sessiyası</td>
              <td>Zəruri</td>
            </tr>
            <tr>
              <td>
                <code>admin_session</code>
              </td>
              <td>Kuki</td>
              <td>Admin panelinə giriş sessiyası</td>
              <td>Zəruri</td>
            </tr>
            <tr>
              <td>
                <code>aise-cookie-consent</code>
              </td>
              <td>Lokal yaddaş</td>
              <td>
                Analitika ilə bağlı seçiminizi yadda saxlayır. Kuki deyil —
                imtina etsəniz, imtina qeydi üçün kuki yaradılmır
              </td>
              <td>Zəruri</td>
            </tr>
            <tr>
              <td>
                <code>ph_*_posthog</code>
              </td>
              <td>Kuki və lokal yaddaş</td>
              <td>
                PostHog məhsul analitikası. Yalnız icazə verdikdən sonra
                yaradılır
              </td>
              <td>Könüllü</td>
            </tr>
            <tr>
              <td>
                <code>_ga</code>, <code>_ga_VKKBWTCEE4</code>
              </td>
              <td>Kuki</td>
              <td>
                Google Analytics ölçümü (səhifə yolu; sorğu parametrləri və
                şəxsi məlumat göndərilmir). Yalnız icazə verdikdən sonra
                yaradılır; imtina etsəniz silinir
              </td>
              <td>Könüllü</td>
            </tr>
          </tbody>
        </table>
        </div>
        <p>
          Xarici ödəniş və işə qəbul saytları öz yaddaşlarını özləri idarə
          edir; həmin saytlara keçdikdə onların qaydaları tətbiq olunur.
        </p>
      </section>

      <section>
        <h2>Seçiminizi necə dəyişə bilərsiniz</h2>
        <p>
          Saytı ilk dəfə açdığınızda “Yalnız zəruri” və “Qəbul edirəm”
          seçimləri bərabər şəkildə təqdim olunur. Seçiminizi dəyişmək üçün
          brauzerin sayt məlumatlarını (lokal yaddaşı) təmizləyin — bundan
          sonra seçim yenidən soruşulacaq.
        </p>
        <p>
          Zəruri təhlükəsizlik və əməliyyat qeydləri{" "}
          <Link href="/privacy">Məxfilik bildirişində</Link> ayrıca izah
          olunur. Onlar analitikadan imtina etdikdən sonra izləməni davam
          etdirmək üsulu deyil.
        </p>
      </section>

      <section>
        <h2>Alıcılar və suallar</h2>
        <p>
          Məlumat alıcıları və ölkələr barədə{" "}
          <Link href="/service-providers">Xidmət təminatçıları</Link>{" "}
          səhifəsinə baxın. Sual və ya silinmə tələbi üçün{" "}
          <a href={`mailto:${LEGAL.email.privacy}`}>{LEGAL.email.privacy}</a>.
        </p>
      </section>
    </LegalPage>
  );
}

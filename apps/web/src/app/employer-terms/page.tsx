import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";
import { LEGAL } from "@/lib/legal-config";

export const metadata: Metadata = {
  title: "İşəgötürən şərtləri — AISE",
  description:
    "Vakansiya yerləşdirən şirkətlər üçün əlavə şərtlər: elanların dəqiqliyi, namizəd məlumatlarının qorunması və məsuliyyət.",
};

export default function EmployerTermsPage() {
  return (
    <LegalPage
      title="İşəgötürən şərtləri"
      intro="Bu əlavə şərtlər AISE-də vakansiya yerləşdirən şirkətlərə tətbiq olunur və səlahiyyətli nümayəndə tərəfindən qəbul edilir."
    >
      <section>
        <h2>1. Tətbiq dairəsi</h2>
        <p>
          Bu şərtlər hesabında göstərilən şirkətə tətbiq olunur.{" "}
          <Link href="/terms">AISE İstifadə şərtləri</Link> də qüvvədədir.
          Vakansiya planları (Sınaq, Tək vakansiya, Biznes), müddətləri və elan
          qaydaları 10-cu bənddə təsvir olunur.
        </p>
      </section>

      <section>
        <h2>2. Səlahiyyət və elanlar</h2>
        <p>
          Şirkət və nümayəndə barədə dəqiq məlumat verin. Yalnız işə qəbul
          etməyə səlahiyyətiniz olan <strong>real vakansiyaları</strong>{" "}
          yerləşdirin. Vəzifə, yer, əmək haqqı məlumatı (verildiyi halda),
          uyğunluq kriteriyaları və son tarixləri dəqiq saxlayın. Doldurulmuş
          və ya geri götürülmüş vakansiyaları dərhal silin.
        </p>
        <p>
          Hesabın təsdiqlənməsi yalnız AISE-nin təsvir olunan yoxlamalarını
          apardığını bildirir.{" "}
          <strong>
            Onu dövlət lisenziyası və ya zəmanət kimi təqdim etmək qadağandır.
          </strong>
        </p>
      </section>

      <section>
        <h2>3. Ədalətli işə qəbul</h2>
        <p>
          Yalnız işlə bağlı kriteriyalardan istifadə edin. Qanunsuz
          ayrı-seçkilik tələbləri, aldadıcı imkanlar, piramida sxemləri və ya
          namizəddən nəzərə alınmaq üçün ödəniş tələb edən elanlar qadağandır.
          Bank məlumatları və lazımsız şəxsiyyət yaxud həssas sənədlər istəmək
          olmaz.
        </p>
        <p>
          Süni intellekt balları yalnız yoxlamaya köməkdir —{" "}
          <strong>
            qanuni işə qəbul qərarına görə məsuliyyət sizdə qalır.
          </strong>
        </p>
      </section>

      <section>
        <h2>4. Namizəd məlumatları</h2>
        <p>
          Namizəd məlumatlarına yalnız həmin namizədə açıqlanmış vakansiya və
          işə qəbul məqsədi üçün baxın. Girişi səlahiyyətli əməkdaşlarla
          məhdudlaşdırın.
        </p>
        <p>Qadağandır:</p>
        <ul>
          <li>Profilləri satmaq</li>
          <li>Namizəd bazasından məlumat çıxarmaq (scraping)</li>
          <li>
            Namizədlərlə kənar reklam məqsədi ilə əlaqə saxlamaq
          </li>
          <li>
            Ayrıca əsas və bildiriş olmadan onları gələcək istedad bazasına
            əlavə etmək
          </li>
          <li>
            Məlumatı yalnız hər iki tərəfin AISE-dən istifadə etdiyi üçün başqa
            işəgötürənə açıqlamaq
          </li>
        </ul>
        <p>
          Yüklədiyiniz sənədlər sizin nəzarətinizdə olan kopyalar yaradır. AISE
          hesabının bağlanması onları qeyri-müəyyən müddətə saxlamağa icazə
          vermir.
        </p>
      </section>

      <section>
        <h2>5. Sizin məxfilik öhdəlikləriniz</h2>
        <p>
          Dəqiq işə qəbul məxfilik bildirişi, izlənilən əlaqə kanalı və saxlama
          siyasəti təmin edin. Namizədlərin müraciətlərinə cavab verin və
          düzəliş, məhdudlaşdırma, silinmə və şikayətlərlə bağlı AISE ilə
          əməkdaşlıq edin.
        </p>
      </section>

      <section>
        <h2>6. Təhlükəsizlik və insidentlər</h2>
        <p>
          Giriş məlumatlarını və ixracları qoruyun, əməkdaş işdən ayrıldıqda
          girişini dərhal ləğv edin. AISE-dən əldə edilmiş namizəd
          məlumatlarına icazəsiz giriş aşkar etdikdə{" "}
          <strong>24 saat ərzində</strong>{" "}
          <a href={`mailto:${LEGAL.email.privacy}`}>{LEGAL.email.privacy}</a>{" "}
          ünvanına bildiriş verin.
        </p>
        <p>
          Bu, müqavilə üzrə bildiriş öhdəliyidir və universal qanuni
          hesabatvermə müddəti kimi təqdim edilmir. Müvafiq sübutları
          qoruyun və qanunla tələb olunan bildirişləri verin.
        </p>
      </section>

      <section>
        <h2>7. Məzmun icazələri</h2>
        <p>
          İcazə verdiyiniz elanları və brendinizi işə qəbul xidməti
          çərçivəsində göstərmək üçün AISE-yə məhdud icazə verirsiniz.
          Hüquqlarınız sizdə qalır və lazımi icazələrə malik olduğunuzu təsdiq
          edirsiniz. AISE mübahisəli və ya qanunsuz məzmunu silə və girişi
          mütənasib məhdudlaşdıra bilər.
        </p>
      </section>

      <section>
        <h2>8. Məsuliyyət</h2>
        <p>
          Hər tərəf öz pozuntusuna və qanuni öhdəliklərinə görə məsuliyyət
          daşıyır. İşəgötürən qanunsuz elanlara, namizəd məlumatlarından
          icazəsiz istifadəyə və öz bəyanatlarına görə məsuliyyət daşıyır.
        </p>
        <p>
          Danışıqlar yolu ilə müəyyən edilən istənilən təminat (indemnity) və ya
          fərqli biznes məsuliyyət həddi <strong>ayrıca imzalanmış
          razılaşmada</strong> göstərilməlidir. Bu şərtlər fiziki şəxs
          namizədlərə limitsiz öhdəlik qoymur.
        </p>
      </section>

      <section>
        <h2>9. Girişin bitirilməsi</h2>
        <p>
          Biznes hesabınızı{" "}
          <a href={`mailto:${LEGAL.email.support}`}>{LEGAL.email.support}</a>{" "}
          vasitəsilə bağlaya bilərsiniz. AISE giriş məlumatlarından istifadəni
          dayandırın və saxladığınız namizəd qeydlərini öz qanuni saxlama
          qaydalarınıza uyğun idarə edin.
        </p>
        <p>
          Konfidensiallıq, insidentlə bağlı əməkdaşlıq, yaranmış ödəniş
          öhdəlikləri və mübahisə öhdəlikləri tətbiq olunduğu həddə qüvvədə
          qalır.
        </p>
      </section>

      <section>
        <h2>10. Tariflər, yayım müddəti və elan qaydaları</h2>
        <p>
          Planlar şirkətə aiddir, namizəd planlarından (Plus, Premium) ayrıdır və
          namizədlərin uyğunluq ballarına təsir etmir.
        </p>
        <ul>
          <li>
            <strong>Sınaq:</strong> hər təsdiqlənmiş şirkət üçün bir dəfə, ilk
            vakansiya üçün 14 gün. Müddət vakansiya faktiki yayımlandığı andan
            hesablanır. Kart tələb olunmur. Eyni şirkət adı və ya veb saytı ilə
            sınaq təkrar verilmir.
          </li>
          <li>
            <strong>Tək vakansiya:</strong> 20 AZN, bir dəfəlik, vergilər daxil
            yekun qiymət. Bir vakansiya üçün yayımlandığı gündən 30 gün.
            Avtomatik yenilənmir; əlavə 30 gün yalnız yeni və açıq ödənişlə əldə
            edilir.
          </li>
          <li>
            <strong>Biznes:</strong> ayda 100 AZN, vergilər daxil. Aylıq təkrarlanan
            abunəlikdir, istənilən vaxt ləğv edilə bilər və ödənilmiş dövrün
            sonuna qədər aktiv qalır. Bir təsdiqlənmiş şirkət üçün qaydalara
            uyğun vakansiyaların sayı məhdud deyil; gizli say limiti yoxdur.
          </li>
        </ul>
        <p>
          <strong>Elan qaydaları.</strong> Spam, eyni vakansiyanın təkrar
          nüsxələri, saxta və ya aldadıcı elanlar, namizəddən ödəniş tələb edən
          elanlar qəbul edilmir. Biznes planı yalnız abunə olan şirkətin öz
          vakansiyaları üçündür; başqa şirkətlərin vakansiyalarını agentlik kimi
          yenidən satmaq üçün istifadə edilə bilməz. Pozuntu halında elan
          dayandırıla bilər.
        </p>
        <p>
          <strong>Yoxlama.</strong> Hər yeni vakansiya yayımdan əvvəl AISE
          tərəfindən yoxlanılır. Yoxlama sınaq və ya ödənişi işlətmir; rədd
          edilmiş vakansiya düzəldilib yenidən göndərilə bilər.
        </p>
        <p>
          <strong>Müddət bitəndə.</strong> Yeni müraciətlər dayanır; artıq daxil
          olmuş müraciətlər və namizəd cavabları sizin üçün əlçatan qalır.
          Vakansiyanın son tarixi yayım müddətindən əvvəl çatarsa, elan həmin
          tarixdə bağlanır. Biznes elanlarında ən çox 60 gündən bir “hələ də
          aktualdır” təsdiqi tələb olunur ki, unudulmuş elanlar sonsuz qalmasın.
        </p>
        <p>
          <strong>Ləğv və ödəniş uğursuzluğu.</strong> Biznes abunəliyinin
          yenilənmə ödənişi alınmasa, 3 gün möhlətdən sonra elanlar dayandırılır.
          Məlumatlarınız və müraciətlər silinmir. Abunəlik bərpa olunduqda
          dayandırılmış elanlar öz son tarixləri çərçivəsində yenidən açılır.
        </p>
        <p>
          <strong>Hər planda daxildir:</strong> şirkət profili və loqo, müraciət
          qutusu və namizəd mərhələlərinin idarəsi. Müddət bitdikdən və ya
          ödəniş dayandıqdan sonra da şirkət profiliniz və artıq daxil olmuş
          müraciətlər sizin üçün əlçatan qalır.
        </p>
        <p>
          <strong>Geri ödəniş.</strong> İşəgötürən planları üçün geri ödəniş
          qaydası <Link href="/refund#isegoturen">Abunəlik, ləğvetmə və geri
          ödəniş</Link> səhifəsinin “İşəgötürən planları” bölməsindədir: istifadə
          olunmamış alış, AISE tərəfindən çatdırılmayan yayım, abunəliyin ləğvi
          və platforma xətası. Müraciətinizi{" "}
          <a href={`mailto:${LEGAL.email.billing}`}>{LEGAL.email.billing}</a>{" "}
          ünvanına göndərin; kart məlumatlarını göndərməyin. İşə qəbul nəticəsi
          vəd edilmir və nəticə geri ödəniş əsası deyil.
        </p>
      </section>
    </LegalPage>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, OperatorIdentity } from "@/components/legal/legal-page";
import { LEGAL } from "@/lib/legal-config";

export const metadata: Metadata = {
  title: "Məxfilik bildirişi — AISE",
  description:
    "AISE hansı şəxsi məlumatları toplayır, nə üçün istifadə edir, kimlərə ötürür və hüquqlarınızı necə həyata keçirə bilərsiniz.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Məxfilik bildirişi"
      intro="Hansı məlumatları topladığımız, nə üçün istifadə etdiyimiz, kimlərlə paylaşdığımız və hüquqlarınızı necə həyata keçirə biləcəyiniz."
    >
      <section>
        <h2>Məsuliyyət kimdədir</h2>
        <OperatorIdentity />
        <p>
          Məxfiliklə bağlı bütün suallar üçün{" "}
          <a href={`mailto:${LEGAL.email.privacy}`}>{LEGAL.email.privacy}</a>.
          Müraciət etdiyiniz işəgötürənlər öz məlumat emalına görə ayrıca
          məsuliyyət daşıyırlar.
        </p>
      </section>

      <section>
        <h2>Hansı məlumatları və nə üçün istifadə edirik</h2>
        <table>
          <thead>
            <tr>
              <th>Məlumat</th>
              <th>Xidmət məqsədi</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                Ad, e-poçt, şifrənin heş dəyəri, e-poçt təsdiqi və sessiya
                qeydləri
              </td>
              <td>
                Hesaba giriş, hesabla bağlı bildirişlər və sui-istifadədən
                müdafiə
              </td>
            </tr>
            <tr>
              <td>
                CV-lər, iş və təhsil tarixçəsi, bacarıqlar, karyera
                seçimləri və yer
              </td>
              <td>Uyğunlaşdırma və CV hazırlanması</td>
            </tr>
            <tr>
              <td>Əlaqə məlumatları və vakansiyaya dair cavablar</td>
              <td>
                Göstərişinizlə hazırlanan və göndərilən müraciətin icrası
              </td>
            </tr>
            <tr>
              <td>
                Vətəndaşlıq, doğum tarixi, ünvan və ya şəxsiyyət sənədi kimi
                əlavə məlumatlar
              </td>
              <td>
                Yalnız izah edilmiş və zəruri müraciət tələbi olduqda və sizin
                seçiminizlə. Hər hesab üçün standart tələb deyil
              </td>
            </tr>
            <tr>
              <td>
                Müraciət göstərişləri, versiyalar, nəticələr və məhdud yoxlama
                qeydləri
              </td>
              <td>
                Göstərişlərin icrası və göndərmə ilə bağlı mübahisələrin həlli
              </td>
            </tr>
            <tr>
              <td>
                Abunəlik identifikatorları, ödəniş statusu və əməliyyat
                qeydləri
              </td>
              <td>Ödəniş, dəstək və tələb olunan uçot</td>
            </tr>
            <tr>
              <td>
                İşəgötürən əlaqə şəxsləri, şirkət məlumatları, elanlar və
                səlahiyyətli əməkdaş fəaliyyəti
              </td>
              <td>İşəgötürən hesabının idarə edilməsi</td>
            </tr>
            <tr>
              <td>
                Dəstək yazışmaları və məhdud texniki/təhlükəsizlik qeydləri
              </td>
              <td>Müraciətlərin həlli və xidmətin qorunması</td>
            </tr>
            <tr>
              <td>Könüllü analitika hadisələri və identifikatorlar</td>
              <td>
                Yalnız icazə verdiyiniz halda — xidmətdən istifadənin
                anlaşılması
              </td>
            </tr>
          </tbody>
        </table>
        <p>
          Ödənişlər xarici ödəniş xidməti vasitəsilə həyata keçirilir.{" "}
          <strong>
            Kart nömrələrinizi və ya təhlükəsizlik kodlarınızı AISE dəstəyinə
            göndərməyin
          </strong>{" "}
          — bizə lazım deyil və biz onları saxlamırıq.
        </p>
        <p>
          Lazımsız həssas məlumat istəmirik. Sağlamlıq, inanc, cinayət
          tarixçəsi, şəxsi ailə məsələləri və ya başqa şəxslər barədə
          məlumatları — konkret qanuni proses bunun niyə lazım olduğunu izah
          etmədikcə — daxil etməyin. Xarici işəgötürənin belə sual verməsi
          özlüyündə həmin məlumatın toplanmasını əsaslandırmır.
        </p>
      </section>

      <section>
        <h2>İşləmə necə icazələndirilir</h2>
        <p>
          Müvafiq emal başlamazdan əvvəl lazımi məlumatı təqdim edir və həmin
          məqsəd üçün tələb olunan icazəni alırıq. Xarici müraciətlər, ölkə
          xaricinə ötürmələr və könüllü analitika üçün seçimlər ayrıdır.
          Məlumatın qanunla işlənməsi tələb olunduğu hallarda bunu izah edirik
          və könüllü razılığı məcburi kimi təqdim etmirik.
        </p>
        <p>
          Zəruri icazədən imtina müvafiq xüsusiyyətin işləməsinə mane ola
          bilər. Könüllü analitikadan imtina əsas xidmətə təsir etmir.{" "}
          <strong>
            Məxfilik bildirişini oxumaq bütün emal fəaliyyətlərinə razılıq
            demək deyil.
          </strong>
        </p>
      </section>

      <section>
        <h2>CV köməkliyi və uyğunlaşdırma</h2>
        <p>
          LinkedIn keçidi ilə idxalda birbaşa oxuma alınmasa, ayrıca seçiminizlə Jina AI Reader alternativindən istifadə edə bilərsiniz.
          Bu zaman daxil etdiyiniz profil ünvanı həmin xidmətə ötürülür və profilin ictimai məlumatları Azərbaycan xaricində emal oluna bilər.
          AISE-də saxladığınız CV, hesab məlumatları və parollar bu xidmətə göndərilmir. Bu seçim hər oxuma cəhdi üçün ayrıdır;
          razılıq vermədən PDF və ya profil mətnini idxal edə bilərsiniz. Oxunan məlumatlar profilinizə əlavə edilməzdən əvvəl sizə yoxlama üçün göstərilir.
        </p>
        <p>
          Sistemlərimiz karyera məlumatlarınızı vakansiyalarla müqayisə edir və
          uyğunluq qiymətləndirmələri hazırlayır. Ballar sizə göstərilən
          uyğunluqlara təsir edir; onlar işə qəbul qərarı deyil.
        </p>
        <p>
          CV hazırlanması xarici süni intellekt təminatçısından istifadə edir —
          bax <Link href="/service-providers">Xidmət təminatçıları</Link>.
          Təklif edilən mətni yoxlayın, çünki səhv ola bilər. Profilinizi
          düzəldə və nəticənin yanlış olduğunu düşünürsünüzsə bizə yaza
          bilərsiniz. Mövcud yoxlama imkanlarını izah edirik; hər işəgötürənin
          qərarının insan tərəfindən yenidən qiymətləndiriləcəyini vəd etmirik.
        </p>
      </section>

      <section>
        <h2>Brauzer köməkçisi (genişlənmə)</h2>
        <p>
          Premium planına daxil olan brauzer köməkçisi AISE Agent genişlənməsi vasitəsilə yalnız sizin kompüterinizdəki brauzerdə işləyir və yalnız
          bir dəfəlik kodla cütlədiyiniz hesaba bağlıdır. Genişlənmə bunları edir:
        </p>
        <ul>
          <li>
            <strong>Saxladığı məlumat:</strong> cütləmədən sonra aldığı cihaz nişanı brauzerin genişlənmə yaddaşında saxlanılır və yalnız aisehr.com
            ünvanına göndərilir. Parolunuzu, cookie-lərinizi, brauzer tarixçənizi və ya başqa saytlardakı məlumatları oxumur.
          </li>
          <li>
            <strong>Portalda nə oxuyur:</strong> yalnız sizin təsdiqlədiyiniz müraciətin açdığı portal səhifəsində müraciət formasının quruluşunu
            (sahə adları, seçimlər), təsdiq səhifəsinin ünvanını və nəticəni oxuyub AISE-yə göndərir ki, doldurma planı hazırlansın və nəticə qeyd olunsun.
          </li>
          <li>
            <strong>Nə doldurur:</strong> AISE-nin hər müraciət üçün sizə göstərdiyi və sizin təsdiqlədiyiniz dəyərləri (ad, əlaqə məlumatı, cavablar,
            CV faylı) portal formasına yazır. Göndəriş yalnız sizin təsdiqinizdən və birdəfəlik icazədən sonra baş verir.
          </li>
          <li>
            <strong>Nə satılmır və paylaşılmır:</strong> bu məlumatlar reklam üçün istifadə edilmir, satılmır və yalnız müraciət etdiyiniz işəgötürənin
            portalına, sizin təsdiqinizlə ötürülür.
          </li>
          <li>
            <strong>Saxlama və ayırma:</strong> müraciətin tarixçəsi (nə vaxt, nə göstərildi, nəticə) sizin müraciət tarixçənizin hissəsi kimi saxlanılır.
            Brauzeri AISE-də “Brauzer köməkçisi” səhifəsindən istənilən vaxt ayıra və ya genişlənməni brauzerdən silə bilərsiniz; ayrılan brauzerin nişanı dərhal
            etibarsız olur.
          </li>
        </ul>
      </section>

      <section id="institution-enquiries">
        <h2>Təşkilatların pilot sorğuları</h2>
        <p>
          <Link href="/institutions">Akademiyalar və universitetlər üçün</Link> səhifəsindəki formada
          təşkilatın adını, əlaqə şəxsinin adını, vəzifəsini, e-poçtunu, telefonunu (istəyə bağlı), təxmini
          tələbə sayını, istədiyiniz başlama vaxtını və yazdığınız mesajı toplayırıq. Bu formada tələbələrin
          şəxsi məlumatları istənilmir; onları göndərməyin.
        </p>
        <p>
          Məqsəd yalnız sorğunuza cavab vermək və pilotu sizinlə müzakirə etməkdir. Sorğu bazamızda saxlanılır
          və komandamıza e-poçt bildirişi kimi göndərilir (hostinq və e-poçt təminatçıları vasitəsilə). Bu
          məlumatı marketinq siyahısına əlavə etmirik və başqalarına vermirik.
        </p>
        <p>
          Hazırda pilot sorğuları üçün avtomatik silmə müddəti təyin edilməyib. Silinməsini istəsəniz,{" "}
          {LEGAL.email.privacy} ünvanına yazın; sorğunu və bildiriş e-poçtunu silirik.
        </p>
      </section>

      <section>
        <h2>Kimlər məlumat alır</h2>
        <p>
          Hostinq, süni intellekt, e-poçt, ödəniş və analitika
          təminatçılarından istifadə edirik — onların siyahısı, məqsədi və rolu{" "}
          <Link href="/service-providers">Xidmət təminatçıları</Link>{" "}
          səhifəsindədir. Səlahiyyətli əməkdaşlar məlumatlara yalnız iş
          vəzifələri çərçivəsində baxır.
        </p>
        <p>
          <strong>
            CV-nizi ictimai axtarışa açmırıq və kənar işəgötürənlərə profil
            bazasına giriş vermirik.
          </strong>{" "}
          Müraciət göstərişi verdiyiniz zaman yalnız həmin işəgötürən və onun
          işə qəbul xidməti müvafiq axında göstərilən məlumatları alır.
        </p>
        <p>
          Xarici formanın hazırlanması məlumatları yekun göndərmədən əvvəl də
          açıqlaya bilər. İşəgötürəndə qalan kopyalar siz AISE hesabınızı
          bağladıqdan sonra da saxlanıla bilər; belə halda müraciətinizi
          müvafiq alıcıya yönəltməyə kömək edirik.
        </p>
      </section>

      <section>
        <h2>Beynəlxalq ötürmələr</h2>
        <p>
          Bəzi təminatçılar {LEGAL.servedCountry} hüdudlarından kənarda
          fəaliyyət göstərir. Razılıq tələb edən ötürmədən əvvəl təyinat
          ölkəsini, məqsədi, məlumat kateqoriyalarını və alıcını göstərir,
          müdafiə fərqlərini izah edir və müvafiq icazəni soruşuruq.
        </p>
        <p>
          Təminatçının yerləşdiyi ölkə və ya onun məxfilik siyasəti özlüyündə
          bərabər müdafiə zəmanəti deyil. Cari təyinatlar{" "}
          <Link href="/service-providers">Xidmət təminatçıları</Link>{" "}
          səhifəsində sadalanır.
        </p>
      </section>

      <section>
        <h2>Saxlama və təhlükəsizlik</h2>
        <p>
          Məlumatları yalnız sənədləşdirilmiş məqsəd və qanuni tələblər üçün
          saxlayırıq. Cari daxili saxlama qaydalarımız:
        </p>
        <table>
          <thead>
            <tr>
              <th>Qeyd</th>
              <th>Saxlama qaydası</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Aktiv profil, CV-lər və müraciət tarixçəsi</td>
              <td>
                Xidmət üçün lazım olduğu müddətdə. 12 aylıq fəaliyyətsizlikdən
                sonra qiymətləndirilir və bağlanmadan əvvəl bildiriş verilir
              </td>
            </tr>
            <tr>
              <td>Birdəfəlik kodlar (OTP)</td>
              <td>
                Yalnız sessiya müddətində. Analitikada və ya müraciət
                tarixçəsində heç vaxt saxlanılmır
              </td>
            </tr>
            <tr>
              <td>Xarici müraciət ekran görüntüləri</td>
              <td>
                Yekun statusdan sonra 24 saat ərzində silinir — sənədləşdirilmiş
                insident tələb etmədikdə
              </td>
            </tr>
            <tr>
              <td>Yarımçıq xarici müraciət qaralamaları</td>
              <td>
                Müddəti bitdikdən sonra 7 gün ərzində silinir; işçi sessiyaları
                dərhal ləğv edilir
              </td>
            </tr>
            <tr>
              <td>Könüllü analitika</td>
              <td>
                Şəxsi identifikasiya ilə maksimum 90 gün; imtina halında daha
                tez anonimləşdirilir və ya silinir
              </td>
            </tr>
            <tr>
              <td>Təhlükəsizlik qeydləri</td>
              <td>
                90 gün. Daha uzun müddət yalnız sənədləşdirilmiş araşdırma
                üçün, məhdud girişlə
              </td>
            </tr>
            <tr>
              <td>Ehtiyat kopyalar (backup)</td>
              <td>
                Maksimum 30 günlük dövr. Adi istifadə üçün əlçatan deyil; bərpa
                halında silinmə göstəriciləri yenidən tətbiq edilir
              </td>
            </tr>
            <tr>
              <td>Vergi və uçot qeydləri</td>
              <td>Qanunvericiliyin tələb etdiyi müddət</td>
            </tr>
          </tbody>
        </table>
        <p>
          Hesabın bağlanması adi istifadəni dayandırır və müvafiq silinmə
          prosesini — gözləyən müraciət işləri də daxil olmaqla — başladır.
          AISE hesabının bağlanması işəgötürənin müstəqil qeydlərinin
          silinməsini təmin etmir.
        </p>
        <p>
          Müvafiq giriş və təhlükəsizlik tədbirlərini həyata keçirir və
          şübhəli insidentləri araşdırırıq.{" "}
          <strong>Heç bir sistem tam risksiz deyil</strong> — bunu “100%
          təhlükəsiz” kimi təqdim etmirik. İcazəsiz açıqlamadan şübhə
          edirsinizsə{" "}
          <a href={`mailto:${LEGAL.email.privacy}`}>{LEGAL.email.privacy}</a>{" "}
          ünvanına yazın.
        </p>
      </section>

      <section>
        <h2>Seçimləriniz və müraciətləriniz</h2>
        <p>
          Saxlanılan məlumatlar, onların mənbəyi və istifadəsi barədə
          soruşa, düzəliş və ya silinmə tələb edə, emala etiraz edə və
          verdiyiniz icazələri geri götürə bilərsiniz. Bunun üçün{" "}
          <Link href="/privacy/requests">Məlumat müraciətləri</Link>{" "}
          səhifəsindən və ya{" "}
          <a href={`mailto:${LEGAL.email.privacy}`}>{LEGAL.email.privacy}</a>{" "}
          ünvanından istifadə edin.
        </p>
        <p>
          Müraciətlər üçün haqq tutulmur. Şəxsiyyətinizi mütənasib üsulla
          təsdiqləməyimiz lazım gələ bilər. Şəxsi məlumatlar haqqında qanunun
          12-ci maddəsinə əsasən müraciətlərə <strong>7 iş günü</strong>{" "}
          ərzində cavab veririk; üçüncü tərəflə məsləhətləşmə lazım olduqda bu
          müddət <strong>7 iş günü</strong> daha uzadıla bilər. Əsaslandırılmış
          rədd cavabı <strong>5 gün</strong>, əvvəlki alıcıların
          məlumatlandırılması <strong>3 gün</strong> ərzində həyata keçirilir.
        </p>
        <p>
          İcazənin geri götürülməsi müvafiq xidməti dayandıra bilər, lakin artıq
          tamamlanmış açıqlamaları geri qaytarmır.
        </p>
        <p>
          Bizim dəstək prosedurumuzu gözləmədən səlahiyyətli dövlət orqanına
          və ya məhkəməyə müraciət edə bilərsiniz. Şəxsi məlumatların
          mühafizəsi üzrə dövlət reyestri{" "}
          <a href="https://registry.pdp.az/" target="_blank" rel="noreferrer">
            registry.pdp.az
          </a>{" "}
          ünvanındadır.
        </p>
      </section>

      <section>
        <h2>Yaş həddi, kukilər və yeniləmələr</h2>
        <p>
          AISE xidməti {LEGAL.minimumAge} yaşı tamam olmuş şəxslər üçündür.
          Yaş həddinə uyğun olmayan hesab müəyyən edilərsə, qiymətləndirmək və
          müvafiq addım atmaq üçün bizə məlumat verin.
        </p>
        <p>
          Kuki və könüllü analitika seçimləri{" "}
          <Link href="/cookies">Kuki və analitika</Link> səhifəsindədir.
          Bildirişdə əhəmiyyətli dəyişikliklər barədə xəbər veririk; yeni
          icazələr lazım olduqda ayrıca soruşulur.
        </p>
      </section>
      <section><h2>Plan təklifləri haqqında məktublar</h2><p>Ayrıca razılıq verdiyiniz halda ödənişsiz hesabınıza həftədə ən çox bir əlavə plan təklifi məktubu göndərilə bilər. Bu seçim ilkin olaraq bağlıdır. Bildiriş parametrlərindən söndürə və ya məktubdakı keçidlə abunəlikdən çıxa bilərsiniz.</p></section>
    </LegalPage>
  );
}

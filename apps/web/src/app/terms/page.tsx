import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, OperatorIdentity } from "@/components/legal/legal-page";
import { LEGAL } from "@/lib/legal-config";

export const metadata: Metadata = {
  title: "İstifadə şərtləri — AISE",
  description:
    "AISE platformasından istifadə qaydaları, tərəflərin öhdəlikləri, abunəlik və məsuliyyət şərtləri.",
};

export default function TermsPage() {
  return (
    <LegalPage
      version="1.1" effectiveDate="2026-10-18"
      title="İstifadə şərtləri"
      intro="Bu şərtlər sizinlə AISE arasındaki müqaviləni təşkil edir. Qeydiyyatdan keçməklə və ya abunəlik almaqla onları qəbul edirsiniz."
    >
      <section>
        <h2>1. Razılaşma</h2>
        <OperatorIdentity />
        <p>
          “Siz” hesabdan istifadə edən şəxs deməkdir. İşəgötürən kimi istifadə
          əlavə olaraq <Link href="/employer-terms">İşəgötürən şərtləri</Link>{" "}
          ilə tənzimlənir. Bu şərtləri qeydiyyat və ya ödəniş zamanı göstərilən
          hərəkətlə qəbul edirsiniz. Sadəcə açıq səhifəyə baxmaq bizə sizin
          adınızdan vakansiyalara müraciət etmək səlahiyyəti vermir.
        </p>
        <p>
          <Link href="/refund">Abunəlik və geri ödəniş qaydaları</Link> və{" "}
          <Link href="/acceptable-use">İstifadə qaydaları</Link> bu
          razılaşmanın ayrılmaz hissəsidir.{" "}
          <Link href="/application-authorization">Müraciət səlahiyyəti</Link>{" "}
          hər bir müraciət göstərişini tənzimləyir.{" "}
          <Link href="/privacy">Məxfilik bildirişi</Link> məlumatların
          işlənməsini izah edir; könüllü icazələr ayrıca soruşulur.
        </p>
      </section>

      <section>
        <h2>2. Uyğunluq və hesab</h2>
        <p>
          Ən azı {LEGAL.minimumAge} yaşınız olmalı, müqavilə bağlamaq
          qabiliyyətinə malik olmalı və doğru hesab məlumatları
          göstərməlisiniz. Yalnız öz şəxsi namizəd kimliyinizdən istifadə edə
          bilərsiniz. Giriş məlumatlarınızı qoruyun və sui-istifadədən şübhə
          etdiyiniz halda{" "}
          <a href={`mailto:${LEGAL.email.support}`}>{LEGAL.email.support}</a>{" "}
          ünvanına yazın.
        </p>
        <p>
          İcazə verdiyiniz hərəkətlərə və hesabınızla bağlı ağlabatan
          ehtiyatlılığa görə məsuliyyət daşıyırsınız. Bununla belə, bizim
          qüsurumuz nəticəsində baş verən icazəsiz hərəkətlərə görə avtomatik
          məsuliyyət daşımırsınız.
        </p>
        <p>
          İlk mərhələdə xidmət {LEGAL.servedCountry}da istifadə üçün
          nəzərdə tutulub.
        </p>
      </section>

      <section>
        <h2>3. AISE nə təqdim edir</h2>
        <p>
          Seçdiyiniz plandan asılı olaraq AISE vakansiyaları tapmağa,
          profilinizin uyğunluğunu qiymətləndirməyə, CV hazırlamağa və ya
          fərdiləşdirməyə və müraciətlərə köməklik göstərir. İşəgötürənlər
          vakansiya yerləşdirə və namizədləri idarə edə bilər. Xüsusiyyətlər,
          limitlər, dəstəklənən saytlar və qiymət ödənişdən əvvəl göstərilir.
        </p>
        <p>
          <strong>
            Uyğunluq balı yalnız uyğunluq ehtimalının qiymətləndirilməsidir.
          </strong>{" "}
          O, işə qəbul ehtimalı və ya ixtisasınızın təsdiqi deyil. Süni
          intellektlə hazırlanmış mətndə səhvlər ola bilər. Heç bir müsahibə,
          iş, cavab, əmək haqqı, viza və ya işləmə icazəsi vəd edilmir.
          Qərarları işəgötürənlər özləri verir. Bununla belə, razılaşma və
          qanunvericiliyə əsasən xidməti göstərmək öhdəliyimiz qüvvədə qalır.
        </p>
      </section>

      <section>
        <h2>4. Məlumatlarınız və hazırlanan materiallar</h2>
        <p>
          Doğru məlumat verin və hazırlanan materialları istifadə etməzdən
          əvvəl yoxlayın. Başqa şəxslər — məsələn zəmanət verən şəxslər —
          barədə məlumatı yalnız buna hüququnuz olduqda göndərin.
        </p>
        <p>
          Orijinal məzmununuza dair hüquqlar sizdə qalır. Bizə yalnız
          razılaşdırılmış xidmət, sizin göstərişləriniz və qanuni saxlama
          öhdəlikləri üçün lazım olduğu qədər onu saxlamağa, işləməyə,
          formatlamağa və ötürməyə icazə verirsiniz. Bu, şəxsi məlumatlarınızın
          mülkiyyətini bizə keçirmir və onun kənar məqsədlə satılmasına icazə
          vermir.
        </p>
        <p>
          Hazırladığımız CV-lərdən karyera fəaliyyətiniz üçün istifadə edə
          bilərsiniz. Süni intellekt nəticəsinin unikal və ya müstəqil müəllif
          hüququ ilə qorunan olduğunu vəd etmirik. Bilərəkdən yanlış ixtisas və
          ya yanlış cavabları təsdiqləməməlisiniz. Sizin təsdiqiniz AISE-nin
          icazəsiz dəyişikliyini və ya digər qüsurunu bəraətləndirmir.
        </p>
      </section>

      <section>
        <h2>5. Müraciətlər və məhdud səlahiyyət</h2>
        <p>
          Müraciətlərə köməklik{" "}
          <Link href="/application-authorization">Müraciət səlahiyyəti</Link>{" "}
          ilə tənzimlənir. Başlanğıc mərhələdə hər yekun müraciət sizin
          konkret təsdiqinizi tələb edir. Xarici formanın doldurulması
          məlumatları yekun göndərmədən əvvəl də həmin xidmətə açıqlaya bilər;
          buna görə hazırlıq başlamazdan əvvəl müvafiq göstərişi soruşuruq.
        </p>
        <p>
          Bizim əmək münasibətlərini müzakirə etmək, iş təklifini qəbul etmək,
          əmək müqaviləsi imzalamaq və ya sizin adınızdan kənar öhdəliklər
          qəbul etmək üçün ümumi səlahiyyətimiz yoxdur. Göstəriş icra
          edilməzdən əvvəl mövcud idarəetmə vasitələri ilə və ya dəstək
          vasitəsilə dayandırıla bilər. Tamamlanmış açıqlama və göndərmələr
          geri qaytarıla bilməz. Göndərmə göstəricisi işəgötürənin cavabı və ya
          iş təklifi deyil.
        </p>
      </section>

      <section>
        <h2>6. Xarici saytlar və elanlar</h2>
        <p>
          Xarici saytların və işəgötürənlərin öz şərtləri və məxfilik
          məlumatları var. Sayta keçid verməyimiz və ya onu dəstəkləməyimiz
          affiliasiya iddiası demək deyil. Elanlar dəyişə və ya müddəti bitə
          bilər. İcazə, təhlükəsizlik və ya texniki etibarlılıq tələb etdikdə
          inteqrasiyanı dayandıra bilərik.
        </p>
        <p>
          Ödənişli xüsusiyyətin əhəmiyyətli itkisi{" "}
          <Link href="/refund">Abunəlik və geri ödəniş qaydaları</Link>{" "}
          çərçivəsində həll olunur.
        </p>
      </section>

      <section>
        <h2>7. Ödənişlər və dəyişikliklər</h2>
        <p>
          Ödənişli planlar yalnız ödəniş zamanı açıqlanmış və qəbul edilmiş
          təkrarlanan şərtlərlə yenilənir. Yenilənməni istənilən vaxt
          dayandıra bilərsiniz. Limitlər təklifdə göstərilən vahidi ölçür —
          uyğunluq mütləq göndərilmiş müraciət demək deyil.
          Ödənişsiz plan həftədə 3 yeni tövsiyəyə qədərdir; həftə bazar ertəsi Bakı vaxtı ilə 00:00-da yenilənir. Yeni satışlarda Plus 8 AZN/ay və gündə 1 yeni iş tövsiyəsinə qədər,
          Premium 50 AZN/ay və gündə 5 yeni iş tövsiyəsinə qədər təklif olunur.
          Gündəlik limit Bakı vaxtı ilə 00:00-da yenilənir, yığılmır və yalnız
          yeni uyğun vakansiyalar olduqda istifadə olunur. Digər limitlər və
          abunəliyin idarə edilməsi Abunəlik və geri ödəniş səhifəsində göstərilir.
        </p>
        <p>
          Qiymət dəyişikliklərini keçmişə şamil etmirik. Təkrarlanan qiymətin
          artırılması halında ilk təsirlənən ödənişdən ən azı{" "}
          {LEGAL.changeNoticeDays} təqvim günü əvvəl bildiriş verir və ləğv
          etmək imkanı təqdim edirik.
        </p>
      </section>

      <section>
        <h2>8. İcazəli istifadə və əqli mülkiyyət</h2>
        <p>
          AISE-dən qanuna uyğun istifadə edin və{" "}
          <Link href="/acceptable-use">İstifadə qaydalarına</Link> riayət edin.
          Proqram təminatı, brend və platformanın orijinal məzmununa dair
          hüquqlar AISE və onun lisenziarlarına aiddir. Razılaşma qüvvədə
          olduğu müddətdə xidmətdən təyinatı üzrə istifadə etmək üçün məhdud
          hüquq veririk. Bu, qanunvericiliyin sizə verdiyi hüquqları
          məhdudlaşdırmır.
        </p>
      </section>

      <section>
        <h2>9. Dayandırma və hesabın bağlanması</h2>
        <p>
          İstifadəni dayandıra, yenilənməni ləğv edə və ya hesabın bağlanmasını
          tələb edə bilərsiniz. Biz dələduzluq, təhlükəsizlik təhdidi, qanunsuz
          istifadə və ya şərtlərin əhəmiyyətli pozulması halında girişi
          mütənasib şəkildə məhdudlaşdıra bilərik. Mümkün olduqda problemi izah
          edir və düzəliş və ya etiraz imkanı veririk.
        </p>
        <p>
          Sizin əhəmiyyətli pozuntunuz olmadan ödənişli xidməti dayandırsaq,
          tələb olunan geri ödənişi və göstərilməyən hissə üçün müvafiq
          kompensasiyanı təmin edirik. Hesabın bağlanması sonrakı müraciətlərə
          icazə vermir.
        </p>
      </section>

      <section>
        <h2>10. Məsuliyyət və məhdudiyyətlər</h2>
        <p>
          Ağlabatan diqqət və peşəkarlıqla çalışırıq. Fasiləsiz girişi vəd edə
          bilmirik və işəgötürənlərin müstəqil qərarlarına təsir etmirik.
          Pozuntumuz və ya qüsurumuz qanuni olaraq bərpa oluna bilən zərərə
          səbəb olduğu həddə məsuliyyət daşıyırıq. Siz də öz qanunsuz və ya
          yanlış davranışınızın səbəb olduğu zərərə görə məsuliyyət daşıyırsınız.
        </p>
        <p>
          İcra oluna bildiyi həddə, adi xidmət iddiaları üzrə məcmu müqavilə
          məsuliyyətimiz son 12 ayda bizə ödədiyiniz məbləğ və ya{" "}
          {LEGAL.currency} 200 — hansı böyükdürsə — ilə məhdudlaşır.
        </p>
        <p>
          <strong>Bu məhdudiyyət aşağıdakılara şamil edilmir:</strong>{" "}
          dələduzluq, qəsdən edilən hərəkət, kobud ehtiyatsızlıq, ölüm və ya
          bədən xəsarəti, şəxsi məlumatların qanunsuz işlənməsi və ya
          açıqlanması, məcburi geri ödənişlər, həmçinin qanunvericiliyin
          məhdudlaşdırmağa icazə vermədiyi hər hansı öhdəlik. Heç bir müddəa
          istehlakçını AISE-nin öz səhvi üçün kompensasiya ödəməyə məcbur
          etmir.
        </p>
        <p>
          Gözlənilən işin və ya əmək haqqının əldə edilməməsi özlüyündə AISE-nin
          pozuntusunun sübutu deyil. Eyni zamanda iş zəmanətinin olmaması
          bizim sübut olunmuş yanlış davranışımızdan irəli gələn iddianı
          istisna etmir.
        </p>
      </section>

      <section>
        <h2>11. Nəzarətdən kənar hallar</h2>
        <p>
          Ağlabatan nəzarətdən həqiqətən kənar olan hadisə xidmətin
          göstərilməsinə təsir edə bilər. Təsirini azaltmaq üçün ağlabatan
          addımlar atır və əhəmiyyətli fasilələri izah edirik. Bu, qarşısı
          alına bilən təhlükəsizlik qüsurlarını, artıq ödənilməli olan
          məbləğləri və ya məcburi geri ödənişləri bəraətləndirmir.
        </p>
      </section>

      <section>
        <h2>12. Dəyişikliklər, şikayətlər və tətbiq olunan hüquq</h2>
        <p>
          Müqavilədə əhəmiyyətli dəyişikliklər barədə qüvvəyə minməsindən ən
          azı {LEGAL.changeNoticeDays} təqvim günü əvvəl bildiriş veririk —
          qanun və ya təcili təhlükəsizlik səbəbi qısa müddət tələb etmədikdə.
          Razılıq tələb edən yeni məqsədlər şərtlərin yenilənməsi ilə
          icazələndirilmir.
        </p>
        <p>
          Şikayətlərinizi{" "}
          <a href={`mailto:${LEGAL.email.support}`}>{LEGAL.email.support}</a>{" "}
          ünvanına göndərin. Şikayəti iki iş günü ərzində qeydə almağa və on iş
          günü ərzində əsaslı cavab verməyə çalışırıq — qanunla daha qısa müddət
          müəyyən edilmədikdə. Qanuni hüquqlarınızdan istifadə etmək üçün bizim
          şikayət prosedurumuzu bitirməyiniz tələb olunmur.
        </p>
        <p>
          Sizə tətbiq olunan məcburi müdafiə və yurisdiksiya qaydaları nəzərə
          alınmaqla {LEGAL.governingLaw} tətbiq edilir. Mübahisələr həmin
          qaydalara uyğun səlahiyyətli məhkəmədə baxıla bilər. İstehlakçıdan
          xarici arbitrajdan istifadə etməyi və ya tənzimləyici orqana
          müraciət hüququndan imtina etməyi tələb etmirik.
        </p>
      </section>
    </LegalPage>
  );
}

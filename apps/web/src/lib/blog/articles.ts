import { SENIOR_ARTICLE } from './senior-article';
import { NICHE_ARTICLES } from './niche-articles';

export interface BlogArticle {
  slug: string;
  aliases?: string[];
  title: string;
  description: string;
  publishedAt: string;
  updatedAt: string;
  readTimeMinutes: number;
  author: {
    name: string;
    url: string;
  };
  tags: string[];
  body: string;
  quickAnswer?: string;
  tool?: 'evidence' | 'email' | 'impact';
}

export const BLOG_ARTICLES: BlogArticle[] = [
  {
    slug: 'cv-nece-yazilir',
    aliases: ['cv-nece-yazilir-vakansiyaya-uygun-rezume'],
    title: 'CV necə yazılır? Vakansiyaya uyğun rezüme hazırlamaq',
    description: 'CV başlığını, bacarıqları və təcrübə bəndlərini vakansiyaya necə uyğunlaşdırmalı? Praktik nümunələr və göndərişdən əvvəl yoxlama siyahısı.',
    publishedAt: '2026-10-20',
    updatedAt: '2026-10-20',
    readTimeMinutes: 5,
    author: {
      name: 'AISE',
      url: 'https://aisehr.com',
    },
    tags: ['CV', 'Rezüme', 'Vakansiya', 'Təcrübə'],
    body: `Yaxşı CV-ni oxuyan şəxs üç suala rahat cavab tapmalıdır: hansı işə müraciət edirsiniz, bu iş üçün nə bacarırsınız və bunu hansı nümunələr göstərir? Profilinizdəki bütün məlumatları bir sənədə toplamaq bu sualları həmişə cavablandırmır. Müraciət etdiyiniz vəzifəyə uyğun məlumatı seçmək və aydın təqdim etmək lazımdır.

Bu yazıda “CV” və “rezüme” sözlərini iş müraciəti üçün hazırlanan sənəd mənasında işlədirik. Akademik CV-də nəşrlər, tədqiqat və digər geniş məlumatlar ayrıca tələb oluna bilər. Sənədi göndərərkən ilk növbədə elanın göstərişlərini əsas götürün.

## 1. Yazmağa başlamazdan əvvəl elanı bölün

Elanı oxuyarkən üç siyahı hazırlayın: əsas məsuliyyətlər, tələb olunan bacarıqlar və üstünlük sayılan biliklər. Maaş və sığorta kimi iş şərtlərini namizədin bacarıqları ilə qarışdırmayın.

Hər mühüm tələbin qarşısına öz nümunənizi yazın. Bu, iş təcrübəsi, universitet layihəsi, könüllülük və ya müstəqil hazırladığınız iş ola bilər. Elanın tələb etdiyi bacarıq sizdə yoxdursa, onu sənədə əlavə etməyin. Bacarıq sizdə var, amma profilinizdə yazılmayıbsa, istifadə etdiyiniz konteksti və səviyyəni dürüst göstərin.

> **Nümunə (şərti):** Elan SQL, Power BI və hesabatların hazırlanmasını tələb edir. Namizəd universitet layihəsində SQL sorğuları yazıb və Power BI hesabatı hazırlayıb. Bu işi “Tədris layihəsi” kimi təqdim etmək olar; “şirkətin BI sistemini idarə etmişəm” yazmaq olmaz.

## 2. Başlıq və xülasə nə deməlidir?

Ümumi motivasiya cümləsi əvəzinə müraciətin istiqamətini göstərin. Vəzifəni hələ tutmamısınızsa, bunu hədəf kimi ifadə edin:

> **Hədəf vəzifə:** Junior BI Developer | SQL və Power BI

Bu başlıq yalnız göstərilən alətlərdən həqiqətən istifadə etdiyiniz halda uyğundur. “Junior” və ya “Senior” sözünü öz keçmiş vəzifənizə sonradan əlavə etməyin.

Xülasə iki-üç cümlədə uyğun hazırlığınızı və iş nümunənizi təqdim edə bilər. “Məsuliyyətli, dinamik, ideal namizədəm” kimi sözləri sübut olunmuş məlumatla əvəz edin. [UC San Diego-nun CV bələdçisi](https://gradcareers.ucsd.edu/resources/guides/resume.html) də qısa xülasəni müraciət edilən vəzifəyə uyğun yeniləməyi tövsiyə edir.

## 3. Təcrübə bəndində nəyi vurğulamalı?

Oxucu sizin konkret töhfənizi anlamalıdır. Özünüzə bu sualları verin: nə etdim, hansı üsuldan istifadə etdim və hansı nəticə və ya iş məhsulu yarandı?

- **Ümumi ifadə:** “Hesabatlarla işlədim.”
- **Daha aydın nümunə (şərti):** “Aylıq satış məlumatlarını SQL ilə birləşdirərək mağazalar üzrə müqayisə aparmağa imkan verən Power BI hesabatı hazırladım.”

Rəqəm varsa, mənbəyini yoxlayın. Məlumat dəstindəki gəlir sizin yaratdığınız gəlir deyil. Təklif etdiyiniz qənaət həyata keçirilmiş qənaət deyil. Qrup layihəsində komandanın nəticəsi ilə şəxsi töhfənizi ayırın. Rəqəm yoxdursa, onu uydurmaq əvəzinə işin məqsədini, əhatəsini və hazırladığınız nəticəni təsvir edin.

## 4. Bacarıqlar siyahısını necə seçməli?

Vakansiyaya uyğun sənəddə əsas diqqəti tələb olunan və sizdə olan bacarıqlara verin. Bacarıqları oxunaqlı qruplara bölmək olar: alətlər və sistemlər, sahəvi biliklər, proqramlaşdırma dilləri və xarici dillər. Boş və mənasız qruplar yaratmağa ehtiyac yoxdur.

Sözləri elanın dilinə uyğunlaşdırarkən mənanı dəyişməyin. SQL bilmək avtomatik olaraq yüksək səviyyəli verilənlər bazası inzibatçılığı demək deyil. Dil səviyyəsini də elanda tələb olunduğuna görə yüksəltməyin.

## 5. Layihə, sertifikat və mükafatları hara qoymalı?

Təcrübəsi az olan namizəd üçün uyğun layihə vacib iş nümunəsi ola bilər. Layihənin adını, məqsədini, istifadə etdiyiniz üsulu və şəxsi töhfənizi yazın. Sertifikatlarda adı, verən qurumu və tarixi; mükafatlarda isə nə üçün verildiyini dəqiq göstərin.

Ən güclü uyğun məlumatı görünən yerdə saxlayın. Lakin tarixləri dəyişməyin və bütün bölmələrə eyni məlumatı təkrar yerləşdirməyin. [MIT Communication Lab](https://mitcommlab.mit.edu/cee/commkit/cv-resume/) məzmunun və bölmələrin hədəf işə görə seçilməsini vurğulayır.

## Göndərişdən əvvəl yoxlama

- Başlıq bu vakansiyaya aiddirmi və təcrübəmi düzgün göstərirmi?
- İlk səhifədə ən uyğun nümunələr görünürmü?
- Hər bacarıq və nəticə haqqında müsahibədə danışa bilərəmmi?
- İş, təcrübə proqramı və tədris layihəsi düzgün fərqləndirilibmi?
- Adlar, tarixlər, rəqəmlər və əlaqə məlumatları doğrudurmu?
- PDF-də mətn oxunur, seçilir və düzgün ardıcıllıqla köçürülürmü?

CV-ni hazırladıqdan sonra [ATS üçün formatı yoxlayın](/blog/ats-uygun-cv) və məktub tələb olunursa, [motivasiya məktubunu ayrıca qurun](/blog/motivasiya-mektubu-nece-yazilir). Mövcud elanlara [vakansiyalar səhifəsindən](/jobs) baxa bilərsiniz. Yaxşı sənəd uyğunluğunuzu izah edir; işə qəbul qərarına zəmanət vermir.`,
  },
  {
    slug: 'ats-uygun-cv',
    aliases: ['ats-e-uygun-cv', 'ats-cv'],
    title: 'ATS-uyğun CV: format, açar sözlər və yayılmış səhvlər',
    description: 'ATS nədir və CV-ni necə oxuyur? Sadə format, düzgün açar sözlər, PDF yoxlaması və avtomatik rədd edilmə haqqında yanlış təsəvvürlər.',
    publishedAt: '2026-10-20',
    updatedAt: '2026-10-20',
    readTimeMinutes: 5,
    author: {
      name: 'AISE',
      url: 'https://aisehr.com',
    },
    tags: ['ATS', 'Format', 'Açar sözlər', 'PDF'],
    body: `ATS işə müraciətləri toplamaq və idarə etmək üçün istifadə olunan sistemdir. Məsələn, CV yükləyəndə sistem sənəddən adınızı, iş yerlərinizi və tarixləri çıxararaq müraciət formasına yerləşdirə bilər. İşəgötürənin istifadə etdiyi alət və qurduğu proses fərqləndiyi üçün bütün ATS-ləri eyni cür işləyən “imtahan” kimi düşünmək düzgün deyil.

Namizəd üçün əsas məqsəd sənədin həm insan, həm də proqram tərəfindən rahat oxunmasıdır. “ATS-dən mütləq keçən CV” və ya “100 faiz uyğunluq balı” kimi vədlərə ehtiyatla yanaşın.

## Mətnin çıxarılması ilə namizədin qiymətləndirilməsi ayrıdır

Sistemin sizin universitet adınızı tanımaması, avtomatik olaraq uyğun olmadığınız qərarının verilməsi demək deyil. Oxunmayan sahələri əl ilə doldurmaq lazım gələ bilər. Digər tərəfdən, bütün məlumatların düzgün çıxarılması da müsahibəyə dəvət olunacağınız anlamına gəlmir. Tələblər və müraciətin məzmunu yenə əhəmiyyətlidir.

[Greenhouse-un rəsmi sənədi](https://support.greenhouse.io/hc/en-us/articles/200989175-Unsuccessful-resume-parse) qarışıq cədvəllər, sütunlu quruluş, şəkil şəklində CV və başlıq/altbilgidəki əlaqə məlumatlarını mümkün oxunma problemləri sırasında göstərir. Bu, konkret sistemin sənədləşdirdiyi risklərdir; hər platforma üçün eyni nəticə vəd etmir.

## Sadə quruluş necə kömək edir?

Bir sütunlu, mətn əsaslı sənəd yaxşı başlanğıcdır. Adınızı və əlaqə məlumatınızı əsas mətn sahəsində saxlayın. Bölmələrə aydın adlar verin: “İş təcrübəsi”, “Təhsil”, “Bacarıqlar”, “Layihələr”. Məlumatı yalnız ikonla bildirməyin; məsələn, e-poçt ünvanı oxunaqlı mətn kimi də görünsün.

Vizual dizaynı tamamilə yox etmək lazım deyil. Başlıqlar, kifayət qədər boş sahə və ardıcıl tarix yazılışı sənədi oxunaqlı edir. Bacarıqları ulduz və ya faiz qrafiki ilə göstərməkdənsə, konkret ad və əsaslandıra bildiyiniz səviyyə yazın.

Elan müəyyən fayl növü istəyirsə, ona əməl edin. PDF göndərirsinizsə, onun şəkil deyil, mətn saxladığını yoxlayın. Yalnız faylın uzantısına baxaraq oxunaqlı olduğu qənaətinə gəlməyin.

## Açar sözlərdən dürüst istifadə

Elan “Power BI” tələb edirsə və bu alətdən istifadə etmisinizsə, adını sənəddə aydın yazın. “Analitik proqramlar” kimi qeyri-müəyyən ifadə həmin təcrübəni oxucuya çatdırmaya bilər. Lakin eyni sözü on dəfə təkrarlamaq əvəzinə, onunla nə etdiyinizi göstərin.

> **Nümunə (şərti):** “Power BI ilə anbar qalıqlarını və məhsul hərəkətini izləyən hesabat hazırladım.” Bu cümlə aləti iş nümunəsi ilə bağlayır. Namizəd bu işi görməyibsə, cümlə ona uyğun deyil.

Bacarıq adlarını elandan olduğu kimi köçürmək kifayət etmir. “Advanced Excel” tələbi varsa, öz biliklərinizi yoxlayın: hansı funksiyalarla işləyirsiniz, hansı işi müstəqil görə bilirsiniz? Sahib olmadığınız bacarığı əlavə etmək müsahibədə yeni problem yarada bilər.

## PDF-ni özünüz necə yoxlaya bilərsiniz?

1. Faylı telefonda və kompüterdə açın. Yazılar kiçikdirmi, bəndlər bölünürmü, əlaqə məlumatları görünürmü?
2. Mətni seçərək sadə mətn redaktoruna köçürün. Ad, tarix, vəzifə və şirkət ardıcıllığına baxın.
3. Rəqəmləri və Azərbaycan hərflərini yoxlayın: “ə”, “ı”, “İ”, “ş”, “ğ” düzgün qalırmı?
4. Portal CV-dən forma doldurursa, hər sahəni gözdən keçirin. Səhvi CV-də də düzəldin, lazım gəlsə formadakı məlumatı əl ilə tamamlayın.

Bu yoxlama faydalı ilkin nəzarətdir, bütün ATS-lərin nəticəsini təqlid etmir. Təcrübənizin tarixlərini, əsas bacarıqları və təhsil məlumatlarını ayrıca düzgün doldurmaq vacibdir.

## Üç yayılmış yanlış fikir

- **“Açar sözləri ağ rənglə gizlətsəm, daha yaxşı olar.”** Gizli mətn namizəd haqqında faydalı məlumat vermir və sənədi etibarsız göstərə bilər. Həqiqətən sahib olduğunuz bacarıqları görünən, təbii mətnlə təqdim edin.
- **“Bütün CV-lər bir səhifə olmalıdır.”** Məqsəd lazımi məlumatı aydın çatdırmaqdır. Müvafiq təcrübəni həddən artıq kiçik yazı ilə sıxışdırmaq yaxşı həll deyil.
- **“Bir yoxlama saytında yüksək bal aldım, deməli müsahibə hazırdır.”** Həmin bal müəyyən alətin qaydalarına əsaslanır. Onu işəgötürənin qərarı və ya işə qəbul ehtimalı hesab etməyin.

Format yoxlamasından sonra əsas sual qalır: sənəd bu iş üçün uyğunluğunuzu sübut edirmi? Bunun üçün [vakansiyaya uyğun CV hazırlamaq bələdçisinə](/blog/cv-nece-yazilir) baxın. Sənəddəki nümunələri isə [müsahibəyə hazırlıqda](/blog/musahibeye-hazirliq-star-metodu) istifadə edin.`,
  },
  {
    slug: 'musahibeye-hazirliq-star-metodu',
    aliases: ['musahibeye-hazirliq', 'star-metodu'],
    title: 'İş müsahibəsinə hazırlıq: STAR metodu və praktik plan',
    description: 'Vakansiyanı analiz edin, konkret iş nümunələri hazırlayın və STAR metodu ilə cavab qurun. Yeni məzunlar üçün də praktik hazırlıq planı.',
    publishedAt: '2026-10-20',
    updatedAt: '2026-10-20',
    readTimeMinutes: 5,
    author: {
      name: 'AISE',
      url: 'https://aisehr.com',
    },
    tags: ['Müsahibə', 'STAR metodu', 'Karyera', 'Hazırlıq'],
    body: `Müsahibəyə hazırlaşmaq mümkün sualların cavabını əzbərləməkdən ibarət deyil. Məqsəd hansı təcrübənizin bu vəzifəyə aid olduğunu anlamaq və onu aydın izah etməkdir. CV-də yazdığınız hər mühüm bacarıq və nəticə haqqında danışmağa hazır olmalısınız.

İlk dəfə müraciət edirsinizsə, iş nümunəsi yalnız əmək müqaviləsi ilə gördüyünüz iş demək deyil. Universitet layihəsi, könüllülük, tələbə təşkilatı və müstəqil iş də uyğun nümunə ola bilər. Vacib olan konteksti düzgün adlandırmaq və şəxsi töhfənizi göstərməkdir.

## 1. Elandan hazırlıq siyahısı çıxarın

Vakansiyanın mətnini saxlayın. Sonradan elan bağlana və ya dəyişə bilər. Üç-beş əsas tələbi seçərək hər birinin qarşısına öz nümunənizi yazın. Tələb texniki alətlə bağlıdırsa, həmin alətlə gördüyünüz işi; əməkdaşlıqla bağlıdırsa, komanda daxilində yaşadığınız real vəziyyəti düşünün.

Özünüz üçün belə bir cədvəl qura bilərsiniz: “Tələb”, “Nümunə”, “Mənim etdiyim”, “Nəticə”, “Daha nəyi izah etməliyəm?”. Cavabsız qalan tələb varsa, yalan nümunə yaratmayın. Hazırlıq zamanı hansı biliyi təkrar etməli və hansı boşluğu dürüst izah etməli olduğunuzu müəyyənləşdirin.

## 2. STAR cavabı necə qurulur?

STAR vəziyyət, tapşırıq, hərəkət və nəticəni ardıcıl izah etmək üçün çərçivədir. [MIT-nin müsahibə bələdçisi](https://capd.mit.edu/resources/interview-primer/) də davranış suallarına hazırlaşarkən bu quruluşdan istifadə edir.

- **Vəziyyət (Situation):** hansı şəraitdə idiniz?
- **Tapşırıq (Task):** nəyi həll etməli idiniz?
- **Hərəkət (Action):** konkret olaraq nə etdiniz?
- **Nəticə (Result):** nə dəyişdi və bunu necə bildiniz?

> **Nümunə (şərti):** Universitet qrupumuz bir tədbirin qeydiyyatını müxtəlif cədvəllərdə aparırdı və təkrarlanan müraciətlər yaranırdı. Mənim tapşırığım yekun iştirakçı siyahısını hazırlamaq idi. Faylları birləşdirdim, təkrar qeydləri müəyyənləşdirmək üçün e-poçt ünvanlarını yoxladım və təşkilatçıların istifadə edə biləcəyi vahid siyahı hazırladım. Tədbirdən əvvəl siyahını qrupla yoxladıq və qeydiyyatda eyni şəxsin iki dəfə sayılması aradan qalxdı.

Bu cavab üçün böyük gəlir rəqəmi və ya direktor vəzifəsi tələb olunmur. Hərəkət və nəticə aydındır. Öz cavabınızda başqasının nümunəsini mənimsəmək əvəzinə, eyni sualları öz təcrübənizə tətbiq edin.

## 3. “Özünüz haqqında danışın” sualına nə deməli?

Həyatınızın bütün tarixini danışmağa ehtiyac yoxdur. Müraciət etdiyiniz işə aid hazırlığınızı, bir uyğun nümunəni və bu istiqamətdə nə axtardığınızı qısa izah edin. Vaxtı məşq üçün təxminən bir dəqiqə götürə bilərsiniz; bu, hər müsahibənin məcburi qaydası deyil.

Məsələn, yeni məzun namizəd təhsilini, uyğun layihəsini və həmin layihədə hansı bacarığını inkişaf etdirdiyini göstərə bilər. Təcrübəli namizəd isə ən uyğun məsuliyyət və nəticəni seçə bilər. Cavab CV-ni sətir-sətir oxumağa çevrilməsin.

## 4. Şirkət və rol barədə nəyi araşdırmalı?

Şirkətin rəsmi saytından məhsulunu və ya xidmətini, işlədiyi müştəri qrupunu və vakansiyanın hansı komandaya aid olduğunu öyrənin. Bu məlumatdan sual hazırlamaq üçün istifadə edin, təsdiqlənməmiş şirkət planlarını fakt kimi danışmayın.

“Niyə burada işləmək istəyirsiniz?” sualına cavabınız sizin həqiqi marağınıza əsaslansın. Öyrənmək istədiyiniz məsuliyyət, tanış olduğunuz məhsul və ya uyğun iş istiqaməti ola bilər. Sadəcə “tanınmış şirkətsiniz” deməkdənsə, işin hansı hissəsinin sizi cəlb etdiyini izah edin.

## 5. Çətin sualda necə davranmalı?

Cavabı bilmirsinizsə, bunu aydın deyin və məsələyə necə yanaşacağınızı izah edin. Texniki tapşırıq qeyri-müəyyəndirsə, əvvəl şərtləri dəqiqləşdirin. CV-dəki nəticəni dəqiq xatırlamırsınızsa, yeni rəqəm uydurmayın.

Komanda uğurundan danışanda “biz” və “mən” hissələrini ayırın. Məxfi müştəri məlumatlarını göstərmədən də problemin növünü, üsulu və öz töhfənizi təsvir etmək mümkündür.

## Müsahibədən əvvəl və sonra

Bir gün əvvəl keçid, saat, ünvan və müsahibə formatını yoxlayın. Onlayn görüşdürsə, səs və internet bağlantısını sınaqdan keçirin. Namizəd kimi siz də sual verə bilərsiniz: ilk aylarda hansı nəticələr gözlənilir, komanda işi necə bölür və növbəti mərhələ nədir?

Görüşdən sonra özünüz üçün qısa qeyd yazın: nə soruşuldu, hansı nümunə aydın olmadı, növbəti dəfə nəyi yaxşılaşdırmalısınız? Razılaşdırılmış vaxt keçibsə, nəzakətli bir təqib məktubu göndərmək olar; ardıcıl çoxlu mesaj yazmayın.

Hazırlıq aydınlıq və özünəinam verə bilər, iş təklifinə zəmanət deyil. Əvvəlcə [CV-dəki sübutları qaydaya salın](/blog/cv-nece-yazilir), sonra lazım olduqda [motivasiya məktubunu](/blog/motivasiya-mektubu-nece-yazilir) həmin rol üçün hazırlayın.`,
  },
  {
    slug: 'motivasiya-mektubu-nece-yazilir',
    aliases: ['motivasiya-mektubu', 'cover-letter-nece-yazilir'],
    title: 'Motivasiya məktubu necə yazılır? Azərbaycan dilində nümunə',
    description: 'Motivasiya məktubunda uyğun təcrübəni, rol seçimini və töhfənizi necə izah etməli? Qısa quruluş, uydurma nümunə və yoxlama siyahısı.',
    publishedAt: '2026-10-20',
    updatedAt: '2026-10-20',
    readTimeMinutes: 5,
    author: {
      name: 'AISE',
      url: 'https://aisehr.com',
    },
    tags: ['Motivasiya məktubu', 'Cover Letter', 'Müraciət'],
    body: `Motivasiya məktubu CV-dəki bütün iş yerlərini abzaslara çevirmək üçün deyil. Məktubu oxuyan şəxs bu vəzifəyə niyə müraciət etdiyinizi, hansı nümunələrin uyğunluğunuzu göstərdiyini və işə nə ilə töhfə verə biləcəyinizi anlamalıdır.

Əvvəlcə elanın tələbinə baxın. Məktub istənilirsə, göstərilən dilə, uzunluğa və göndəriş üsuluna əməl edin. Portal konkret suala cavab istəyirsə, standart məktub yapışdırmaq əvəzinə həmin sualı cavablandırın.

## Yazmazdan əvvəl dörd suala cavab verin

Bu rolda hansı məsuliyyət sizin üçün maraqlıdır? Elanın hansı əsas tələbinə uyğun nümunəniz var? Bu şirkət haqqında təsdiqlənmiş nə bilirsiniz? Özünüzü hansı töhfə ilə təqdim etmək istəyirsiniz?

Son iki suala hazır cavabınız yoxdursa, şirkət üçün uydurma təriflər yazmayın. Rəsmi məlumatı oxuyun və öz marağınızı müəyyənləşdirin. “Bu işdə hesabatların hazırlanması və nəticələrin izahı hissəsi məni cəlb edir” kimi həqiqi, sadə bir səbəb də faydalıdır.

## İşlək quruluş

- **Giriş:** hansı vəzifəyə müraciət etdiyinizi və ən güclü uyğun tərəfinizi qısa göstərin.
- **Əsas hissə:** bir və ya iki nümunə seçərək onların bu işə aidiyyətini izah edin.
- **Motivasiya və töhfə:** namizədin həqiqi marağını və hazırlığını göstərin.
- **Sonluq:** görüşə açıq olduğunuzu bildirin və diqqətə görə təşəkkür edin.

[Harvard-ın məktub bələdçisi](https://careerservices.fas.harvard.edu/resources/hes-create-impactful-resumes-and-cover-letters/) də mətnin vəzifə və təşkilata uyğun olmasını, konkret nümunələrə söykənməsini tövsiyə edir. Buradakı quruluş başlanğıcdır; hər məktub eyni cümlələrlə başlamamalıdır.

## Azərbaycan dilində qısa nümunə (şərti)

> **Hörmətli seçim komandası,**
>
> Nümunə Analitika MMC tərəfindən elan olunmuş kiçik məlumat analitiki vakansiyasına müraciət edirəm. SQL və Power BI ilə hazırladığım tədris layihəsində məlumatların birləşdirilməsi və nəticələrin hesabat formasında təqdim edilməsi üzərində işləmişəm.
>
> Layihədə müxtəlif mağazaların satış fayllarını birləşdirdim, təkrarlanan qeydləri yoxladım və məhsullar üzrə müqayisə aparmaq üçün Power BI hesabatı hazırladım. Bu iş zamanı yalnız qrafik qurmağa deyil, hesablamaların ilkin məlumatla uyğunluğunu yoxlamağa da diqqət yetirdim. Elanda göstərilən məlumatların hazırlanması və hesabatlılıq tapşırıqları ilə bu nümunə arasında əlaqə görürəm.
>
> Biznes suallarının analitik tapşırıqlara çevrilməsi bu rolda məni xüsusilə maraqlandırır. Hazırladığım işi göstərərək yanaşmamı izah etmək və komandanızın ehtiyaclarını daha yaxından öyrənmək istərdim.
>
> Müraciətimi nəzərdən keçirdiyiniz üçün təşəkkür edirəm.
>
> Hörmətlə,
> Aysel Məmmədova

Bu nümunədə böyük uğur vəd edilmir, görülmüş işin rola aidiyyəti göstərilir. Şirkət haqqında təsdiqlənməmiş “bazar lideri” və ya “innovativ mədəniyyət” kimi iddialar da yoxdur.

## Tez-tez zəiflədən ifadələr

“Ünsiyyət bacarığım yüksəkdir” yazırsınızsa, həmin bacarığı göstərən uyğun nümunə varmı? Yoxdursa, cümlə yer tutmaqdan başqa çox şey etməyə bilər. “Müxtəlif tapşırıqlar icra etmişəm” ifadəsini də konkret tapşırıqla əvəz edin.

Bütün iş yerlərinin tarixini məktubda təkrar yazmaq məcburi deyil. Ən uyğun iki nümunə uzun siyahıdan daha aydın ola bilər. Mükafat və sertifikat varsa, rol üçün niyə əhəmiyyətli olduğunu düşünün; onları hər abzasda təkrarlamayın.

Tərcümə edilmiş mətni xüsusi diqqətlə oxuyun. Şirkət adı, vəzifə və mükafat bir-birinə qarışmamalıdır. “Gəlir”, “mənfəət”, “təxmin edilən qənaət” və “əldə edilmiş nəticə” eyni anlayışlar deyil. İngilis terminini saxlayırsınızsa, cümlənin Azərbaycan dilində qalan hissəsi təbii və anlaşılan olsun.

## Göndərməzdən əvvəl yoxlayın

- Şirkətin və vəzifənin adı doğrudurmu?
- Məktub başqa müraciətdən qalmış təşkilat adı daşıyırmı?
- Hər faktı öz sözlərinizlə izah edə bilərsinizmi?
- Şəxsi motivasiya həqiqətən sizə aiddirmi?
- Məktub CV-ni tamamlayır, yoxsa sadəcə təkrarlayır?

Son olaraq PDF-ni açın, abzasları və Azərbaycan hərflərini yoxlayın. Qısa, təbii və faktlara əsaslanan mətn hazırlayın. Yazını uzatmaq, açar sözləri təkrarlamaq və ya güclü görünmək üçün təcrübəni şişirtmək lazım deyil.

Məktubun əsasını qurmaq üçün əvvəl [vakansiyaya uyğun CV hazırlayın](/blog/cv-nece-yazilir). Sonra həmin nümunələri [müsahibədə izah etməyə hazırlaşın](/blog/musahibeye-hazirliq-star-metodu). Məktub uyğunluğunuzu aydınlaşdırmağa kömək edir; təkbaşına işə qəbul zəmanəti vermir.`,
  },
  ...NICHE_ARTICLES,
  SENIOR_ARTICLE,
];

export function getArticleBySlug(slug: string): BlogArticle | undefined {
  const norm = slug.toLowerCase().trim();
  return BLOG_ARTICLES.find(
    (a) => a.slug === norm || (a.aliases && a.aliases.includes(norm))
  );
}

export function getAllArticles(): BlogArticle[] {
  return BLOG_ARTICLES;
}

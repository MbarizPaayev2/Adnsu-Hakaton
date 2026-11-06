import type { BlogArticle } from './articles';

export const NICHE_ARTICLES: BlogArticle[] = [
  {
    slug: "junior-data-analyst-cv-sql-power-bi",
    title: "Junior Data Analyst CV-si: SQL və Power BI layihələri",
    description: "Junior Data Analyst və BI Developer üçün CV, SQL və Power BI layihə nümunələri. İnteraktiv alətlə öz layihənizdən dürüst CV bəndi hazırlayın.",
    publishedAt: "2026-10-25",
    updatedAt: "2026-10-25",
    readTimeMinutes: 7,
    author: {"name": "AISE", "url": "https://aisehr.com/about"},
    tags: ["Junior+", "Data Analyst", "BI Developer", "SQL", "Power BI", "CV"],
    tool: "evidence",
    quickAnswer: "Junior data və BI müraciətində yalnız alət adları kifayət etmir. Məlumatı hansı məqsədlə təhlil etdiyinizi, özünüzün nə hazırladığınızı və nəticəni necə yoxladığınızı göstərin. Tədris və şəxsi layihələri iş təcrübəsi kimi təqdim etməyin; onları ayrıca layihələr bölməsində izah edin.",
    body: `Junior Data Analyst, BI Developer və Reporting Analyst elanları bəzən oxşar görünsə də, gündəlik iş eyni olmaya bilər. Bir elanda SQL sorğuları və məlumat keyfiyyəti, digərində Power BI modeli və hesabatların yenilənməsi önə çıxır. CV-ni vəzifənin adına deyil, elanın konkret işinə uyğun qurun.

Bu bələdçi həm ilk müraciətini edənlər, həm də ilk işlərində qazandıqları təcrübəni daha aydın göstərmək istəyən namizədlər üçündür. Yuxarıdakı alət yalnız yazdığınız faktları birləşdirir; sizin yerinizə nailiyyət uydurmur.

## Elandan hansı tələbləri seçməliyəm?

Elanı açın və üç sütunlu qeyd aparın: görüləcək iş, tələb olunan alət, təqdim edə biləcəyiniz sübut. “SQL” sözünün yanında konkret iş varmı: məlumatları birləşdirmək, uyğunsuzluqları tapmaq, yoxsa hesabat sorğularını sürətləndirmək? “Power BI” tələb olunursa, elanda model, ölçü, vizual və ya yenilənmə prosesi barədə nə deyilir?

- SQL tələbinə öz yazdığınız sorğu və nəticəni yoxlama üsulu ilə cavab verə bilərsiniz.
- Power BI tələbinə modelin quruluşunu, hazırladığınız ölçünü və hesabatın cavablandırdığı biznes sualını göstərə bilərsiniz.
- Məlumat keyfiyyəti tələbinə boş, təkrarlanan və ziddiyyətli qeydləri necə aşkar etdiyinizi izah edə bilərsiniz.
- Elanda göstərilməyən hər aləti sənədə yerləşdirməyin. Uyğun olanları seçin; müsahibədə hamısını izah etməyə hazır olun.

Bunlar hər elanın məcburi tələbləri deyil. Elanın özünü əsas götürün. Python və ya DAX yazılmayıbsa, onları sadəcə “data işi belə olur” deyə əlavə etməyin.

## Bir layihəni CV bəndinə necə çevirim?

Layihənin adından sonra onun növünü göstərin: tədris layihəsi, şəxsi layihə, təcrübə proqramı və ya iş çərçivəsində görülən iş. Sonra üç suala cavab verin: məqsəd nə idi, mən nə etdim, ortaya nə çıxdı?

> **Nümunə (şərti):** “Pərakəndə satış hesabatı — şəxsi layihə. Açıq məlumat dəstindəki sifariş və məhsul cədvəllərini SQL ilə birləşdirdim, təkrarlanan qeydləri yoxladım və məhsul qruplarını müqayisə etmək üçün Power BI hesabatı hazırladım.”

Bu bənddə uydurma faiz yoxdur. Hesabatın məqsədi, istifadə olunan üsul və iş məhsulu görünür. Əgər real istifadəçi rəyi və ya ölçülmüş nəticə varsa, onu ayrıca dəqiq yaza bilərsiniz. Məlumat dəstindəki satış məbləği sizin yaratdığınız gəlir deyil. Modelləşdirdiyiniz qənaət həyata keçirilmiş qənaət deyil.

Komanda layihəsində bütün nəticəni özünüzə aid etməyin. “Modeli komanda hazırladı; SQL sorğularını və məlumat keyfiyyəti yoxlamalarını mən yazdım” kimi sərhədi aydın ifadə edin.

## Portfelə nə yerləşdirməliyəm?

Yalnız ekran görüntüsü paylaşmaq əvəzinə layihənin qısa izahını hazırlayın. Oxucu hansı suala cavab axtardığınızı və nəticəyə necə gəldiyinizi anlamalıdır.

1. Biznes sualını bir-iki cümlədə yazın.
2. Məlumatın mənbəyini və istifadəsinə icazəni göstərin.
3. Öz töhfənizi, alətləri və əsas yoxlamaları izah edin.
4. Nəticəni və məhdudiyyətləri qeyd edin.
5. Paylaşdığınız keçidi hesabdan çıxmış halda açıb yoxlayın.

Məxfi müştəri məlumatlarını, işəgötürənin daxili fayllarını və giriş açarlarını paylaşmayın. Paylaşmağa icazəniz olmayan işi anonimsizləşdirdiyinizi iddia etməkdənsə, portfel üçün açıq və ya özünüz yaratdığınız məlumatla ayrıca nümunə hazırlayın.

## Təcrübəm azdırsa hansı bölmələr önə çıxmalıdır?

İşlə birbaşa əlaqəli layihə və təhsil məlumatını görünən yerdə yerləşdirin. Bir il təcrübəniz varsa, həmin işdə hazırladığınız real nəticələr daha güclü nümunə ola bilər. Bölmə ardıcıllığını ən aydın sübutunuza görə seçin; tarixləri və fəaliyyət növünü dəyişməyin.

Sertifikat bilik əldə etdiyinizi göstərə bilər, amma işlək layihəni və ya iş təcrübəsini əvəz etmir. SQL sertifikatını SQL sistemini idarə etmək təcrübəsi kimi təqdim etməyin. [Harvard karyera mərkəzinin bələdçisi](https://careerservices.fas.harvard.edu/channels/create-a-resume-cv-or-cover-letter/) də sənəddə ən güclü uyğun məlumatın seçilməsini vurğulayır.

## Göndərməzdən əvvəl özümü necə yoxlayım?

- Bir SQL sorğumu açıb nə etdiyini izah edə bilərəmmi?
- Hesabatdakı rəqəmi ilkin məlumatla yoxlaya bilərəmmi?
- Dəstəyi komanda veribsə, öz töhfəmi ayırmışammı?
- Alət adları və dil səviyyələri həqiqətə uyğundurmu?
- Fayl və portfel keçidi başqa cihazdan açılırmı?

Bunlar uyğunluq faizi və ya işə qəbul proqnozu deyil. Öz nümunənizi daha aydın təqdim etmək üçün yoxlama suallarıdır.

## Növbəti addım nədir?

Hazırladığınız bəndi profilinizin layihələr bölməsində saxlayın. [Vakansiyaya uyğun CV bələdçisində](/blog/cv-nece-yazilir) başlıq və bölmə seçimini, [ATS bələdçisində](/blog/ats-uygun-cv) isə faylın oxunaqlılığını yoxlayın. Sonra [aktiv vakansiyalar arasında](/jobs) elanın həqiqi tələblərinə uyğun seçim edin. AISE-də profil qurmaq üçün [qeydiyyatdan keçə bilərsiniz](/register); bu səhifədəki alətdən istifadə üçün hesab tələb olunmur.

### Tez-tez verilən sual: açıq məlumatla layihə təcrübə sayılırmı?

Onu şəxsi və ya tədris layihəsi kimi göstərə bilərsiniz. Müştəri üçün kommersiya işi və ya şirkətdə əmək fəaliyyəti kimi təqdim etməyin. Layihənin gücü onun adına deyil, sizin gördüyünüz işin aydınlığına bağlıdır.`,
  },
  {
    slug: "junior-proqramci-cv-github-muraciet",
    title: "Junior proqramçı CV-si: GitHub, layihə və müraciət",
    description: "Junior frontend və backend proqramçı üçün CV və GitHub portfeli. Layihəni necə izah etməli və iş müraciəti e-poçtunda nə yazmalı? İnteraktiv mətn qurucusu.",
    publishedAt: "2026-10-25",
    updatedAt: "2026-10-25",
    readTimeMinutes: 7,
    author: {"name": "AISE", "url": "https://aisehr.com/about"},
    tags: ["Junior+", "Proqramçı", "Frontend", "Backend", "GitHub", "CV", "E-poçt"],
    tool: "email",
    quickAnswer: "Junior proqramçı müraciətində texnologiya siyahısı ilə kifayətlənməyin: bir uyğun layihəni, öz töhfənizi və işi necə yoxladığınızı göstərin. E-poçtla müraciətdə əvvəlcə elanın göndəriş qaydasını izləyin; vəzifəni aydın yazın və məktuba bir konkret iş nümunəsi əlavə edin.",
    body: `“React bilirəm” və “Python ilə işləmişəm” ifadələri hansı problemi həll etdiyinizi göstərmir. Junior frontend və ya backend vakansiyasına müraciətdə oxucu işlək nümunənizi tapmalı, sizin rolunuzu anlamalı və uyğun hissəni tez görə bilməlidir. İlk işini axtaranla artıq bir neçə layihə təhvil verən namizəd eyni sübutları seçməyə bilər.

Yuxarıdakı alətlə yalnız özünüzün yazdığınız faktlardan qısa müraciət e-poçtu hazırlaya bilərsiniz. Alət e-poçt göndərmir, CV faylı əlavə etmir və işə qəbul ehtimalı hesablamır.

## Elana uyğun layihəni necə seçməliyəm?

Bütün layihələri eyni uzunluqda sadalamaq əvəzinə, elanın əsas işinə ən yaxın olanı seçin. Frontend elanında istifadəçi axını, forma, əlçatanlıq və responsiv görünüş; backend elanında API, məlumat modeli, giriş icazələri və səhv halları mühüm ola bilər. Bunlar nümunələrdir: sizin elanınız başqa tələblər verə bilər.

Bir uyğun layihəni belə izah edin: hansı istifadəçi problemini həll edir, siz hansı hissəni yazmısınız, onu necə yoxlamısınız, nəticəni harada görmək olar? İşin növünü dəqiqləşdirin: kurs tapşırığı, şəxsi layihə, komanda layihəsi, təcrübə proqramı və ya iş.

> **Nümunə (şərti):** “Tapşırıq izləmə tətbiqi — kurs layihəsi. REST API-də tapşırıqların yaradılması və yenilənməsini, istifadəçi üzrə giriş yoxlamasını və səhv cavablarını yazdım. Əsas uğurlu və uğursuz ssenarilər üçün inteqrasiya yoxlamaları hazırladım.”

Bu bəndin işləməsi üçün real layihədə həmin işləri görmüş olmalısınız. Test yazmamısınızsa, onu sadəcə elanda tələb olunduğu üçün əlavə etməyin. Öyrənmə planını təcrübə kimi göstərməyin.

## GitHub deposunda nə görünməlidir?

Oxucuya ilk addımı asanlaşdırın. README-də layihənin məqsədini, öz töhfənizi, işlətmə qaydasını və məlum məhdudiyyətləri yazın. Kurs müəlliminin nümunəsini dəyişmisinizsə, başlanğıc mənbəni və sizin etdiyiniz fərqi qeyd edin.

- Frontend üçün əsas istifadəçi axınının ekran görüntüsü və ya işlək demo faydalı ola bilər.
- Backend üçün API nümunəsi, məlumat modelinin qısa izahı və yoxlama qaydası əlavə edə bilərsiniz.
- Komanda layihəsində bütün kodu sizin yazdığınızı təsəvvür etdirməyin; öz hissənizi konkretləşdirin.
- Giriş açarı, parol, şəxsi istifadəçi məlumatı və icazəsiz iş materialını depoya yerləşdirməyin.
- Keçidi hesabdan çıxmış halda yoxlayın. Məxfi depo açılmırsa, paylaşmağa icazəli ayrıca nümunə təqdim edin.

Töhfə və nəticənin mənası commit sayından daha vacibdir. CV-də hansı texnologiyadan nə üçün istifadə etdiyinizi izah edə bilməlisiniz; populyar alət adlarını əlavə etməklə bu boşluğu doldurmaq olmur.

## CV göndərərkən mövzu hissəsinə nə yazmalıyam?

İlk qayda elanın öz göstərişidir. İşəgötürən konkret mövzu, referans nömrəsi və ya müraciət forması istəyirsə, həmin qaydanı izləyin. Tələb göstərilməyibsə, vəzifənin adı və ad-soyadınız oxucuya müraciəti ayırmağa kömək edir.

> **Nümunə (şərti):** “Junior Backend Developer — Aysel Məmmədova”.

Müraciət forması tələb olunan elana sadəcə tapdığınız ümumi e-poçt ünvanından məktub göndərmək düzgün müraciət yolunu əvəz etmir. [Dövlət Məşğulluq Agentliyinin karyera səhifəsi](https://dma.gov.az/agentlik/karyera) də öz qəbul yolunu ayrıca göstərir; hər təşkilatın aktual elanına baxın. Bu bələdçidəki nümunə konkret vakansiya elanı deyil.

## E-poçtun mətnində nə olmalıdır?

Salamlayın, hansı vəzifəyə müraciət etdiyinizi bildirin və bir uyğun iş nümunəsini qısa izah edin. Sonra əlaqə üçün imzanızı əlavə edin. E-poçt CV-nin bütün iş tarixçəsini təkrar etməməlidir.

> **Nümunə (şərti):** “Hörmətli işə qəbul komandası, Junior Backend Developer vakansiyasına müraciət edirəm. Şəxsi layihəmdə istifadəçi üzrə giriş qaydaları olan tapşırıq API-si hazırladım və səhv ssenarilərini yoxladım. CV-mi və layihə keçidimi nəzərdən keçirməyinizi xahiş edirəm.”

Bu cümləni yalnız öz işinizə uyğunlaşdırdıqdan sonra istifadə edin. Mürəkkəb söz və həddindən artıq tərif əlavə etməkdənsə, konkret nümunə seçin. [Motivasiya məktubu bələdçisində](/blog/motivasiya-mektubu-nece-yazilir) rol və şirkətə marağı daha geniş izah etməyin yolları var; uzun məktub yalnız istənildiyi və ya mənalı əlavə verdiyi halda lazımdır.

## Göndərişdən əvvəl hansı səhvləri yoxlamalıyam?

1. Alıcının ünvanı və müraciət üsulu elandakı ilə eynidirmi?
2. Mövzu hissəsində düzgün vəzifə və tələb olunursa referans nömrəsi varmı?
3. CV-ni ayrıca əlavə etmişəmmi və fayl açılırmı?
4. Məktubda qalan mötərizə, nümunə ad və ya başqa şirkət adı varmı?
5. Layihə keçidi başqa istifadəçi üçün açılırmı?
6. Mətnin içindəki hər işi müsahibədə izah edə bilərəmmi?

Alətin “köçürüldü” bildirişi e-poçtun göndərildiyi və ya faylın əlavə olunduğu demək deyil. Son yoxlamanı öz e-poçt proqramınızda edin.

## Cavab gəlmirsə nəyi izləməliyəm?

Vəzifəni, şirkəti, göndərmə tarixini, istifadə etdiyiniz CV versiyasını və növbəti addımı qeyd edin. Eyni şirkətə ardıcıl eyni məktub göndərmək əvəzinə, elan hələ açıqdırsa və əlaqə qaydası buna uyğundursa, nəzakətli sorğu ilə müraciətinizin vəziyyətini dəqiqləşdirə bilərsiniz. Cavabsızlıq təkbaşına bacarığınızın qiyməti deyil.

[ATS formatını yoxlayın](/blog/ats-uygun-cv), [müsahibəyə hazırlaşın](/blog/musahibeye-hazirliq-star-metodu) və [uyğun vakansiyaları araşdırın](/jobs). AISE-də profil və müraciət cədvəli üçün [hesab yarada bilərsiniz](/register). Buradakı mətn qurucusu qeydiyyatsız işləyir.

### Tez-tez verilən sual: kommersiya təcrübəm yoxdursa müraciət edə bilərəmmi?

Elanın həqiqi tələblərinə baxın. Şəxsi və tədris layihələrinizi dürüst təqdim edə bilərsiniz; onları kommersiya təcrübəsi kimi göstərməyin. Hazırlamadığınız test, istifadə etmədiyiniz alət və görmədiyiniz istifadəçi nəticəsini CV-yə əlavə etməyin.`,
  },
];

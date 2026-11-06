# -*- coding: utf-8 -*-
"""Builds eval/v2 (jobs.json, personas.json, labels.json). Written by the engineer on 3 October 2026 BEFORE any scorer
was run on it. SYNTHETIC postings and personas, ENGINEER-LABELLED: no native-speaker or independent human review has taken place.

    python eval/v2/build.py

Splits: "dev" personas may be used while changing the rules scorer. "sealed" personas are not scored until the scorer is
frozen, and are then scored once; anything changed afterwards makes them a development set (record that in the report).
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))

BLURB = ("Şirkətimiz Azərbaycan bazarında uzun illərdir fəaliyyət göstərir. Biz keyfiyyəti və müştəri məmnuniyyətini əsas tuturuq. "
         "Təklif edirik: rəqabətli əmək haqqı, sosial paket, peşəkar inkişaf. İş qrafiki: bazar ertəsi - cümə, 09:00-18:00. ")
SOFT = " Komanda ilə işləmək bacarığı, məsuliyyətlilik, yüksək ünsiyyət qabiliyyəti və vaxtı düzgün idarə etmək."

# id, title, location, exp, education, seniority, description, requirements
J = [
    ("v01", "Müştəri xidməti operatoru (çağrı mərkəzi)", "Bakı", "1 ilədək", "Orta", "", "Gələn zəngləri cavablandırmaq, müştəri müraciətlərini CRM sistemində qeyd etmək və şikayətləri həll etmək.", "Azərbaycan və rus dillərində səlis danışıq, kompüter biliyi, CRM ilə işləmək bacarığı."),
    ("v02", "IT Support Specialist", "Bakı", "1-3 il", "Bakalavr", "", "Provide first and second line technical support to employees: user accounts, workstations, printers and network access.", "Windows and Office administration, Active Directory, basic networking, hardware troubleshooting, helpdesk ticketing experience."),
    ("v03", "Texniki dəstək mühəndisi (IT helpdesk)", "Bakı", "1-3 il", "Bakalavr", "", "İstifadəçilərin kompüter, şəbəkə və proqram problemlərinin həlli, avadanlıqların quraşdırılması və texniki dəstək.", "Windows, Active Directory, şəbəkə əsasları, aparat təminatının təmiri, helpdesk sistemləri ilə iş təcrübəsi."),
    ("v04", "Специалист службы поддержки клиентов", "Баку", "1 ilədək", "Orta", "", "Консультирование клиентов по телефону и в чате, регистрация обращений в CRM, решение жалоб.", "Свободное владение русским и азербайджанским языками (обязательно), грамотная речь, опыт работы с CRM."),
    ("v05", "Customer Success Specialist", "Bakı", "1-3 il", "Bakalavr", "", "Onboard new business clients, keep them satisfied, resolve issues and identify upsell opportunities.", "Client relationship experience, CRM, good communication, English and Azerbaijani."),
    ("v06", "Sistem administratoru", "Bakı", "3-5 il", "Bakalavr", "", "Server və şəbəkə infrastrukturunun idarə olunması, ehtiyat surətlərin çıxarılması, istifadəçi hüquqlarının idarəsi.", "Linux və Windows Server, şəbəkə avadanlıqları, ehtiyat surətləmə, virtuallaşdırma bilikləri."),
    ("v07", "Telefon satışı operatoru", "Bakı", "1 ilədək", "Orta", "", "Mövcud və potensial müştərilərə zəng etməklə məhsul və xidmətlərin satışı, satış skriptlərinə əməl etmək.", "Telefonla danışıqlar aparmaq bacarığı, satış hədəflərinə çatmaq, CRM biliyi, rus və Azərbaycan dilləri."),
    ("v08", "Müştəri xidməti şöbəsinin rəhbəri", "Bakı", "3-5 il", "Bakalavr", "Rəhbər", "Müştəri xidməti komandasının idarə olunması, keyfiyyətə nəzarət, hesabatların hazırlanması.", "Müştəri xidməti sahəsində ən azı 3 il təcrübə, komanda idarəçiliyi bacarığı, hesabat hazırlamaq."),
    ("v09", "Satış meneceri", "Bakı", "1-3 il", "Bakalavr", "", "Müştəri bazasının genişləndirilməsi, satış planının yerinə yetirilməsi, danışıqlar və müqavilələrin bağlanması.", "Satış sahəsində 1-3 il təcrübə, danışıqlar aparmaq bacarığı, CRM, sürücülük vəsiqəsi üstünlükdür."),
    ("v10", "Satış şöbəsinin rəhbəri (Head of Sales)", "Bakı", "5 ildən artıq", "Bakalavr", "Direktor", "Satış strategiyasının hazırlanması, satış komandasının idarə olunması, böyük müştərilərlə danışıqlar.", "Satış sahəsində ən azı 5 il, o cümlədən rəhbər vəzifədə 3 il təcrübə (tələb olunur), strateji düşüncə."),
    ("v11", "Satış məsləhətçisi (mağaza)", "Bakı", "təcrübəsiz", "Orta", "", "Müştərilərə məhsul seçimində məsləhət vermək, malların yerləşdirilməsi və kassa əməliyyatlarında iştirak.", "Müştərilərlə ünsiyyət bacarığı, satış və xidmət sahəsinə maraq, təcrübə tələb olunmur."),
    ("v12", "Marketinq meneceri", "Bakı", "3-5 il", "Bakalavr", "", "Marketinq strategiyasının icrası, rəqəmsal kampaniyalar, büdcənin idarə olunması və komandanın koordinasiyası.", "Marketinq sahəsində 3-5 il təcrübə, rəqəmsal marketinq, analitika, büdcə idarəetməsi."),
    ("v13", "Junior Marketing Specialist", "Bakı", "1 ilədək", "Bakalavr", "", "Support the marketing team with content, social media posts and campaign reports.", "Marketing degree or interest, social media, content creation, good writing; no experience required."),
    ("v14", "Layihə meneceri (İT layihələr)", "Bakı", "5 ildən artıq", "Bakalavr", "", "İT layihələrin planlaşdırılması, komandanın koordinasiyası, risklərin idarə olunması və müştərilərlə əlaqə.", "İT layihələrin idarəsində 5 ildən artıq təcrübə, Agile və Scrum, risk idarəetməsi, Jira."),
    ("v15", "Project Manager (IT)", "Bakı", "3-5 il", "Bakalavr", "", "Plan and deliver software projects, coordinate developers and stakeholders, manage scope, schedule and risks.", "3+ years managing IT projects, Agile/Scrum, risk management, Jira, strong communication."),
    ("v16", "HR meneceri", "Bakı", "3-5 il", "Bakalavr", "", "İşə qəbul, adaptasiya, kadr sənədləşməsi və əməkdaşların qiymətləndirilməsi proseslərinin idarə olunması.", "HR sahəsində 3-5 il təcrübə, Əmək Məcəlləsini bilmək, işə qəbul təcrübəsi."),
    ("v17", "Mühasib", "Bakı", "1-3 il", "Bakalavr", "", "İlkin sənədlərin işlənməsi, əmək haqqı hesablanması, vergi hesabatlarının hazırlanması.", "Mühasibat uçotu, 1C proqramı, Excel, vergi uçotu biliyi."),
    ("v18", "Baş mühasib", "Bakı", "5 ildən artıq", "Bakalavr", "Rəhbər", "Mühasibat uçotunun təşkili, maliyyə hesabatlarının hazırlanması, vergi orqanları ilə əlaqə, mühasiblərin idarə olunması.", "Mühasibat sahəsində ən azı 5 il təcrübə, MHBS bilikləri, vergi qanunvericiliyi, 1C."),
    ("v19", "Financial Analyst", "Bakı", "1-3 il", "Bakalavr", "", "Prepare budgets and forecasts, analyse financial results and support management decisions.", "Financial analysis and modelling, Excel, reporting, 1-3 years of experience."),
    ("v20", "Maliyyə nəzarətçisi (Financial Controller)", "Bakı", "5 ildən artıq", "Bakalavr", "Rəhbər", "Maliyyə nəzarətinin təşkili, konsolidasiya, büdcənin icrasına nəzarət və audit prosesləri.", "ACCA sertifikatı tələb olunur (mütləq), 5 ildən artıq maliyyə təcrübəsi, MHBS, Excel."),
    ("v21", "Mühasib (kiçik şirkət)", "Bakı", "1-3 il", "Bakalavr", "", "Mühasibat uçotunun aparılması, hesabatlar və vergi bəyannamələri.", "Mühasibat uçotu, 1C, Excel. ACCA sertifikatı üstünlük sayılır."),
    ("v22", "Riyaziyyat müəllimi (özəl məktəb)", "Bakı", "1-3 il", "Bakalavr", "", "Orta məktəb şagirdlərinə riyaziyyat tədrisi, dərs planlarının hazırlanması, imtahana hazırlıq.", "Riyaziyyat üzrə ali təhsil, tədris təcrübəsi, dərs planı hazırlamaq bacarığı."),
    ("v23", "İngilis dili müəllimi", "Bakı", "1-3 il", "Bakalavr", "", "İngilis dilinin müxtəlif səviyyələrdə tədrisi, dərs planları və imtahana (IELTS) hazırlıq.", "İngilis dili üzrə ali təhsil, tədris təcrübəsi, IELTS üzrə bilik."),
    ("v24", "Fizika müəllimi", "Bakı", "1-3 il", "Bakalavr", "", "Fizika fənninin tədrisi, laboratoriya məşğələləri, olimpiadaya hazırlıq.", "Fizika üzrə ali təhsil, tədris təcrübəsi, dərs planı hazırlamaq."),
    ("v25", "Учитель русского языка", "Баку", "1-3 il", "Bakalavr", "", "Преподавание русского языка и литературы в средней школе, подготовка планов уроков.", "Высшее филологическое образование, опыт преподавания, знание методики."),
    ("v26", "Kimya müəllimi", "Bakı", "1-3 il", "Bakalavr", "", "Kimya fənninin tədrisi, laboratoriya təcrübələrinin təşkili, dərs planı.", "Kimya üzrə ali təhsil, tədris təcrübəsi."),
    ("v27", "İbtidai sinif müəllimi", "Bakı", "1-3 il", "Bakalavr", "", "İbtidai sinif şagirdlərinə bütün fənlərin tədrisi, valideynlərlə əlaqə, dərs planı.", "Pedaqoji təhsil, uşaqlarla iş bacarığı, tədris təcrübəsi."),
    ("v28", "Kassir", "Bakı", "təcrübəsiz", "Orta", "", "Kassa əməliyyatlarının aparılması, nağd və kart ödənişlərinin qəbulu, günün sonunda kassanın bağlanması.", "Dəqiqlik, kassa aparatı ilə işləmək, müştərilərlə nəzakətli ünsiyyət."),
    ("v29", "Satış məsləhətçisi (elektronika)", "Bakı", "1 ilədək", "Orta", "", "Elektron məhsulların satışı, müştərilərə texniki xüsusiyyətlər barədə məsləhət, satış planının yerinə yetirilməsi.", "Satış təcrübəsi üstünlükdür, müştəri xidməti bacarığı, texnologiyaya maraq."),
    ("v30", "Backend Developer (Node.js)", "Bakı", "3-5 il", "Bakalavr", "", "Design and build REST APIs and services on Node.js and PostgreSQL, write tests, review code.", "Node.js, TypeScript, PostgreSQL, REST API, Git, Docker; 3+ years of experience."),
    ("v31", "Frontend Developer (React)", "Bakı", "1-3 il", "Bakalavr", "", "Build user interfaces with React and TypeScript, work with designers and backend engineers.", "React, TypeScript, HTML, CSS, Git; 1-3 years of experience."),
    ("v32", "QA mühəndisi", "Bakı", "1-3 il", "Bakalavr", "", "Proqram məhsullarının test planlarının hazırlanması, əl ilə və avtomatlaşdırılmış testlər, xətaların qeydiyyatı.", "QA təcrübəsi, test case yazmaq, Postman, SQL biliyi."),
    ("v33", "DevOps mühəndisi", "Bakı", "3-5 il", "Bakalavr", "", "CI/CD boru kəmərlərinin qurulması, Docker və Kubernetes mühitinin idarə olunması, monitorinq.", "Linux, Docker, Kubernetes, CI/CD, AWS və ya Azure, skript yazmaq."),
    ("v34", "Data Analyst", "Bakı", "1-3 il", "Bakalavr", "", "Collect and analyse business data, build dashboards and reports, support decisions with SQL and Excel.", "SQL, Excel, Power BI or similar, statistics, 1-3 years of experience."),
    ("v35", "Tibb bacısı", "Bakı", "1-3 il", "Orta xüsusi", "", "Xəstələrə qulluq, inyeksiyaların aparılması, həkimin təyinatlarının icrası, tibbi sənədləşmə.", "Orta tibbi təhsil, tibb bacısı vəsiqəsi, xəstələrlə iş təcrübəsi."),
    ("v36", "Həkim-terapevt", "Bakı", "3-5 il", "Ali", "", "Xəstələrin qəbulu, diaqnostika, müalicənin təyini və tibbi sənədləşmə.", "Ali tibbi təhsil, həkim sertifikatı və lisenziya tələb olunur, 3 ildən artıq təcrübə."),
    ("v37", "Aptek satıcısı", "Bakı", "təcrübəsiz", "Orta", "", "Aptekdə dərman və tibbi vasitələrin satışı, müştərilərə məsləhət, kassa əməliyyatları.", "Tibbi və ya əczaçılıq sahəsinə maraq, müştəri xidməti, dəqiqlik."),
    ("v38", "İnşaat mühəndisi", "Bakı", "3-5 il", "Bakalavr", "", "Tikinti sahəsində işlərin nəzarəti, layihə sənədlərinin yoxlanması, hesabatlar və təhlükəsizlik tələblərinə əməl olunması.", "İnşaat mühəndisliyi üzrə ali təhsil, AutoCAD, tikinti nəzarəti təcrübəsi."),
    ("v39", "Elektrik mühəndisi", "Bakı", "3-5 il", "Bakalavr", "", "Elektrik sistemlərinin layihələndirilməsi, quraşdırılması və texniki xidməti.", "Elektrik mühəndisliyi üzrə ali təhsil, AutoCAD, elektrik təhlükəsizliyi."),
    ("v40", "Smeta mühəndisi", "Bakı", "1-3 il", "Bakalavr", "", "Tikinti layihələri üzrə smeta hesablamalarının hazırlanması və yoxlanması, həcmlərin hesablanması.", "Tikinti smetası, AutoCAD, Excel, 1-3 il təcrübə."),
    ("v41", "Sürücü (B kateqoriya)", "Bakı", "1-3 il", "Orta", "", "Şirkət nəqliyyat vasitəsini idarə etmək, işçiləri və sənədləri çatdırmaq, avtomobilin texniki vəziyyətinə nəzarət.", "Sürücülük vəsiqəsi (B kateqoriyası) mütləq tələb olunur, Bakını yaxşı bilmək, təmiz sürücülük tarixçəsi."),
    ("v42", "Kuryer", "Bakı", "təcrübəsiz", "Orta", "", "Sifarişlərin müştərilərə vaxtında çatdırılması, ödənişlərin qəbulu.", "Mobil telefon, məsuliyyət, Bakını bilmək; şəxsi nəqliyyat vasitəsi üstünlükdür."),
    ("v43", "Logistika mütəxəssisi", "Bakı", "1-3 il", "Bakalavr", "", "Yük daşımalarının planlaşdırılması, təchizatçılarla əlaqə, daşıma sənədlərinin hazırlanması.", "Logistika sahəsində təcrübə, Excel, daşıma sənədləri, danışıqlar."),
    ("v44", "Anbardar", "Bakı", "1-3 il", "Orta", "", "Malların qəbulu, saxlanması və buraxılması, anbar uçotunun aparılması.", "Anbar uçotu, 1C, məsuliyyətlilik, dəqiqlik."),
    ("v45", "Aşpaz", "Bakı", "1-3 il", "Orta", "", "Restoranın mətbəxində yeməklərin hazırlanması, gigiyena qaydalarına əməl olunması.", "Aşpaz təcrübəsi, gigiyena qaydaları, komanda ilə iş."),
    ("v46", "Ofis meneceri", "Bakı", "1-3 il", "Bakalavr", "", "Ofisin gündəlik fəaliyyətinin təşkili, təchizat, sənəd dövriyyəsi və direktorun köməkçiliyi.", "Ofis idarəçiliyi təcrübəsi, MS Office, təşkilatçılıq, yazışma."),
    ("v47", "Resepşn (katibə)", "Bakı", "təcrübəsiz", "Orta", "", "Qonaqların qarşılanması, zənglərin yönləndirilməsi, yazışmaların və qəbul cədvəlinin aparılması.", "Səliqəli görünüş, telefon və yazışma bacarığı, MS Office."),
    ("v48", "Hüquqşünas", "Bakı", "3-5 il", "Ali", "", "Müqavilələrin hazırlanması və yoxlanması, hüquqi məsləhət, məhkəmələrdə şirkətin maraqlarının təmsili.", "Hüquq üzrə ali təhsil, müqavilə hüququ təcrübəsi, vəkillik təcrübəsi üstünlükdür."),
    ("v49", "Scrum Master", "Bakı", "3-5 il", "Bakalavr", "", "Facilitate Scrum ceremonies, remove blockers and coach the team on Agile practices.", "Scrum and Agile certification or experience, facilitation, Jira, communication."),
    ("v50", "Product Manager (fintech)", "Bakı", "3-5 il", "Bakalavr", "", "Define product roadmap, work with engineers and designers, analyse metrics and prioritise features.", "Product management experience, Agile, analytics, stakeholder communication."),
]

LANG = {"az": {"code": "az"}, "ru": {"code": "ru"}, "en": {"code": "en"}}


def persona(pid, split, title, years, targets, skills, role, ach, langs, edu=4, certs=(), expect_no_email=False, summary="", city="Bakı"):
    return {
        "evalId": pid, "split": split, "expectNoEmail": expect_no_email,
        "persona": {
            "candidate_id": "eval-" + pid, "name": "", "email": "", "location": city,
            "languages": [LANG[l] for l in langs], "years_of_experience": years,
            "summary": summary or title, "target_titles": list(targets), "hard_skills": list(skills), "soft_skills": [],
            "experience_history": ([{"company": "Nümunə MMC", "role": role, "location": "", "dates": "", "achievements": [ach]}] if role else []),
            "education": {"rank": edu}, "salary_expectation": {}, "preferred_cities": [city] if city else [], "work_arrangements": ["onsite"],
            "certifications": list(certs),
        },
    }


P = [
    persona("Q1_support_az", "dev", "Müştəri xidməti üzrə operator", 2, ["Müştəri xidməti mütəxəssisi", "Çağrı mərkəzi operatoru"], ["CRM", "Telefon", "Şikayətlərin həlli", "Azərbaycan dili", "Rus dili"], "Çağrı mərkəzi operatoru", "Gələn zəngləri cavablandırdım, müştəri müraciətlərini CRM-də qeyd etdim.", ["az", "ru"], edu=2),
    persona("Q2_it_support_en", "dev", "IT support specialist with helpdesk experience", 3, ["IT Support Specialist", "Helpdesk Engineer"], ["Windows", "Active Directory", "Networking", "Hardware troubleshooting", "Helpdesk", "English"], "IT Support Specialist", "Resolved workstation, account and network issues for 200 users through the helpdesk system.", ["en", "az"]),
    persona("Q3_math_teacher", "dev", "Riyaziyyat müəllimi, imtahana hazırlıq", 5, ["Riyaziyyat müəllimi"], ["Riyaziyyat", "Dərs planı", "İmtahana hazırlıq"], "Riyaziyyat müəllimi", "Orta məktəbdə riyaziyyat tədris etdim və şagirdləri imtahana hazırladım.", ["az"]),
    persona("Q4_sales_junior", "dev", "Mağaza satış məsləhətçisi", 1, ["Satış məsləhətçisi", "Sales Consultant"], ["Satış", "Müştəri xidməti", "Kassa"], "Satış məsləhətçisi", "Mağazada müştərilərə məhsul seçimində məsləhət verdim və kassada işlədim.", ["az", "ru"], edu=2),
    persona("Q5_pm_senior", "dev", "IT project manager with 7 years of delivery experience", 7, ["Layihə meneceri", "Project Manager"], ["Scrum", "Agile", "Jira", "Risk management", "Stakeholder management", "English"], "IT Project Manager", "Delivered 12 software projects with teams of 6-15 using Scrum; managed scope, schedule and risks.", ["en", "az"]),
    persona("Q6_driver", "dev", "Təcrübəli sürücü, B və C kateqoriyası", 6, ["Sürücü"], ["Sürücülük", "Bakını yaxşı bilmək"], "Sürücü", "Şirkət avtomobilini idarə etdim, işçiləri və sənədləri çatdırdım.", ["az", "ru"], edu=2, certs=["Sürücülük vəsiqəsi B, C"]),
    persona("Q7_incomplete", "dev", "", 0, [], ["Excel"], "", "", [], edu=0, expect_no_email=True, summary=""),
    persona("S1_english_teacher", "sealed", "İngilis dili müəllimi", 4, ["İngilis dili müəllimi", "English Teacher"], ["İngilis dili", "IELTS", "Dərs planı"], "İngilis dili müəllimi", "İngilis dilini müxtəlif səviyyələrdə tədris etdim, IELTS-ə hazırlıq kursları apardım.", ["az", "en"]),
    persona("S2_accountant_acca", "sealed", "Mühasib, ACCA sertifikatlı", 6, ["Mühasib", "Maliyyə nəzarətçisi"], ["1C", "Excel", "MHBS", "Vergi uçotu", "Büdcə"], "Baş mühasib", "Mühasibat uçotunu təşkil etdim, MHBS hesabatları hazırladım, vergi orqanları ilə əlaqə saxladım.", ["az", "en"], certs=["ACCA"]),
    persona("S3_telesales_ru", "sealed", "Оператор телефонных продаж", 2, ["Оператор телефонных продаж", "Telefon satışı operatoru"], ["Телефонные продажи", "CRM", "Переговоры", "Rus dili", "Azərbaycan dili"], "Оператор телефонных продаж", "Продавал услуги по телефону, выполнял план продаж, вёл базу клиентов в CRM.", ["ru", "az"], edu=2),
    persona("S4_fin_analyst", "sealed", "Financial analyst, no professional certification", 3, ["Financial Analyst", "Maliyyə analitiki"], ["Financial modelling", "Excel", "Budgeting", "Reporting", "English"], "Financial Analyst", "Prepared budgets and forecasts, analysed monthly results and presented them to management.", ["en", "az"]),
]

LABELS = {
    "_doc": "v2 labels. Written by the engineer on 3 October 2026 BEFORE any scorer was run on this set. ENGINEER-LABELLED, not independent human review. strong = a good suggestion; partial = adjacent or weaker fit; hard = must never be recommended (mandatory qualification/seniority/regulated mismatch); every unlisted pair = poor.",
    "Q1_support_az": {"strong": ["v01", "v04"], "partial": ["v05", "v07"], "hard": []},
    "Q2_it_support_en": {"strong": ["v02", "v03"], "partial": ["v06"], "hard": []},
    "Q3_math_teacher": {"strong": ["v22"], "partial": ["v24", "v26", "v27"], "hard": []},
    "Q4_sales_junior": {"strong": ["v11", "v29"], "partial": ["v09", "v28", "v07"], "hard": ["v10"]},
    "Q5_pm_senior": {"strong": ["v14", "v15"], "partial": ["v49", "v50"], "hard": []},
    "Q6_driver": {"strong": ["v41"], "partial": ["v42"], "hard": []},
    "Q7_incomplete": {"strong": [], "partial": [], "hard": []},
    "S1_english_teacher": {"strong": ["v23"], "partial": ["v25", "v27"], "hard": []},
    "S2_accountant_acca": {"strong": ["v17", "v18", "v20", "v21"], "partial": ["v19"], "hard": []},
    "S3_telesales_ru": {"strong": ["v07"], "partial": ["v01", "v04", "v11", "v05"], "hard": []},
    "S4_fin_analyst": {"strong": ["v19"], "partial": ["v17", "v21", "v34"], "hard": ["v20"]},
}


def posting(row):
    jid, title, loc, exp, edu, senior, desc, req = row
    sidebar = {"Təcrübə": exp, "Təhsil": edu}
    if senior:
        sidebar["Vəzifə dərəcəsi"] = senior
    company = "Şirkət " + jid[1:]
    return {
        "evalId": jid, "family": "", "note": "", "title": title, "slug": jid, "location": loc + ", Azərbaycan" if loc == "Bakı" else loc,
        "company": {"slug": "sirket-" + jid[1:], "name": company},
        "detail": {"title": title, "company_name": company, "location": loc, "description_text": BLURB + desc + " Maraqlanırsınızsa, CV-nizi göndərin.",
                   "requirements_text": req + SOFT, "category": "", "sidebar": sidebar},
    }


def main():
    json.dump([posting(r) for r in J], open(os.path.join(HERE, "jobs.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(P, open(os.path.join(HERE, "personas.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(LABELS, open(os.path.join(HERE, "labels.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("postings %d, personas %d (dev %d, sealed %d)" % (len(J), len(P), sum(p["split"] == "dev" for p in P), sum(p["split"] == "sealed" for p in P)))


if __name__ == "__main__":
    main()

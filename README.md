<div align="center">

<img src="./aiselogo.png" alt="AISE Logo" width="160" />

# AISE (AI Smart Employment)
### Süni İntellekt Əsaslı Karyera və Vakansiya Ekosistemi

**Azərbaycan əmək bazarı üçün fərdiləşdirilmiş süni intellekt dəstəkli iş axtarışı, semantik vakansiya uyğunlaşdırma və Harvard standartlı avtomatlaşdırılmış CV mühərriki.**

[![Next.js](https://img.shields.io/badge/Next.js-16.0-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![NestJS](https://img.shields.io/badge/NestJS-11.0-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)](https://nestjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Prisma](https://img.shields.io/badge/Prisma-6.0-2D3748?style=for-the-badge&logo=prisma&logoColor=white)](https://www.prisma.io/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Typst](https://img.shields.io/badge/Typst-PDF_Engine-239DAD?style=for-the-badge)](https://typst.app/)
[![ADNSU Hackathon](https://img.shields.io/badge/ADNSU_Hackathon-2026-004D98?style=for-the-badge)](#)

[Canlı Demo (Vercel)](https://adnsu-hakaton.vercel.app) • [Sürətli Başlanğıc](#sürətli-başlanğıc-lokal-quraşdırma) • [Əsas Xüsusiyyətlər](#əsas-funksionallıqlar) • [Memarlıq](#layihənin-arxitekturası) • [Məxfilik və Qanunvericilik](#məxfilik-və-fərdi-məlumatların-qorunması)

</div>

---

## Problem və Həll

### Mövcud Problemlər
1. **Parçalanmış Vakansiya Bazarı:** Azərbaycanda vakansiyalar 20-dən çox fərqli platforma, Telegram kanalı və şirkət saytlarına səpələnib. Namizədlər hər gün fərqli mənbələri tək-tək axtarmağa vaxt sərf edirlər.
2. **ATS Uğursuzluğu və Standartsız CV-lər:** Bir çox namizəd hər vakansiyaya eyni şablon CV göndərir və açar sözlər uyğun gəlmədiyi üçün müraciətlər HR/ATS filtrlərində dərhal kənarlaşdırılır.
3. **HR və Şirkətlərin Yükü:** İşəgötürənlər hər vakansiya üçün yüzlərlə qeyri-adekvat müraciəti əllə incələməyə məcbur qalır, vaxt və resurs itirirlər.
4. **Yerli Dildə AI Dəstəyinin Yoxluğu:** Mövcud qlobal AI alətləri Azərbaycan əmək bazarının reallıqlarını və qrammatikasını dəqiq əks etdirmir.

### AISE Həlli
- **Mərkəzləşdirilmiş Aqreqasiya:** Ölkənin 20+ aparıcı platformasından (Glorri, yerli banklar, holdinqlər və s.) vakansiyaların tək portala toplanması.
- **Ağıllı Semantik Uyğunluq (AI Matching):** Namizədin bacarıqlarını vakansiyanın tələbləri ilə dərindən müqayisə edib faiz göstəricisi (skor) və inkişaf tövsiyələri təqdim etmək.
- **Typst Əsaslı Harvard CV Generatoru:** Saniyələr içində seçilən vakansiyanın açar sözlərinə tam uyğunlaşdırılmış, ATS-dostu və qüsursuz Azərbaycan dilində PDF CV hazırlamaq.
- **Yenidən Müraciət (Re-Application) Ekosistemi:** Əvvəl rədd edilmiş və ya təkrar müraciət etmək istəyən namizədlər üçün çevik yeniləmə imkanı.

---

## Əsas Funksionallıqlar

| Xüsusiyyət | Təsvir |
|---|---|
| **AI Semantic Matching** | Namizəd bacarıqları ilə vakansiya tələblərini qarşılaşdıraraq uyğunluq dərəcəsini (% skor) və çatışmayan bacarıqları göstərir. |
| **Harvard CV Mühərriki (Typst)** | Müraciət edilən vakansiyaya özəl, ATS sistemləri tərəfindən 100% oxunan Harvard formatında PDF sənəd generasiya edir. |
| **Ağıllı Yenidən Müraciət** | Namizədlərə profillərini və CV-lərini təkmilləşdirərək əvvəlki müraciətlərini yeniləməyə və təkrar şans qazanmağa imkan verir. |
| **Şirkətlər üçün HR Kabineti** | Vakansiyaların idarə edilməsi, müraciət etmiş namizədlərin süni intellektlə reytinqlənməsi və statusların izlənməsi. |
| **Namizəd İdarəetmə Paneli** | Real-vaxt rejimində müraciət statusları, tövsiyə olunan vakansiyalar və fərdi profil məlumatlarının idarəsi. |
| **Çoxmənbəli Vakansiya Toplayıcısı** | Glorri, şirkət karyera portalları və ATS-lərdən avtomatlaşdırılmış inteqrasiya və məlumat təmizlənməsi. |

---

## Layihənin Arxitekturası

AISE müasir və miqyaslana bilən **Monorepo** arxitekturası üzərində qurulub:

```
aise/
├── aiselogo.png                 # Brend loqosu
├── favicon.ico                  # Tətbiq ikonu
├── docs/                        # Layihə və arxitektura sənədləri
├── packages/
│   └── shared-types/            # Web və API arasında ortaq TypeScript tipləri
└── apps/
    ├── web/                     # Next.js 16 (React 19, Tailwind CSS v4, Turbopack)
    ├── api/                     # NestJS 11 (PostgreSQL, Prisma, BullMQ, Typst Compiler)
    ├── matching-service/        # Süni intellekt semantik analiz və skorinq xidməti
    ├── apply-worker/            # Avtomatlaşdırılmış xarici müraciət worker-i (Playwright)
    └── extension/               # Vakansiyaları bir kliklə daxil edən brauzer əlavəsi
```

---

## Sürətli Başlanğıc (Lokal Quraşdırma)

### Tələblər
- **Node.js**: v20 və ya daha yuxarı
- **npm**: v10 və ya daha yuxarı
- *(İstəyə bağlı)* **Docker**: PostgreSQL və Redis üçün

### 1. Repozitoriyanı klonlayın
```bash
git clone https://github.com/MbarizPaayev2/Adnsu-Hakaton.git
cd Adnsu-Hakaton
```

### 2. Frontend Tətbiqini İşə Salın (Sürətli nümayiş)
PostgreSQL olmadan frontend interfeysini və UI komponentlərini test etmək üçün:
```bash
# Ortaq tipləri kompilyasiya edin
npm run build --workspace=packages/shared-types

# Frontend asılılıqlarını quraşdırın və işə salın
npm install --workspace=apps/web
npm run dev --workspace=apps/web
```
Brauzerdə açın: **[http://localhost:3000](http://localhost:3000)**

---

### 3. Tam Ekosistemi İşə Salın (Backend + Database)
Verilənlər bazası və API ilə tam inteqrasiya üçün:

```bash
# Ətraf mühit dəyişənlərini köçürün
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

# Verilənlər bazasını və Redisi başladın
docker compose up -d postgres redis

# Prisma miqrasiyalarını icra edin
cd apps/api
npx prisma migrate deploy
npx prisma generate
cd ../..

# API və Web servislərini başladın
npm run dev:api     # http://localhost:4000
npm run dev:web     # http://localhost:3000
```

---

## Məxfilik və Fərdi Məlumatların Qorunması

AISE platforması fərdi məlumatların qorunmasını əsas tələb hesab edir:
- **Azərbaycan Respublikasının Qanunvericiliyi:** "Fərdi məlumatlar haqqında" Azərbaycan Respublikasının Qanununun tələblərinə tam riayət olunur.
- **Şifrələmə:** İstifadəçi şifrələri və həssas profil dataları müasir hashing və tokenizasiya standartları ilə saxlanılır.
- **Yalnız İstifadəçi İcazəsi ilə Paylaşım:** Namizədin CV və əlaqə məlumatları yalnız özü müraciət düyməsini sıxdığı halda müvafiq işəgötürənə təqdim olunur.
- **İstənilən Vaxt Silinmə Hüququ:** Namizəd istənilən an öz profilini və yüklənmiş sənədlərini sistemdən tamamilə silmək hüququna malikdir.

---

## Komanda və Əlaqə

Layihə **ADNSU Hakaton 2026** çərçivəsində əmək bazarındakı işsizlik və vakansiya uyğunsuzluğu problemini həll etmək məqsədilə hazırlanmışdır.

- **GitHub Repository:** [https://github.com/MbarizPaayev2/Adnsu-Hakaton](https://github.com/MbarizPaayev2/Adnsu-Hakaton)
- **Təşkilat:** Azərbaycan Dövlət Neft və Sənaye Universiteti (ADNSU)

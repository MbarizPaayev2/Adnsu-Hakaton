import type { CommercialCatalogue, CompanyRef, HomeSummary, NotificationPreferences, SavedJob, SavedSearch } from '../contract';
import { companyKey } from '../companies';

/**
 * FIXTURE DATA ONLY — every name below is a synthetic example ("Nümunə").
 * None of these employers, counts or prices are real. This module is imported
 * only by the fixture adapter, which is only enabled with
 * NEXT_PUBLIC_RETENTION_MODE=fixture.
 */
export const FIXTURE_LABEL = 'Nümunə';

const day = 24 * 3600 * 1000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * day).toISOString();

export const FIXTURE_COMPANIES: CompanyRef[] = [
  { id: 'fx-c-1', name: 'Nümunə Bank ASC', sourceLabel: 'Nümunə mənbə', openVacancies: 4, status: 'APPROVED', isRegistered: true },
  { id: 'fx-c-2', name: 'Nümunə Bank Regional', sourceLabel: 'Nümunə mənbə', openVacancies: 1, status: 'APPROVED', isRegistered: true },
  { id: 'fx-c-3', name: 'Nümunə Logistika MMC', sourceLabel: 'Nümunə mənbə', openVacancies: 2, status: 'APPROVED', isRegistered: true },
  { id: 'fx-c-4', name: 'Nümunə Texnologiya', sourceLabel: 'Nümunə mənbə', openVacancies: 7, status: 'APPROVED', isRegistered: true },
  { id: 'fx-c-5', name: 'Çox uzun adı olan nümunə beynəlxalq konsaltinq və inkişaf şirkəti MMC', sourceLabel: 'Nümunə mənbə', openVacancies: 0, status: 'APPROVED', isRegistered: true },
].map((c) => ({ ...c, key: companyKey(c.name) }));

export function fixtureSavedJobs(): SavedJob[] {
  return [
    { key: 'imported:demo-1', title: 'Nümunə: Maliyyə analitiki', company: 'Nümunə Bank ASC', location: 'Bakı', deadline: iso(9), savedAt: iso(-2), open: true, applyMethod: 'EMAIL' },
    { key: 'imported:demo-2', title: 'Nümunə: Çox uzun vəzifə adı olan baş mütəxəssis köməkçisi (hesabatlıq və planlaşdırma)', company: 'Çox uzun adı olan nümunə beynəlxalq konsaltinq və inkişaf şirkəti MMC', location: 'Bakı, Nəsimi rayonu', deadline: null, savedAt: iso(-4), open: true, applyMethod: 'EXTERNAL' },
    { key: 'imported:demo-3', title: 'Nümunə: Logistika koordinatoru', company: 'Nümunə Logistika MMC', location: 'Sumqayıt', deadline: iso(-3), savedAt: iso(-12), open: false, applyMethod: 'UNKNOWN' },
  ];
}

export function fixtureSearches(): SavedSearch[] {
  return [
    { id: 'fx-s1', name: 'Nümunə: Maliyyə, Bakı', criteria: { q: 'maliyyə', location: 'Bakı', category: 'finance' }, frequency: 'daily', paused: false, updatedAt: iso(-1), newSinceLastVisit: 3 },
    { id: 'fx-s2', name: 'Nümunə: Uzaqdan texnologiya', criteria: { category: 'technology', work: 'remote' }, frequency: 'weekly', paused: true, updatedAt: iso(-6), newSinceLastVisit: null },
  ];
}

export const fixturePreferences: NotificationPreferences = {
  channels: { inApp: true, email: true, telegram: false },
  frequency: 'daily',
  quietHours: { enabled: false, from: '22:00', to: '08:00' },
  paused: false,
  unsubscribedAll: false,
  telegram: 'unavailable',
};

/** Prices and quotas are deliberately unset: the entitlement contract owns them. */
export const fixtureCatalogue: CommercialCatalogue = {
  source: 'fixture',
  candidate: {
    free: {
      id: 'free', name: 'Ödənişsiz', priceAzn: 0, period: 'ay',
      includes: ['Bütün vakansiyalara baxış və axtarış', 'Elanları və axtarışları yadda saxlama', 'CV-nin aydın quruluşda hazırlanması', 'Müraciət üsulunun göstərilməsi'],
      allowances: [{ label: 'Sənəd generasiyası', value: '5 / ay' }],
    },
    plus: {
      id: 'plus', name: 'Plus', priceAzn: null, period: 'ay',
      includes: ['Ayda 30 sənəd generasiyası (Rezüme, CV və ya motivasiya məktubu)', '5 əlavə CV/rezüme versiyası', '20 saxlanan axtarış və gündəlik bildirişlər', 'Harvard şablonunda təcrübə və bacarıq uyğunlaşdırması'],
      allowances: [{ label: 'Sənəd generasiyası', value: '30 / ay' }],
    },
    premium: {
      id: 'premium', name: 'Premium', priceAzn: null, period: 'ay',
      includes: ['Hər elan üçün CV-nin təcrübə və bacarıq vurğusu ilə uyğunlaşdırılması', 'Faktlara əsaslanan fərdi müşayiət məktubu', 'Hər dəyişikliyin sizin tərəfinizdən yoxlanması', 'Düzgün sənəd versiyası və müraciət üsulu'],
      allowances: [{ label: 'Sənəd generasiyası', value: 'Limitsiz' }, { label: 'Saxlanan axtarış xəbərdarlıqları', value: null }],
    },
  },
  employer: [
    { id: 'trial', name: 'Başlanğıc / sınaq', summary: 'Hesab yaradın və platformanı sınayın.', priceAzn: null, available: false, cta: { label: 'Qeydiyyatdan keç', href: '/business/register' } },
    { id: 'single', name: 'Tək elan', summary: 'Bir vakansiya üçün birdəfəlik yerləşdirmə.', priceAzn: null, available: false, cta: { label: 'Bizimlə əlaqə', href: '/contact' } },
    { id: 'recurring', name: 'Biznes paketi', summary: 'Müntəzəm işə qəbul edən komandalar üçün.', priceAzn: null, available: false, cta: { label: 'Bizimlə əlaqə', href: '/contact' } },
    { id: 'enterprise', name: 'Korporativ', summary: 'Xüsusi tələblər və inteqrasiya üçün söhbət.', priceAzn: null, available: false, cta: { label: 'Bizimlə əlaqə', href: '/contact' } },
    { id: 'promoted', name: 'Önə çıxarılmış elan', summary: 'İstəyə bağlı. Önə çıxarılan elanlar açıq “Sponsorlu” etiketi ilə göstəriləcək.', priceAzn: null, optional: true, available: false, cta: { label: 'Bizimlə əlaqə', href: '/contact' } },
  ],
};

export const fixtureHome: HomeSummary = {
  reviewJobs: [
    { key: 'imported:demo-1', title: 'Nümunə: Maliyyə analitiki', company: 'Nümunə Bank ASC' },
    { key: 'imported:demo-4', title: 'Nümunə: Marketinq mütəxəssisi', company: 'Nümunə Texnologiya' },
  ],
  actionApplication: { id: 'demo', title: 'Nümunə: Maliyyə analitiki', company: 'Nümunə Bank ASC', action: 'CV və məktubu yoxlayın, sonra göndərişi təsdiq edin', href: '/dashboard/applications' },
  reply: null,
  searchUpdates: [{ searchId: 'fx-s1', name: 'Nümunə: Maliyyə, Bakı', count: 3 }],
};

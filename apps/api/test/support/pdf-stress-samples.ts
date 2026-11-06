/**
 * Renders SYNTHETIC documents with the shipped Typst templates in awkward shapes (long, sparse, multilingual, unbroken tokens, markup-like text) and writes
 * the PDFs (plus a manifest) to a directory OUTSIDE git, for inspection by pdf-to-png.mjs and by eye. No provider, no database. Not a quality evaluation.
 *   npx ts-node -r tsconfig-paths/register --transpile-only test/support/pdf-stress-samples.ts [outDir]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ResumeTailorService } from '../../src/resumes/tailor/resume-tailor.service';

const svc = new ResumeTailorService({ get: () => undefined } as any);
const base = (name: string, headline: string, location = 'Bakı', email = 'sintetik@example.com') => ({ name, headline, email, phone: '+994 50 000 00 00', location, website: { url: '', label: '' } });
const role = (i: number, text: (j: number) => string, bullets: number, extra: Record<string, string> = {}) => ({ company: `Şirkət ${i + 1}`, position: 'Developer', location: 'Bakı', period: `Jan ${2023 - i} - Dec ${2023 - i}`, highlights: Array.from({ length: bullets }, (_, j) => text(j)), ...extra });
const doc = (over: Record<string, unknown>) => ({ language: 'az', summary: '', experience: [], education: [], skills: [], languages: [], projects: [], certifications: [], activities: [], awards: [], ...over }) as any;
const sentence = 'REST API xidmətinin sorğu müddətini ölçdü, PostgreSQL indekslərini yenilədi və nəticələri komandaya təqdim edərək buraxılış prosesini sürətləndirdi.';
const unbroken = 'U'.repeat(95);
const letter = (language: string, name: string, paragraphs: string[], recipient = { company: 'Nümunə Texnologiya (sintetik)', position: 'Backend Developer', location: 'Bakı' }) => ({
  kind: 'LETTER', language, basics: { name, email: 'sintetik@example.com', phone: '', location: 'Bakı' }, recipient, date: '2026-10-04',
  salutation: { az: 'Hörmətli işə qəbul komandası,', en: 'Dear Hiring Team,', ru: 'Уважаемая команда по подбору персонала,', tr: 'Sayın İşe Alım Ekibi,' }[language]!,
  paragraphs: paragraphs.map((text, i) => ({ id: `p${i + 1}`, text })), closing: { az: 'Hörmətlə,', en: 'Sincerely,', ru: 'С уважением,', tr: 'Saygılarımla,' }[language]!, signature: name,
}) as any;
const long = (s: string, n: number) => Array.from({ length: n }, () => s).join(' ');

export const SAMPLES: Record<string, any> = {
  'cv-az-long': doc({ basics: base('Nigar Əliyeva (sintetik)', 'Backend Developer'), summary: 'Backend Developer. ' + sentence, experience: Array.from({ length: 12 }, (_, i) => role(i, () => sentence, 6)), education: [{ school: 'Bakı Dövlət Universiteti (sintetik)', degree: 'Bakalavr', area: 'Tətbiqi riyaziyyat', location: 'Bakı', period: '2012 - 2016', grade: '' }], skills: [{ name: '', keywords: ['TypeScript', 'Node.js', 'PostgreSQL', 'REST API', 'Docker', 'Redis', 'Git', 'CI/CD', 'SQL'], proficiency: '', level: 0 }], languages: [{ language: 'Azərbaycan dili', fluency: 'Ana dili', level: 5 }, { language: 'English', fluency: 'B2', level: 3 }], projects: Array.from({ length: 4 }, (_, i) => ({ entryId: `p${i}`, name: `Layihə ${i + 1}`, period: '2022', description: sentence })), certifications: [{ entryId: 'c1', title: 'PostgreSQL Professional', issuer: 'Nümunə Akademiya', date: '2022' }] }),
  'resume-en-sparse': doc({ language: 'en', basics: { ...base('Daniel Whitfield (synthetic)', ''), phone: '', location: '', email: '' }, experience: [{ company: 'Caspian Analytics', position: 'Data Analyst', location: '', period: '2021 - Present', highlights: ['Built weekly dashboards in Power BI.'] }] }),
  'resume-en-empty-bullets': doc({ language: 'en', basics: base('Daniel Whitfield (synthetic)', 'Data Analyst'), summary: '', experience: [{ company: 'Caspian Analytics', position: 'Data Analyst', location: 'Baku', period: '2021 - Present', highlights: [] }], skills: [{ name: '', keywords: [], proficiency: '', level: 0 }] }),
  'cv-ru': doc({ language: 'ru', basics: base('Анна Петрова (синтетическая)', 'Специалист клиентского сервиса', 'Баку'), summary: 'Специалист клиентского сервиса с опытом работы в контакт-центре.', experience: [role(0, () => 'Обрабатывала до 60 обращений в день, обучила пятерых новых сотрудников и поддерживала оценку клиентов выше 4,6.', 4, { company: 'Бакинский контакт-центр (синтетика)', position: 'Старший оператор', period: 'Sep 2020 - Present' })], education: [{ school: 'Славянский университет (синтетика)', degree: 'Бакалавр', area: 'Филология', location: 'Баку', period: '2014 - 2018', grade: '' }], skills: [{ name: '', keywords: ['Работа с клиентами', 'CRM', 'Microsoft Office'], proficiency: '', level: 0 }], languages: [{ language: 'Русский', fluency: 'Родной', level: 5 }] }),
  'cv-tr': doc({ language: 'tr', basics: base('İsmail Çağlar Öztürk (sentetik)', 'Yazılım Geliştirici', 'İstanbul'), summary: 'Şişli’de çalışan yazılım geliştirici; ığüşöç İĞÜŞÖÇ karakterleri denenir.', experience: [role(0, () => 'Çok yoğun bir dönemde, müşteri şikâyetlerini çözen ve ürünün güvenilirliğini artıran servisleri geliştirdi.', 3, { company: 'Öztürk Yazılım (sentetik)', period: 'Sep 2021 - Present' })], skills: [{ name: '', keywords: ['TypeScript', 'Docker'], proficiency: '', level: 0 }] }),
  'resume-unbroken': doc({ language: 'en', basics: base('Averyveryveryverylongsurname-Averyveryveryverylongsurname (synthetic)', 'Headline ' + unbroken, 'Baku', `${'a'.repeat(60)}@${'b'.repeat(40)}.example.com`), summary: `See https://example.com/${'p'.repeat(90)} for details.`, experience: [{ company: `Company${unbroken}`, position: `Position${unbroken}`, location: 'Baku', period: '2021 - Present', highlights: [`Built ${unbroken} service.`, `Wrote ${'verylongcompoundwordwithoutspaces'.repeat(4)} tests.`] }], skills: [{ name: '', keywords: [unbroken, 'PostgreSQL'], proficiency: '', level: 0 }], projects: [{ entryId: 'p', name: `Project${unbroken}`, period: '2022', description: unbroken }] }),
  'resume-markup-like': doc({ language: 'en', basics: base('Test #set text(red) *bold* _under_ $x$', 'Head = ln // c /* x */'), summary: '#panic("x") #import "x" = Heading\n- list\n+ num ``raw`` @ref <label> \\ ~ ^ & % { } [ ] | " \' ` 😀', experience: [{ company: 'A & B (C) {D} [E]', position: '#if true [x]', location: '', period: '2021 - Present', highlights: ['100% of "quoted" text with \\backslash and #hash and $dollar$.', 'Line one\nLine two after a newline.'] }], skills: [{ name: '', keywords: ['C#', 'C++', '.NET', 'F#', '1C'], proficiency: '', level: 0 }] }),
  'letter-az-long': letter('az', 'Nigar Əliyeva (sintetik)', [long(sentence, 9), long(sentence, 9), long(sentence, 9), long(sentence, 9), long(sentence, 9)]),
  'letter-az-sparse': letter('az', 'Nigar Əliyeva (sintetik)', ['Qısa birinci abzas.', 'Qısa ikinci abzas.'], { company: '', position: '', location: '' }),
  'letter-ru': letter('ru', 'Анна Петрова (синтетическая)', ['Я работаю старшим оператором контакт-центра и обучаю новых сотрудников.', 'Эта вакансия соответствует моему опыту работы с клиентами.']),
  'letter-tr': letter('tr', 'İsmail Çağlar Öztürk (sentetik)', ['Yazılım geliştirici olarak müşteri şikâyetlerini çözen servisler geliştirdim.', 'Bu ilan deneyimime uygun.'], { company: 'Örnek Teknoloji İ.Ş. (sentetik)', position: 'Backend Geliştirici', location: 'İstanbul' }),
  'letter-unbroken': letter('en', 'Daniel Whitfield (synthetic)', [`See https://example.com/${'p'.repeat(120)} and ${unbroken}.`, 'Second paragraph.']),
};

if (require.main === module) {
  const out = process.argv[2] || join(homedir(), 'aise-preview', 'pdf-samples');
  mkdirSync(out, { recursive: true });
  const manifest: any[] = [];
  for (const [name, content] of Object.entries(SAMPLES)) {
    try {
      const pdf = svc.compileDocumentPdf(content);
      writeFileSync(join(out, `${name}.pdf`), pdf);
      manifest.push({ name, bytes: pdf.length, pages: svc.pageCount(pdf) });
    } catch (e) {
      manifest.push({ name, error: (e as Error).message });
    }
  }
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest));
}

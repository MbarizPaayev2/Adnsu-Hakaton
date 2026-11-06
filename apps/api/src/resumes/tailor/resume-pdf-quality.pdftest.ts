import { writeFileSync } from 'node:fs';
import { ResumeTailorService, localizePeriod } from './resume-tailor.service';
import { extractPdfText } from '../cv-extract';
import type { TailoredContent } from './resume-tailor.types';

// Renders real PDFs with the shipped Harvard-style Typst template (no mock compiler) and checks what a reader or a text extractor gets back:
// Azerbaijani characters, section order, consistent dates, long content and page breaks. Synthetic content only.
const svc = () => new ResumeTailorService({ get: () => undefined } as any);

const bullet = (i: number, j: number) => `NestJS və PostgreSQL ilə ${i}.${j} nömrəli xidməti təkmilləşdirdi: sorğu müddətini ölçdü, məlumat bazası indekslərini yenidən qurdu və nəticələri komandaya təqdim etdi (şəxsi məsuliyyət: ğüş çöı).`;
function content(experienceCount: number, bullets: number): TailoredContent {
  return {
    language: 'az',
    basics: { name: 'Əlizadə Nərmin İsmayıl qızı', headline: 'Backend mühəndisi', email: 'nermin.synthetic@example.com', phone: '+994 50 000 00 00', location: 'Gəncə', website: { url: '', label: '' } },
    summary: 'Backend mühəndisi: REST API, məlumat bazası və sistem etibarlılığı sahəsində təcrübə. Yalnız profildəki faktlar.',
    education: [{ school: 'Azərbaycan Texniki Universiteti', degree: 'Bakalavr', area: 'Kompüter mühəndisliyi', location: 'Bakı', period: 'Sep 2012 - Jun 2016', grade: '' }],
    experience: Array.from({ length: experienceCount }, (_, i) => ({
      company: `Şirkət ${i + 1} MMC`, position: i % 2 ? 'Baş mühəndis' : 'Backend Engineer', location: 'Bakı',
      period: i === 0 ? 'Sep 2022 - Present' : `Jan ${2021 - i} - Aug ${2022 - i}`,
      highlights: Array.from({ length: bullets }, (_, j) => bullet(i + 1, j + 1)),
    })),
    skills: [{ name: 'Texnologiyalar', keywords: ['NestJS', 'PostgreSQL', 'Docker', 'TypeScript'], proficiency: '', level: 0 }],
    languages: [{ language: 'Azərbaycan dili', fluency: 'ana dili', level: 5 }, { language: 'İngilis dili', fluency: 'orta', level: 3 }],
    projects: [],
    certifications: [{ title: 'AWS Cloud Practitioner', issuer: 'Amazon', date: '2023' }],
  };
}

async function pages(pdf: Buffer): Promise<number> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useWorkerFetch: false, isEvalSupported: false, useSystemFonts: false }).promise;
  return doc.numPages;
}

describe('Harvard-style CV PDF (real Typst render)', () => {
  jest.setTimeout(60_000);

  it('renders Azerbaijani characters, header first, Education before Experience, and extracts as readable text', async () => {
    const pdf = svc().compilePdfBytes(content(2, 2));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const text = (await extractPdfText(pdf)).replace(/\s+/g, ' ');
    for (const s of ['Əlizadə Nərmin İsmayıl qızı', 'Backend mühəndisi', 'Gəncə', 'nermin.synthetic@example.com', 'Azərbaycan Texniki Universiteti', 'şəxsi məsuliyyət: ğüş çöı', 'İngilis dili']) expect(text).toContain(s);
    const edu = text.indexOf('Azərbaycan Texniki Universiteti');
    const exp = text.indexOf('Şirkət 1 MMC');
    expect(text.indexOf('Əlizadə')).toBeLessThan(edu);
    expect(edu).toBeGreaterThan(-1);
    expect(edu).toBeLessThan(exp); // Harvard convention: Education before Experience
    expect(await pages(pdf)).toBe(1);
  });

  it('renders periods consistently in the CV language (month and year, en dash), never mixing English months into an Azerbaijani CV', async () => {
    const pdf = svc().compilePdfBytes(content(2, 1));
    const text = (await extractPdfText(pdf)).replace(/\s+/g, ' ');
    expect(localizePeriod('Sep 2022 - Present', 'az')).toMatch(/2022 – hazırda$/);
    expect(text).toContain('hazırda');
    expect(text).not.toMatch(/\b(Present|Sep|Jan|Aug|Jun)\b/);
    for (const m of text.matchAll(/(\d{4}) [–-] (\d{4}|hazırda)/g)) expect(Number(m[1])).toBeGreaterThan(1990);
  });

  it('keeps every bullet when long content breaks across pages, and never silently truncates', async () => {
    const c = content(9, 5);
    const pdf = svc().compilePdfBytes(c);
    const n = await pages(pdf);
    expect(n).toBeGreaterThanOrEqual(2);
    const text = (await extractPdfText(pdf)).replace(/\s+/g, ' ');
    for (const e of c.experience) {
      expect(text).toContain(e.company);
      for (const h of e.highlights) expect(text).toContain(h.slice(0, 60));
    }
    expect(text).toContain('AWS Cloud Practitioner'); // the last section survives the break
  });

  it('is a single column of real text: no extraction produces garbled order for the header block', async () => {
    const text = (await extractPdfText(svc().compilePdfBytes(content(1, 1)))).split('\n').map((l) => l.trim()).filter(Boolean);
    expect(text[0]).toContain('Əlizadə');
    expect(text.slice(0, 4).join(' ')).toContain('Backend mühəndisi');
  });

  it('keeps common ligature-prone words intact in the PDF text layer', async () => {
    const cv = content(1, 1);
    cv.basics.email = 'office@synthetic.example';
    cv.summary = 'MS Office certification supports efficient financial workflow documentation.';
    const cvText = (await extractPdfText(svc().compilePdfBytes(cv))).replace(/\s+/g, ' ');
    expect(cvText).toContain('MS Office certification');
    expect(cvText).toContain('office@synthetic.example');

    const letter = svc().compileLetterPdfBytes({
      kind: 'LETTER', language: 'en',
      basics: { name: 'Synthetic Candidate', email: 'office@synthetic.example', phone: '', location: 'Baku' },
      recipient: { company: 'Synthetic Ltd', position: 'Analyst', location: 'Baku' },
      date: '2026-10-27', salutation: 'Dear Hiring Team,',
      paragraphs: [{ id: 'p1', text: 'My office workflow improves efficiency and certification reporting.' }],
      closing: 'Sincerely,', signature: 'Synthetic Candidate',
    });
    const letterText = (await extractPdfText(letter)).replace(/\s+/g, ' ');
    expect(letterText).toContain('office@synthetic.example');
    expect(letterText).toContain('office workflow improves efficiency and certification reporting');
  });

  it('renders multi-section CV with projects, activities, awards and unchanged candidate names', async () => {
    const multi = {
      ...content(1, 1),
      basics: {
        ...content(1, 1).basics,
        name: 'Fızulı Hasanov',
      },
      projects: [{ name: 'Bank Prosesləri Portalı', organization: 'ABB Hackathon', period: '2023', description: 'Kredit müraciəti prosesinin avtomatlaşdırılması layihəsi.' }],
      activities: [{ kind: 'volunteering', title: 'İcma Fəalı', role: 'Könüllü', organization: 'Azərbaycan İnkişaf Fondu', period: '2022', description: 'Gənclər üçün rəqəmsal bacarıqlar təliminin təşkili.' }],
      awards: [{ title: 'Fəal Töhfəçi Sertifikatı', issuer: 'ABB', date: '2023' }],
    };
    const pdf = svc().compilePdfBytes(multi);
    const text = (await extractPdfText(pdf)).replace(/\s+/g, ' ');
    expect(text).toContain('Fızulı Hasanov');
    expect(text).not.toContain('Fizuli Hasanov');
    expect(text).toContain('LAYİHƏLƏR');
    expect(text).toContain('Bank Prosesləri Portalı');
    expect(text).toContain('KÖNÜLLÜLÜK VƏ FƏALİYYƏTLƏR');
    expect(text).toContain('Azərbaycan İnkişaf Fondu');
    expect(text).toContain('TƏLTİFLƏR');
    expect(text).toContain('Fəal Töhfəçi');
  });

  it('renders letter with unchanged candidate name, clean employer name and clean role', async () => {
    const letter = svc().compileLetterPdfBytes({
      kind: 'LETTER',
      language: 'az',
      basics: { name: 'Fızulı Hasanov', email: 'f@example.com', phone: '', location: 'Bakı' },
      recipient: {
        company: 'Əla töhfəçi, Elevvo Pathways təşkilatında',
        position: 'Hiper avtomatlaşdırma üzrə ekspert mərkəzinə proseslərin avtomatlaşdırılması üzrə analitik',
        location: 'Bakı',
      },
      date: '2026-10-20',
      salutation: 'Hörmətli işə qəbul komandası,',
      paragraphs: [{ id: 'p1', text: 'Vakansiya üzrə marağımı bildirirəm.' }],
      closing: 'Hörmətlə,',
      signature: 'Fızulı Hasanov',
    });
    const text = (await extractPdfText(letter)).replace(/\s+/g, ' ');
    expect(text).toContain('Fızulı Hasanov');
    expect(text).not.toContain('Fizuli Hasanov');
    expect(text).toContain('Elevvo Pathways');
    expect(text).not.toContain('Əla töhfəçi');
    expect(text).toContain('Proseslərin avtomatlaşdırılması üzrə analitik');
    expect(text).not.toContain('Hiper avtomatlaşdırma üzrə ekspert mərkəzinə');
    expect(await pages(letter)).toBe(1);
  });

  if (process.env.WRITE_CV_SAMPLES) {
    it('writes the synthetic samples used as evidence', () => {
      writeFileSync(process.env.WRITE_CV_SAMPLES + '/cv-harvard-sample-az-1page.pdf', svc().compilePdfBytes(content(2, 2)));
      writeFileSync(process.env.WRITE_CV_SAMPLES + '/cv-harvard-sample-az-long.pdf', svc().compilePdfBytes(content(9, 5)));
    });
  }
});

// ── stress shapes: sparse, long unbroken tokens, markup-like text, other scripts (synthetic) ────────────────────────────────────────────────────
async function textBounds(pdf: Buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useWorkerFetch: false, isEvalSupported: false, useSystemFonts: false }).promise;
  let maxRight = 0;
  let minLeft = Infinity;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    for (const item of (await page.getTextContent()).items as { str?: string; transform?: number[]; width?: number }[]) {
      if (!item.str?.trim() || !item.transform) continue;
      minLeft = Math.min(minLeft, item.transform[4]);
      maxRight = Math.max(maxRight, item.transform[4] + (item.width ?? 0));
    }
  }
  return { minLeft, maxRight };
}
const A4_WIDTH = 595.3;
const MARGIN = (20 / 25.4) * 72; // 20 mm

describe('PDF rendering of awkward content (real Typst render)', () => {
  jest.setTimeout(60_000);
  const unbroken = 'U'.repeat(95);
  const stress = (over: Partial<TailoredContent>): TailoredContent => ({
    language: 'en',
    basics: { name: 'Daniel Whitfield (synthetic)', headline: 'Data Analyst', email: 'daniel.synthetic@example.com', phone: '', location: 'Baku', website: { url: '', label: '' } },
    summary: '', education: [], experience: [], skills: [], languages: [], projects: [], certifications: [], ...over,
  });

  it('keeps every line inside the page margins when a single token is far too long to wrap', async () => {
    const pdf = svc().compilePdfBytes(stress({
      summary: `See https://example.com/${'p'.repeat(90)} for details.`,
      experience: [{ company: `Company${unbroken}`, position: `Position${unbroken}`, location: 'Baku', period: '2021 - Present', highlights: [`Built ${unbroken} service.`, `Wrote ${'verylongcompoundwordwithoutspaces'.repeat(4)} tests.`] }],
      skills: [{ name: '', keywords: [unbroken, 'PostgreSQL'], proficiency: '', level: 0 }],
    }));
    const { minLeft, maxRight } = await textBounds(pdf);
    expect(minLeft).toBeGreaterThanOrEqual(MARGIN - 2);
    expect(maxRight).toBeLessThanOrEqual(A4_WIDTH - MARGIN + 2);
  });

  it('does not print a section heading with nothing under it (empty skills group, empty bullets)', async () => {
    const pdf = svc().compilePdfBytes(stress({ skills: [{ name: '', keywords: [], proficiency: '', level: 0 }], experience: [{ company: 'Caspian Analytics', position: 'Data Analyst', location: '', period: '2021 - Present', highlights: [] }] }));
    const text = (await extractPdfText(pdf)).replace(/\s+/g, ' ');
    expect(text).toContain('Caspian Analytics');
    expect(text).not.toMatch(/SKILLS/i);
  });

  it('renders markup-looking text literally and never executes it', async () => {
    const pdf = svc().compilePdfBytes(stress({ summary: '#panic("x") *bold* _u_ $x$ = Heading <label> @ref', experience: [{ company: 'A & B {C} [D]', position: '#if true [x]', location: '', period: '2021 - Present', highlights: ['100% of "quoted" #hash $dollar$ \\backslash'] }] }));
    const text = (await extractPdfText(pdf)).replace(/\s+/g, ' ');
    for (const s of ['#panic("x") *bold* _u_ $x$', 'A & B {C} [D]', '#if true [x]', '100% of "quoted" #hash $dollar$']) expect(text).toContain(s);
  });

  it('sets Cyrillic, Turkish and Azerbaijani text with correct headings in one page each', async () => {
    const ru = await extractPdfText(svc().compilePdfBytes(stress({ language: 'ru', basics: { ...stress({}).basics, name: 'Анна Петрова (синтетическая)' }, experience: [{ company: 'Бакинский контакт-центр', position: 'Старший оператор', location: 'Баку', period: 'Sep 2020 - Present', highlights: ['Обрабатывала до 60 обращений в день.'] }] })));
    expect(ru.replace(/\s+/g, ' ')).toContain('Обрабатывала до 60 обращений в день.');
    expect(ru).toContain('ОПЫТ РАБОТЫ');
    const tr = await extractPdfText(svc().compilePdfBytes(stress({ language: 'tr', basics: { ...stress({}).basics, name: 'İsmail Çağlar Öztürk (sentetik)' }, experience: [{ company: 'Öztürk Yazılım', position: 'Geliştirici', location: '', period: 'Sep 2021 - Present', highlights: ['Müşteri şikâyetlerini çözen servisler geliştirdi.'] }] })));
    expect(tr).toContain('İŞ DENEYİMİ');
    expect(tr.replace(/\s+/g, ' ')).toContain('Müşteri şikâyetlerini çözen servisler geliştirdi.');
  });

  it('lays out a letter with no recipient, very long paragraphs, and a long unbroken token', async () => {
    const letter = (paragraphs: string[], recipient = { company: '', position: '', location: '' }) => svc().compileLetterPdfBytes({
      kind: 'LETTER', language: 'az', basics: { name: 'Nigar Əliyeva (sintetik)', email: 'n@example.com', phone: '', location: 'Bakı' }, recipient, date: '2026-10-04',
      salutation: 'Hörmətli işə qəbul komandası,', paragraphs: paragraphs.map((text, i) => ({ id: `p${i + 1}`, text })), closing: 'Hörmətlə,', signature: 'Nigar Əliyeva (sintetik)',
    });
    const sparse = letter(['Qısa birinci abzas.', 'Qısa ikinci abzas.']);
    expect(await pages(sparse)).toBe(1);
    const long = letter(Array.from({ length: 5 }, () => 'Sorğu müddətini ölçdü və indeksləri yenilədi. '.repeat(30)));
    const text = (await extractPdfText(long)).replace(/\s+/g, ' ');
    expect(await pages(long)).toBeGreaterThanOrEqual(2);
    expect(text).toContain('Hörmətlə,'); // closing and signature are not lost at the page break
    expect(text).toContain('Nigar Əliyeva (sintetik)');
    const wide = await textBounds(letter([`See https://example.com/${'p'.repeat(150)}.`, 'İkinci abzas.']));
    expect(wide.maxRight).toBeLessThanOrEqual(A4_WIDTH - 20 + 2);
  });
});

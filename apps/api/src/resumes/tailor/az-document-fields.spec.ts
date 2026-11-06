import { documentFields, nameLike, needsTranslation } from './az-document-fields';
import { untranslatedItems } from './az-translate';

describe('needsTranslation for labels', () => {
  it('accepts Azerbaijani titles written without special letters (evaluation 16 Oct: "Restoran administratoru" failed a whole letter)', () => {
    for (const t of ['Restoran administratoru', 'Anbar operatoru', 'Satış meneceri', 'Sistem inzibatçısı']) expect(needsTranslation(t, 'label')).toBe(false);
  });
  it('still sends English titles for translation', () => {
    for (const t of ['Sales Manager', 'Data Analyst', 'Restaurant Manager', 'Warehouse Supervisor']) expect(needsTranslation(t, 'label')).toBe(true);
  });
  it('keeps tools written with an acronym as they are, but not English job titles that contain one', () => {
    for (const t of ['REST API', 'SQL Server', 'AWS Lambda', 'Power BI']) expect(needsTranslation(t, 'label')).toBe(false);
    for (const t of ['Senior QA Engineer', 'IT Project Management']) expect(needsTranslation(t, 'label')).toBe(true);
  });
  it('translates known labels with acronyms but leaves likely organization names alone', () => {
    expect(needsTranslation('KPI design', 'label')).toBe(true);
    expect(needsTranslation('Generative AI tools', 'label')).toBe(true);
    expect(nameLike('FinVeda')).toBe(true);
    expect(nameLike('Carbon-Capture Concrete Additive')).toBe(false);
    expect(nameLike('AI-Enabled Financial Wellness Venture')).toBe(false);
  });
});

describe('documentFields inventory', () => {
  const cv = () => ({
    language: 'az',
    basics: { name: 'N', headline: '', email: '', phone: '', location: '', website: { url: '', label: '' } },
    summary: '',
    experience: [{ company: 'LedgerLens | AI-OCR Product for Azerbaijani SME Ledgers', position: 'Founder', location: '', period: '2025 - Present', highlights: [] }],
    education: [], skills: [], languages: [], certifications: [],
    projects: [{ entryId: 'p', name: 'Codveda Technologies', period: '', description: '' }],
    awards: [{ entryId: 'a', title: 'Winner, Startup Pitch Competition', issuer: 'ADA University', date: '' }, { entryId: 'b', title: 'Erasmus+ Scholarship', issuer: '', date: '' }],
  });

  it('lists English award titles and the description after a name, but never the name itself', () => {
    const fields = documentFields(cv() as any);
    expect(fields.map((f) => [f.id, f.text])).toEqual(expect.arrayContaining([
      ['awards.0.title', 'Winner, Startup Pitch Competition'],
      ['experience.0.company', 'AI-OCR Product for Azerbaijani SME Ledgers'],
    ]));
    expect(fields.some((f) => f.id === 'projects.0.name')).toBe(false); // a plain name has no description to translate
    expect(untranslatedItems(cv() as any).map((f) => f.path)).not.toContain('awards.1.title'); // a named award stays as written
  });

  it('writes a translated description back after the unchanged name', () => {
    const content = cv() as any;
    documentFields(content).find((f) => f.id === 'experience.0.company')!.set('Azərbaycandakı SME-lərin uçot kitabları üçün AI-OCR məhsulu');
    expect(content.experience[0].company).toBe('LedgerLens | Azərbaycandakı SME-lərin uçot kitabları üçün AI-OCR məhsulu');
  });

  it('translates descriptor text on either side of a name while preserving the name exactly', () => {
    const content = {
      ...cv(),
      experience: [
        { company: 'Carboryn | Carbon-Capture Concrete Additive', position: '', location: '', period: '', highlights: [] },
        { company: 'Outstanding Contributor | Elevvo Pathways', position: '', location: '', period: '', highlights: [] },
      ],
    } as any;
    const fields = documentFields(content);
    expect(fields.map((field) => field.text)).toEqual(expect.arrayContaining(['Carbon-Capture Concrete Additive', 'Outstanding Contributor']));
    fields.find((field) => field.text === 'Carbon-Capture Concrete Additive')!.set('Karbon tutan beton əlavəsi');
    fields.find((field) => field.text === 'Outstanding Contributor')!.set('Fərqlənən iştirakçı');
    expect(content.experience.map((e: any) => e.company)).toEqual([
      'Carboryn | Karbon tutan beton əlavəsi',
      'Fərqlənən iştirakçı | Elevvo Pathways',
    ]);
    expect(untranslatedItems(content).map((field) => field.text)).not.toEqual(expect.arrayContaining(['Carboryn', 'Elevvo Pathways']));
  });

  it('inventories activities titles, roles, descriptions, and results', () => {
    const content = {
      ...cv(),
      activities: [{ entryId: 'act1', title: 'Youth Leadership Program', role: 'Team Lead', description: 'Coordinated student workshops', result: 'Reached 150 participants' }],
    };
    const fields = documentFields(content as any);
    expect(fields.map((f) => [f.id, f.text])).toEqual(expect.arrayContaining([
      ['activities.0.title', 'Youth Leadership Program'],
      ['activities.0.role', 'Team Lead'],
      ['activities.0.description', 'Coordinated student workshops'],
      ['activities.0.result', 'Reached 150 participants'],
    ]));
  });

  it('does not block Azerbaijani approval on an English vacancy title in a letter header', () => {
    const letter = {
      kind: 'LETTER', language: 'az',
      basics: { name: 'N', email: '', phone: '', location: 'Bakı' },
      recipient: { company: 'Example MMC', position: 'Junior Financial Analyst', location: 'Baku' },
      date: '2026-10-27', salutation: 'Hörmətli seçim komandası,', paragraphs: [{ id: 'p1', text: 'Müraciət edirəm.' }], closing: 'Hörmətlə,', signature: 'N',
    } as any;
    expect(documentFields(letter).some((field) => field.id === 'recipient.position')).toBe(false);
  });
});


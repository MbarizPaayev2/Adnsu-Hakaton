import { translateEmbeddedRoleLabels } from './az-document-fields';
import { looksEnglish, translateItems, translationProblems, untranslatedItems, wordingProblems } from './az-translate';
import type { ModelCall, WriterConfig } from './az-writer';
import type { TailoredContent } from './resume-tailor.types';

const EN = 'Designed an ISAE 3000 (Revised) limited-assurance methodology for five telecom KPIs, including a 20-document request list.';
const AZ = 'Beş telekom KPI üçün 20 sənədlik sorğu siyahısı daxil olmaqla ISAE 3000 (Revised) məhdud əminlik metodologiyası hazırladım.';

describe('looksEnglish', () => {
  it('recognises English prose and leaves Azerbaijani, names and tool lists alone', () => {
    expect(looksEnglish(EN)).toBe(true);
    expect(looksEnglish(AZ)).toBe(false);
    expect(looksEnglish('Power BI, SQL, Python')).toBe(false);
    expect(looksEnglish('Bakı')).toBe(false);
  });
});

describe('translationProblems', () => {
  it('accepts a faithful translation', () => {
    expect(translationProblems(EN, AZ, { kind: 'bullet', current: true })).toEqual([]);
  });
  it('rejects invented or dropped numbers and dropped names', () => {
    const codes = (out: string) => translationProblems(EN, out, { kind: 'bullet' }).map((p) => p.code);
    expect(codes(AZ.replace('20', '25'))).toEqual(expect.arrayContaining(['invented_number', 'dropped_number']));
    expect(codes(AZ.replace('ISAE 3000 (Revised) ', ''))).toEqual(expect.arrayContaining(['dropped_number']));
    expect(codes('Beş telekom göstəricisi üçün 20 sənədlik siyahı ilə ISAE 3000 metodologiyası hazırladım.')).toEqual(expect.arrayContaining(['dropped_name']));
  });
  it('rejects text that is still English, in the third person, or ends on a connective', () => {
    expect(translationProblems(EN, EN, { kind: 'bullet' }).map((p) => p.code)).toContain('still_english');
    expect(translationProblems(EN, AZ.replace('hazırladım', 'hazırladı'), { kind: 'bullet' }).map((p) => p.code)).toContain('voice');
    expect(translationProblems(EN, `${AZ.replace(/\.$/, '')} və`, { kind: 'bullet' }).map((p) => p.code)).toContain('incomplete');
  });
  it('rejects a bullet sign and a runaway length', () => {
    expect(translationProblems(EN, `– ${AZ}`, { kind: 'bullet' }).map((p) => p.code)).toContain('format');
    expect(translationProblems(EN, `${AZ} ${AZ} ${AZ}`, { kind: 'bullet' }).map((p) => p.code)).toEqual(expect.arrayContaining(['too_long']));
  });
});

describe('Turkish forms and mixed tenses in a translation', () => {
  const SRC = 'Analyzed 2,666 telecom customers and identified international-plan users as a 3.8x higher-risk churn segment.';
  it('refuses a Turkish plural ending and a bullet that mixes two tenses', () => {
    const turkishPlural = '2.666 telekom müştərisini təhlil etdim və beynəlxalq plan istifadəçilerini 3.8x yüksək riskli churn seqmenti kimi müəyyən etdim.';
    expect(translationProblems(SRC, turkishPlural, { kind: 'bullet', current: false }).map((p) => p.code)).toContain('turkish_word');
    const mixed = '2.666 telekom müştərisini təhlil etmişəm və beynəlxalq plan istifadəçilərini 3.8x yüksək riskli churn seqmenti kimi müəyyən etdim.';
    expect(translationProblems(SRC, mixed, { kind: 'bullet', current: false }).map((p) => p.code)).toContain('tense_mixed');
    const clean = '2.666 telekom müştərisini təhlil etdim və beynəlxalq plan istifadəçilərini 3.8x yüksək riskli churn seqmenti kimi müəyyən etdim.';
    expect(translationProblems(SRC, clean, { kind: 'bullet', current: false })).toEqual([]);
  });
});

describe('translateItems with suspect words', () => {
  const cfg: WriterConfig = { models: ['m1', 'm2'], judgeModel: 'j', timeoutMs: 10_000, deadlineMs: 60_000 };
  it('keeps a translation whose words are not ordinary Azerbaijani, names those words, and asks the model only once', async () => {
    const answer = 'Beş telekom KPI üçün 20 sənədlik sorğu siyahısı daxil olmaqla ISAE 3000 (Revised) məhdud əminlik lojiçasını hazırladım.';
    let calls = 0;
    const call: ModelCall = async (_m, messages) => {
      calls++;
      const id = (JSON.parse(messages[1].content).items as { id: string }[])[0].id;
      return { text: JSON.stringify({ items: [{ id, text: answer }] }), model: 'm1', promptTokens: 1, completionTokens: 1 };
    };
    const r = await translateItems(call, cfg, [{ id: 'a', text: EN, kind: 'bullet', current: false }]);
    expect(r.failed).toEqual([]);
    expect(r.accepted[0].text).toBe(answer);
    expect(r.accepted[0].suspect).toEqual(expect.arrayContaining(['lojiçasını']));
    expect(calls).toBe(1);
  });
});

describe('translateItems', () => {
  const cfg: WriterConfig = { models: ['m1', 'm2'], judgeModel: 'j', timeoutMs: 10_000, deadlineMs: 60_000 };
  const answer = (items: { id: string; text: string }[]) => ({ text: JSON.stringify({ items }), model: 'm1', promptTokens: 1, completionTokens: 1 });

  it('accepts only items that pass and reports the rest as failed, never as translated', async () => {
    const call: ModelCall = async (_m, messages) => {
      const ids = (JSON.parse(messages[1].content).items as { id: string }[]).map((i) => i.id);
      return answer(ids.map((id) => ({ id, text: id === 'a' ? AZ : EN })));
    };
    const r = await translateItems(call, cfg, [{ id: 'a', text: EN, kind: 'bullet' }, { id: 'b', text: EN, kind: 'bullet' }]);
    expect(r.accepted.map((x) => x.id)).toEqual(['a']);
    expect(r.failed.map((x) => x.id)).toEqual(['b']);
    expect(r.failed[0].problems.map((p) => p.code)).toContain('still_english');
  });

  it('fails every item when the provider is unavailable', async () => {
    const r = await translateItems(async () => null, cfg, [{ id: 'a', text: EN, kind: 'bullet' }]);
    expect(r.accepted).toEqual([]);
    expect(r.failed.map((x) => x.id)).toEqual(['a']);
  });
});

describe('untranslatedItems', () => {
  it('lists the English prose of an Azerbaijani document, with where it is', () => {
    const content = {
      language: 'az', basics: { name: 'A', headline: 'Data Analyst | Product Builder', email: '', phone: '', location: '' }, summary: '',
      experience: [{ company: 'Acme', position: 'Analist', location: '', period: '', highlights: [EN, AZ] }], education: [], skills: [], languages: [], projects: [], certifications: [],
    } as unknown as TailoredContent;
    const found = untranslatedItems(content);
    expect(found.map((f) => f.path)).toEqual(['headline', 'experience.0.highlights.0']);
    expect(found[1].section).toBe('Analist, Acme');
  });
});


it('detects English embedded in an Azerbaijani letter, including the composed fallback', () => {
  const found = untranslatedItems({ kind: 'LETTER', language: 'az', paragraphs: [{ id: 'p1', text: 'Bu müddət ərzində leading product development for an AI-OCR workflow that digitizes handwritten financial records və preparing the project.' }] } as any);
  expect(found.map((p) => p.path)).toEqual(['paragraphs.0.text']);
});


it('asks for idiomatic Azerbaijani syntax without authorizing additional facts', async () => {
  const cfg: WriterConfig = { models: ['m'], judgeModel: 'j', timeoutMs: 10000, deadlineMs: 60000 };
  const call: ModelCall = async (_model, messages) => {
    expect(messages[0].content).toContain('normally ending with the main verb');
    expect(messages[0].content).toContain('never tədqiqat çatdırılması');
    expect(messages[0].content).toContain('do not authorize any new claim');
    return { text: JSON.stringify({ items: [{ id: 'a', text: AZ }] }), model: 'm', promptTokens: 1, completionTokens: 1 };
  };
  expect((await translateItems(call, cfg, [{ id: 'a', text: EN, kind: 'bullet' }])).accepted).toHaveLength(1);
});


it('does not convert a translated system action into a candidate action', async () => {
  const cfg: WriterConfig = { models: ['m'], judgeModel: 'j', timeoutMs: 10000, deadlineMs: 60000 };
  const candidate = 'Python iş axını hazırladım; həmin iş axını 6 məlumat sahəsini yoxlayır.';
  const call: ModelCall = async (_model, _messages, opts) => {
    expect(opts.maxTokens).toBeLessThan(4000);
    return { text: JSON.stringify({ items: [{ id: 'a', text: candidate }] }), model: 'm', promptTokens: 1, completionTokens: 1 };
  };
  const result = await translateItems(call, cfg, [{ id: 'a', text: 'Built a Python workflow that validates 6 data fields.', kind: 'bullet' }]);
  expect(result.accepted).toEqual([]);
  expect(result.failed[0].problems.some(p => p.code === 'voice')).toBe(true);
});

it('rejects yerel in Azerbaijani prose', () => {
  expect(translationProblems('I reviewed the local financial records.', 'Yerel maliyyə qeydlərini nəzərdən keçirdim.', { kind: 'bullet' }).map(p => p.code)).toContain('turkish_word');
});


describe('faithful translation of long multi-action CV bullets', () => {
  it('translates ordinary capitals and ordinals while preserving ABB and AI-OCR', () => {
    const src = "Leading product development for an AI-OCR workflow that digitizes handwritten Azerbaijani financial records; accepted into ABB's 6th Incubation Program.";
    const out = 'Azərbaycan dilində əl ilə yazılmış maliyyə qeydlərini rəqəmsallaşdıran AI-OCR iş axını üçün məhsulun hazırlanmasına rəhbərlik edirəm; ABB-nin 6-cı inkubasiya proqramına qəbul edilmişəm.';
    expect(translationProblems(src, out, { kind: 'bullet', current: true })).toEqual([]);
    expect(translationProblems(src, out.replace('ABB', 'NASA'), { kind: 'bullet', current: true }).map(p => p.code)).toContain('dropped_name');
  });
  it('recognizes amount + gəlir as a noun in a financial list', () => {
    expect(translationProblems('Created an RFM pipeline for 95K+ customers and a Power BI dashboard covering 13M revenue and 1.47M profit.', '95K+ müştəri üçün RFM iş axını yaratdım və 13M gəlir, 1.47M mənfəəti əhatə edən Power BI paneli hazırladım.', { kind: 'bullet' })).toEqual([]);
  });
  it('keeps a named model result as the model action', () => {
    expect(translationProblems('Completed an analysis with XGBoost achieving PR-AUC 0.87.', 'Təhlili tamamladım; XGBoost PR-AUC 0.87 nəticəsi əldə etdi.', { kind: 'bullet' })).toEqual([]);
  });
});


it('preserves an official programme name with its connector without permitting other English prose', () => {
  expect(translationProblems('Selected as 1 of 20 Youth in Development Fellow participants.', 'Youth in Development Fellow proqramının 20 iştirakçısından 1-i seçildim.', { kind: 'bullet' })).toEqual([]);
  expect(translationProblems('Selected as 1 of 20 Youth in Development Fellow participants.', 'Youth in Development Fellow proqramının 20 iştirakçısından 1-i seçildim and worked with the team.', { kind: 'bullet' }).map(p => p.code)).toContain('english_word');
  expect(translationProblems('Used Python for 20 reports.', 'Python ilə 20 hesabatı Étienne üçün hazırladım.', { kind: 'bullet' }).map(p => p.code)).toContain('new_name');
});


it('detects short English action bullets without treating tool lists as prose', () => {
  expect(looksEnglish('Created monthly reports')).toBe(true);
  expect(looksEnglish('Power BI, Python, SQL')).toBe(false);
  expect(translationProblems('Used Python for 20 reports.', 'Python və AWS ilə 20 hesabat hazırladım.', { kind: 'bullet' }).map(p => p.code)).toContain('new_name');
});


it('finds an English clause diluted by Azerbaijani framing, proper names and long numerical evidence', () => {
  const frame = '2026-cı ilin iyunundan Nümunə şirkətində işləyirəm. Bu müddət ərzində ';
  const english = 'leading product development for an AI-OCR workflow that digitizes handwritten financial records; accepted into ABB Incubation Program';
  expect(looksEnglish(frame + english + ' və istifadəçi problemini müəyyən etdim. '.repeat(20))).toBe(true);
  expect(looksEnglish('Biznes analitiki kimi müraciət edirəm. Power BI və Python ilə hesabatlar hazırladım.')).toBe(false);
});

it('does not classify unchanged official names with connectors as mixed English prose', () => {
  expect(looksEnglish('Youth in Development Fellow proqramında iştirak etdim və University of Cambridge ilə əməkdaşlıq etdim.')).toBe(false);
});

it('retains a connector within the full unchanged employer display name', () => {
  expect(translationProblems('I work at LedgerLens | AI-OCR Product for Azerbaijani SME Ledgers.', 'LedgerLens | AI-OCR Product for Azerbaijani SME Ledgers şirkətində işləyirəm.', { kind: 'project' })).toEqual([]);
});


describe('English titles retained inside translated prose', () => {
  it('translates roles in job contexts while preserving programme and product names', () => {
    expect(translateEmbeddedRoleLabels('Business Analyst vakansiyasına müraciət edirəm. Co-Founder & product lead vəzifəsində işləyirəm.'))
      .toBe('Biznes analitiki vakansiyasına müraciət edirəm. Həmtəsisçi və məhsul rəhbəri vəzifəsində işləyirəm.');
    expect(translateEmbeddedRoleLabels('Business Analyst Toolkit, Founder Institute və Python ilə işləyirəm.'))
      .toBe('Business Analyst Toolkit, Founder Institute və Python ilə işləyirəm.');
  });
  it('accepts a faithful model reply that retained the role without a second paid call', async () => {
    let calls = 0;
    const call: ModelCall = async () => {
      calls++;
      return { text: JSON.stringify({ items: [{ id: 'p', text: 'Acme-də Business Analyst vəzifəsində 2 hesabat hazırladım.' }] }), model: 'm', promptTokens: 1, completionTokens: 1 };
    };
    const result = await translateItems(call, { models: ['m'], judgeModel: 'm', timeoutMs: 10000, deadlineMs: 60000 }, [{ id: 'p', kind: 'project', text: 'As a Business Analyst at Acme I prepared 2 reports.' }]);
    expect(result.failed).toEqual([]);
    expect(result.accepted[0].text).toBe('Acme-də Biznes analitiki vəzifəsində 2 hesabat hazırladım.');
    expect(calls).toBe(1);
  });
});

it('recognises a translated generic founder title without allowing an invented organisation', () => {
  expect(translationProblems('I work as a Co- Founder at Acme.', 'Acme-də Həmtəsisçi vəzifəsində işləyirəm.', { kind: 'project' })).toEqual([]);
  expect(translationProblems('I work as a Co- Founder at Acme.', 'InventedXYZ-də Həmtəsisçi vəzifəsində işləyirəm.', { kind: 'project' }).map(p => p.code)).toContain('new_name');
});


describe('natural Azerbaijani selection numbers', () => {
  const source = 'Selected as 1 of 20 founders and awarded $400.';
  const correct = '20 nəfərdən biri kimi seçildim və $400 mükafat aldım.';
  it('recognises biri only for the matching source selection count', () => {
    expect(translationProblems(source, correct, { kind: 'bullet', current: false })).toEqual([]);
    expect(translationProblems(source, correct.replace('20 nəfərdən', '20‑dən'), { kind: 'bullet', current: false })).toEqual([]);
    expect(translationProblems(source, correct.replace('20', '25'), { kind: 'bullet', current: false }).map(p => p.code)).toEqual(expect.arrayContaining(['invented_number', 'dropped_number']));
    expect(translationProblems(source, correct.replace('$400 ', ''), { kind: 'bullet', current: false }).map(p => p.code)).toContain('dropped_number');
    expect(translationProblems('Worked for 1 year.', 'Bir il işlədim.', { kind: 'bullet', current: false }).map(p => p.code)).toContain('dropped_number');
  });
  it('provides enough output space for Azerbaijani and model reasoning without removing the hard cap', async () => {
    const call: ModelCall = async (_m, _messages, opts) => {
      // Room for Azerbaijani and low-effort reasoning, but not a reservation that alone fills a third of Groq's 8,000 tokens/minute.
      expect(opts.maxTokens).toBeGreaterThanOrEqual(1024);
      expect(opts.maxTokens).toBeLessThanOrEqual(2400);
      return { text: JSON.stringify({ items: [{ id: 'a', text: AZ }] }), model: 'm', promptTokens: 1, completionTokens: 1 };
    };
    await translateItems(call, { models: ['m'], judgeModel: 'm', timeoutMs: 10000, deadlineMs: 60000 }, [{ id: 'a', text: EN, kind: 'bullet' }]);
  });
});

describe('Title Case labels and English echoes (reported founder CV, 17 October 2026)', () => {
  it('accepts a faithful translation of a Title Case job title or skill', () => {
    expect(translationProblems('Machine Learning Intern', 'Maşın öyrənməsi üzrə təcrübəçi', { kind: 'label' })).toEqual([]);
    expect(translationProblems('Data Visualization', 'Məlumatların vizuallaşdırılması', { kind: 'label' })).toEqual([]);
    expect(translationProblems('Winner, Startup Pitch Competition', 'Qalib, startap təqdimatı müsabiqəsi', { kind: 'label' })).toEqual([]);
  });
  it('still rejects a translation that drops a tool, brand or acronym', () => {
    expect(translationProblems('Built monthly reports in Excel and SQL.', 'Aylıq hesabatlar hazırladım.', { kind: 'bullet', current: false }).map((p) => p.detail).join(' ')).toMatch(/excel[\s\S]*sql|sql[\s\S]*excel/);
    expect(translationProblems('Trained a churn model with XGBoost.', 'Müştəri itkisi modelini öyrətdim.', { kind: 'bullet', current: false }).map((p) => p.code)).toContain('dropped_name');
  });
  it('does not accept an English label returned unchanged as its translation', () => {
    expect(translationProblems('Stakeholder Communication', 'Stakeholder Communication', { kind: 'label' }).map((p) => p.code)).toContain('still_english');
    expect(translationProblems('Stakeholder Communication', 'Maraqlı tərəflərlə ünsiyyət', { kind: 'label' })).toEqual([]);
  });
});

describe('known Azerbaijani wording traps from document review', () => {
  it('accepts natural case endings and flags a hyphenated Azerbaijani case ending', () => {
    expect(wordingProblems("Mapped Azerbaijan's market.", 'Azərbaycanın bazarını təhlil etdim.')).toEqual([]);
    expect(wordingProblems("Mapped Azerbaijan's market.", 'Azərbaycan-ın bazarını təhlil etdim.').map((p) => p.code)).toContain('suffix_hyphen');
    expect(wordingProblems('Joined the ABB programme.', 'ABB-nin proqramına qoşuldum.')).toEqual([]);
  });
  it('flags specific calques and distinguishes percentage points from percent', () => {
    expect(wordingProblems('Designed escalation logic.', 'Eskalasiya lojiğini hazırladım.').map((p) => p.code)).toContain('calque');
    expect(wordingProblems('Found a 32+ pp gap.', '32+% dəqiqlik fərqi aşkar etdim.').map((p) => p.code)).toContain('percentage_points');
    expect(wordingProblems('Found a 32+ pp gap.', '32 faiz bəndi fərq aşkar etdim.')).toEqual([]);
  });
});

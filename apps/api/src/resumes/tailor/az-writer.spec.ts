import { dropExperienceClaims, dropRepeatedSentences, plainHyphens, letterEvidence, periodForWriter, polishBullets, writeLetter, type KindedEvidence, type ModelCall, type WriterConfig } from './az-writer';
import type { Persona, TailorJobInput } from './resume-tailor.types';

const job: TailorJobInput = { id: 'j1', position: 'Backend Developer (Java)', company: 'Bank Respublika ASC', location: 'Bakı', education: '', experience: '', salary_from: '', salary_to: '', category: '', description: 'Java ilə REST xidmətləri', requirements: 'Hibernate/JPA ilə işləmə, verilənlər bazası performansının optimallaşdırılması üzrə təcrübə', responsibilities: '' };
const evidence: KindedEvidence[] = [
  { id: 'E1', kind: 'project', role: 'Hakaton layihəsi', period: '2024', text: 'Komandada 4 nəfər idik, mən verilənlər bazası hissəsini və REST API-ni Java-da yazdım.' },
  { id: 'E2', kind: 'activity', role: 'Tələbə klubu', period: '2023', text: 'Həftəlik məşğələlər təşkil etdim və yeni üzvlərə SQL öyrətdim.' },
];
const motivation = 'Bankın real məlumat bazaları üzərində işləyib bacarıqlarımı inkişaf etdirmək istəyirəm.';
const input = { position: job.position, company: job.company, requirementLines: [job.requirements], evidence, motivation };
const cfg = (over: Partial<WriterConfig> = {}): WriterConfig => ({ models: ['a/writer-one', 'b/writer-two'], judgeModel: 'c/judge', timeoutMs: 10_000, deadlineMs: 60_000, ...over });

const goodLetter = { paragraphs: [
  { text: 'Bank Respublika ASC-nin Backend Developer (Java) vakansiyasına müraciət edirəm. Bankın real məlumat bazaları üzərində işləyib bacarıqlarımı inkişaf etdirmək istəyirəm.', uses: ['motivation'] },
  { text: 'Hakaton layihəsində dörd nəfərlik komandada verilənlər bazası hissəsini və REST API-ni Java-da yazdım. Tələbə klubunda isə həftəlik məşğələlər keçirib yeni üzvlərə SQL öyrətdim.', uses: ['E1', 'E2'] },
] };
const ok = (text: string, model = 'm') => ({ text, model, promptTokens: 10, completionTokens: 10 });
const faithful = JSON.stringify({ unsupported: [], missing_answers: [], verdict: 'faithful' });

/** A scripted model: replies are consumed per model name, in order. */
const scripted = (script: Record<string, (string | null)[]>) => {
  const calls: { model: string; messages: { role: string; content: string }[] }[] = [];
  const call: ModelCall = async (model, messages) => {
    calls.push({ model, messages });
    const queue = script[model] ?? [];
    const next = queue.shift();
    return next == null ? null : ok(next, model);
  };
  return { call, calls };
};

describe('writeLetter', () => {
  it('accepts a letter that passes the gates and the fact-checker', async () => {
    const s = scripted({ 'a/writer-one': [JSON.stringify(goodLetter)], 'c/judge': [faithful] });
    const r = await writeLetter(s.call, cfg(), input);
    expect(r.letter?.paragraphs).toHaveLength(2);
    expect(r.trace.outcomes).toEqual(['judge:faithful', 'writer-one:accepted']);
    expect(r.trace.model).toBe('a/writer-one');
    expect(s.calls.map((c) => c.model)).toEqual(['a/writer-one', 'c/judge']);
  });

  it('accepts a factual, impersonal role-connection sentence without a false first-person rejection', async () => {
    const draft = { paragraphs: [goodLetter.paragraphs[0], {
      text: `${goodLetter.paragraphs[1].text} Bu təcrübə verilənlər bazası işi üçün zəmin yaradır.`,
      uses: ['E1', 'E2'],
    }] };
    const s = scripted({ 'a/writer-one': [JSON.stringify(draft)], 'c/judge': [faithful] });
    const r = await writeLetter(s.call, cfg({ models: ['a/writer-one'] }), input);
    expect(r.letter).not.toBeNull();
    expect(r.trace.outcomes).toContain('writer-one:accepted');
    expect(s.calls.map((c) => c.model)).toEqual(['a/writer-one', 'c/judge']);
  });

  it('repairs the vowel after an abbreviation instead of discarding the draft, and says so in the trace', async () => {
    const withEnding = { paragraphs: [
      { text: goodLetter.paragraphs[0].text, uses: goodLetter.paragraphs[0].uses },
      { text: goodLetter.paragraphs[1].text.replace('Hakaton layihəsində', 'Hakaton layihəsində ASC-da'), uses: goodLetter.paragraphs[1].uses },
    ] };
    const s = scripted({ 'a/writer-one': [JSON.stringify(withEnding)], 'c/judge': [faithful] });
    const r = await writeLetter(s.call, cfg(), input);
    expect(r.letter?.paragraphs[1].text).toContain('ASC-də');
    expect(r.letter?.paragraphs[1].text).not.toContain('ASC-da');
    expect(r.trace.outcomes).toContain('repaired:acronym_endings:1');
  });

  it('repairs a bullet\'s ending after an abbreviation before judging it', async () => {
    const items = [{ id: 'x0-0', text: 'Qafqaz Hotels MMC-də işə qəbul planı hazirladim', role: 'HR, Qafqaz Hotels MMC', current: false }];
    const s = scripted({ 'a/writer-one': [JSON.stringify({ items: [{ id: 'x0-0', text: 'Qafqaz Hotels MMC-da işə qəbul planı hazırladım' }] })] });
    const r = await polishBullets(s.call, cfg(), items, job);
    expect(r.accepted).toEqual([{ id: 'x0-0', text: 'Qafqaz Hotels MMC-də işə qəbul planı hazırladım' }]);
  });

  it('treats a checker quote made only of known words (the application sentence) as a false alarm, but not a quote with a word of its own', async () => {
    const quoteOpening = JSON.stringify({ verdict: 'unsupported_content', missing_answers: [], unsupported: [{ quote: 'Bank Respublika ASC-də Backend Developer (Java) vəzifəsi üçün müraciət edirəm.', why: 'x' }] });
    const s = scripted({ 'a/writer-one': [JSON.stringify(goodLetter)], 'c/judge': [quoteOpening] });
    const ok2 = await writeLetter(s.call, cfg(), input);
    expect(ok2.letter).not.toBeNull();
    const invented = JSON.stringify({ verdict: 'unsupported_content', missing_answers: [], unsupported: [{ quote: 'Komandanı bir il idarə etdim', why: 'x' }] });
    const s2 = scripted({ 'a/writer-one': [JSON.stringify(goodLetter), JSON.stringify(goodLetter)], 'c/judge': [invented, invented], 'b/writer-two': [null] });
    expect((await writeLetter(s2.call, cfg(), input)).letter).toBeNull();
  });

  it('sends the evidence as data and never the vacancy text beyond the requirement lines', async () => {
    const s = scripted({ 'a/writer-one': [JSON.stringify(goodLetter)], 'c/judge': [faithful] });
    await writeLetter(s.call, cfg({ styleExamples: true }), input);
    const body = JSON.parse(s.calls[0].messages[1].content);
    // Evidence, candidate answers and limited role context stay separate; no complete vacancy HTML or boilerplate is sent.
    expect(Object.keys(body).sort()).toEqual(['allowed_use_ids', 'company', 'contribution_to_notice', 'evidence', 'experience_that_clarified_it', 'max_words', 'numeric_tokens', 'position', 'role_needs', 'target_words', 'what_attracts_me', 'what_caught_my_attention_here']);
    expect(body.evidence.map((e: { id: string }) => e.id)).toEqual(['E1', 'E2']);
    expect(s.calls[0].messages[0].content).toContain('OTHER FICTIONAL candidates');
    expect(s.calls[0].messages[0].content).not.toContain('Fizuli');
    const judge = JSON.parse(s.calls[1].messages[1].content);
    expect(judge.evidence).toEqual(body.evidence);
    expect(JSON.stringify(judge)).not.toContain('Nümunə Bank');
  });

  it('rejects an example metric copied into another candidate\'s letter', async () => {
    const leaked = { paragraphs: [goodLetter.paragraphs[0], { text: '40 qonağın qeydiyyatına kömək etdim.', uses: ['E1'] }] };
    const s = scripted({ 'a/writer-one': [JSON.stringify(leaked), JSON.stringify(leaked)], 'b/writer-two': [null] });
    const r = await writeLetter(s.call, cfg({ styleExamples: true }), input);
    expect(r.letter).toBeNull();
    expect(r.trace.outcomes.some((o) => o.includes('invented_number'))).toBe(true);
  });

  it('can disable demonstrations for a paired prompt comparison without changing candidate inputs', async () => {
    const s = scripted({ 'a/writer-one': [JSON.stringify(goodLetter)], 'c/judge': [faithful] });
    await writeLetter(s.call, cfg({ styleExamples: false }), input);
    expect(s.calls[0].messages[0].content).not.toContain('OTHER FICTIONAL candidates');
    expect(JSON.parse(s.calls[0].messages[1].content).evidence.map((e: { id: string }) => e.id)).toEqual(['E1', 'E2']);
  });

  it('keeps unproven style demonstrations out of the default production prompt', async () => {
    const s = scripted({ 'a/writer-one': [JSON.stringify(goodLetter)], 'c/judge': [faithful] });
    await writeLetter(s.call, cfg(), input);
    expect(s.calls[0].messages[0].content).not.toContain('OTHER FICTIONAL candidates');
  });

  it('does not let a checker accept an Azerbaijani letter containing a new Hindi word', async () => {
    const mixed = { paragraphs: [goodLetter.paragraphs[0], { ...goodLetter.paragraphs[1], text: goodLetter.paragraphs[1].text + ' Satış məsləhətçisi हूँ.' }] };
    const s = scripted({ 'a/writer-one': [JSON.stringify(mixed), JSON.stringify(mixed)], 'b/writer-two': [null], 'c/judge': [faithful] });
    const r = await writeLetter(s.call, cfg(), input);
    expect(r.letter).toBeNull();
    expect(r.trace.outcomes.some(o => o.includes('language_foreign_script'))).toBe(true);
    expect(s.calls.some(c => c.model === 'c/judge')).toBe(false);
  });

  it('retries once with the gate feedback, then accepts', async () => {
    const invented = { paragraphs: [goodLetter.paragraphs[0], { text: goodLetter.paragraphs[1].text + ' Layihədə 99 istifadəçi üçün sistem qurdum.', uses: ['E1'] }] };
    const s = scripted({ 'a/writer-one': [JSON.stringify(invented), JSON.stringify(goodLetter)], 'c/judge': [faithful] });
    const r = await writeLetter(s.call, cfg(), input);
    expect(r.letter).not.toBeNull();
    expect(r.trace.outcomes[0]).toMatch(/^writer-one:gates:.*invented_number/);
    expect(s.calls[1].messages.at(-1)?.content).toMatch(/rejected/);
  });

  it('a fact-checker rejection blocks the letter even when the gates pass', async () => {
    const verdict = JSON.stringify({ unsupported: [{ quote: 'dörd nəfərlik komandada', why: 'attributed to another project' }], verdict: 'unsupported_content', missing_answers: [] });
    const s = scripted({ 'a/writer-one': [JSON.stringify(goodLetter), JSON.stringify(goodLetter)], 'b/writer-two': [JSON.stringify(goodLetter), JSON.stringify(goodLetter)], 'c/judge': [verdict, verdict, verdict, verdict] });
    const r = await writeLetter(s.call, cfg(), input);
    expect(r.letter).toBeNull();
    expect(r.trace.outcomes.at(-1)).toBe('fallback');
    expect(r.trace.outcomes.filter((o) => o.endsWith('judge:unsupported'))).toHaveLength(4);
  });

  it('falls through the model chain when the first model is unavailable', async () => {
    const s = scripted({ 'a/writer-one': [null], 'b/writer-two': [JSON.stringify(goodLetter)], 'c/judge': [faithful] });
    const r = await writeLetter(s.call, cfg(), input);
    expect(r.letter).not.toBeNull();
    expect(r.trace.outcomes).toEqual(['writer-one:unavailable', 'judge:faithful', 'writer-two:accepted']);
  });

  it('falls back when the fact-checker is unavailable instead of presenting unchecked prose as verified', async () => {
    const s = scripted({ 'a/writer-one': [JSON.stringify(goodLetter)], 'c/judge': [null] });
    const r = await writeLetter(s.call, cfg(), input);
    expect(r.letter).toBeNull();
    expect(r.trace.outcomes).toContain('judge:unavailable');
    expect(r.trace.outcomes).toContain('fallback');
    expect(s.calls).toHaveLength(2);
  });

  it.each(['not JSON', '{}', '{"verdict":"faithful"}', '{"verdict":"faithful","unsupported":"none"}'])('falls back for a malformed checker response: %s', async (reply) => {
    const s = scripted({ 'a/writer-one': [JSON.stringify(goodLetter)], 'c/judge': [reply] });
    const r = await writeLetter(s.call, cfg(), input);
    expect(r.letter).toBeNull();
    expect(r.trace.outcomes).toContain('judge:unavailable');
  });

  it('does not accept a draft when the deadline leaves no time to check it', async () => {
    let t = 0;
    const s = scripted({ 'a/writer-one': [JSON.stringify(goodLetter)] });
    const slow: ModelCall = async (m, msgs, o) => { t += 58_000; return s.call(m, msgs, o); };
    const r = await writeLetter(slow, cfg({ now: () => t }), input);
    expect(r.letter).toBeNull();
    expect(r.trace.outcomes).toContain('deadline');
    expect(s.calls).toHaveLength(1);
  });

  it('non-JSON or empty replies fall back to the composed letter', async () => {
    const s = scripted({ 'a/writer-one': ['Sure! Here is your letter.', 'again no json'], 'b/writer-two': ['{"paragraphs":[]}', '{}'] });
    const r = await writeLetter(s.call, cfg(), input);
    expect(r.letter).toBeNull();
    expect(r.trace.outcomes.at(-1)).toBe('fallback');
  });

  it('stops at the deadline instead of calling further models', async () => {
    let t = 0;
    const s = scripted({ 'a/writer-one': [null], 'b/writer-two': [JSON.stringify(goodLetter)] });
    const slow: ModelCall = async (m, msgs, o) => { t += 58_000; return s.call(m, msgs, o); };
    const r = await writeLetter(slow, cfg({ now: () => t }), input);
    expect(r.letter).toBeNull();
    expect(r.trace.outcomes).toContain('deadline');
    expect(s.calls).toHaveLength(1);
  });

  it('writes nothing when there is no evidence and no motivation', async () => {
    const s = scripted({});
    const r = await writeLetter(s.call, cfg(), { ...input, evidence: [], motivation: '' });
    expect(r.letter).toBeNull();
    expect(r.trace.outcomes).toEqual(['no-evidence']);
    expect(s.calls).toHaveLength(0);
  });
});

describe('polishBullets', () => {
  const items = [
    { id: 'B1', text: 'mühasibatliq sənədlərini hazirladim', role: 'Mühasib, Kafe', current: false },
    { id: 'B2', text: 'Hesabatlar hazırladım; vaxt 40% azaldı.', role: 'Analitik, Şirkət', current: false },
    { id: 'B3', text: 'Müştərilərə kömək edirəm.', role: 'Satış', current: true },
  ];
  it('keeps verified rewrites and the candidate wording for everything rejected', async () => {
    const reply = JSON.stringify({ items: [
      { id: 'B1', text: 'Mühasibatlıq sənədlərini hazırladım.' },
      { id: 'B2', text: 'Hesabatlar hazırladım; vaxt 65% azaldı.' }, // invented figure
      { id: 'B3', text: 'Müştərilərə kömək edirəm.' }, // unchanged
    ] });
    const s = scripted({ 'a/writer-one': [reply] });
    const r = await polishBullets(s.call, cfg(), items, job);
    expect(r.accepted).toEqual([{ id: 'B1', text: 'Mühasibatlıq sənədlərini hazırladım.' }]);
    expect(r.rejected.map((x) => x.id)).toEqual(['B2']);
    expect(r.rejected[0].problems.map((p) => p.code)).toEqual(expect.arrayContaining(['invented_number']));
  });
  it('asks again for what failed, with the specific problem, and accepts a corrected answer', async () => {
    const first = JSON.stringify({ items: [{ id: 'B1', text: 'Mühasibatlıq sənədlərini hazırladım.' }, { id: 'B2', text: 'Hesabatlar hazırladım; vaxt 65% azaldı.' }, { id: 'B3', text: 'Müştərilərə kömək edirəm.' }] });
    const second = JSON.stringify({ items: [{ id: 'B2', text: 'Hesabatlar hazırladım; vaxt 40% azaldı.' }] });
    const s = scripted({ 'a/writer-one': [first, second] });
    const r = await polishBullets(s.call, cfg(), items, job);
    expect(r.rejected).toEqual([]);
    expect(r.accepted.map((a) => a.id).sort()).toEqual(['B1']); // B2 and B3 came back as the candidate's own first-person wording once the invented figure was dropped: nothing to change
    const retry = JSON.parse(s.calls[1].messages[1].content);
    expect(retry.items.map((i: { id: string }) => i.id)).toEqual(['B2']); // only the rejected item is sent again
    expect(retry.items[0].your_previous_answer_was_rejected_because).toMatch(/invented_number/);
  });
  it('rejects third-person model text instead of changing its actor', async () => {
    const reply = JSON.stringify({ items: [{ id: 'B1', text: 'Mühasibatlıq sənədlərini hazırladı.' }, { id: 'B3', text: 'Müştərilərə kömək edir.' }] });
    const s = scripted({ 'a/writer-one': [reply] });
    const r = await polishBullets(s.call, cfg(), items.filter((i) => i.id !== 'B2'), job);
    expect(r.accepted).toEqual([]);
    expect(r.rejected.map(item => item.id)).toEqual(['B1', 'B3']);
  });
  it('keeps the candidate\'s own correct verb tense: a habitual past is not turned into a one-time past', async () => {
    const own = [{ id: 'T1', text: 'Gündə təxminən 15 masaya xidmət göstərirdim', role: 'Ofisiant, Restoran', current: false }];
    const s = scripted({ 'a/writer-one': [JSON.stringify({ items: [{ id: 'T1', text: 'Gündə təxminən 15 masaya xidmət göstərdim' }] }), JSON.stringify({ items: [{ id: 'T1', text: 'Gündə təxminən 15 masaya xidmət göstərirdim' }] })] });
    const r = await polishBullets(s.call, cfg(), own, job);
    expect(r.accepted).toEqual([]); // second answer = the candidate's own wording: nothing to change
    expect(JSON.parse(s.calls[1].messages[1].content).items[0].your_previous_answer_was_rejected_because).toMatch(/tense_changed/);
  });
  it('also catches the causative verb whose habitual past loses its -ır-: "çatdırırdım" → "çatdırdım"', async () => {
    const own = [{ id: 'T2', text: 'Müştəri şikayətlərini administratora çatdırırdım', role: 'Ofisiant, Restoran', current: false }];
    const s = scripted({ 'a/writer-one': [JSON.stringify({ items: [{ id: 'T2', text: 'Müştəri şikayətlərini administratora çatdırdım' }] }), JSON.stringify({ items: [{ id: 'T2', text: 'Müştəri şikayətlərini administratora çatdırırdım' }] })] });
    const r = await polishBullets(s.call, cfg(), own, job);
    expect(r.accepted).toEqual([]);
    expect(JSON.parse(s.calls[1].messages[1].content).items[0].your_previous_answer_was_rejected_because).toMatch(/tense_changed/);
  });
  it('a project description is not forced into the first person', async () => {
    const proj = [{ id: 'P1', text: 'Layihə hesabatları avtomatik hazırlayır.', role: 'Hesabat paneli', current: false, kind: 'project' as const }];
    const s = scripted({ 'a/writer-one': [JSON.stringify({ items: [{ id: 'P1', text: 'Layihə hesabatları avtomatik hazırlayır' }] })] });
    const r = await polishBullets(s.call, cfg(), proj, job);
    expect(r.rejected).toEqual([]);
  });
  it('ignores unknown ids and duplicates', async () => {
    const reply = JSON.stringify({ items: [{ id: 'ZZ', text: 'Başqa şey.' }, { id: 'B1', text: 'Mühasibatlıq sənədlərini hazırladım.' }, { id: 'B1', text: 'Mühasibat sənədlərini tərtib etdim.' }] });
    const s = scripted({ 'a/writer-one': [reply] });
    const r = await polishBullets(s.call, cfg(), items, job);
    expect(r.accepted.map((a) => a.id)).toEqual(['B1']);
  });
  it('moves to the next model when the first returns nothing usable', async () => {
    const s = scripted({ 'a/writer-one': ['not json'], 'b/writer-two': [JSON.stringify({ items: [{ id: 'B1', text: 'Mühasibatlıq sənədlərini hazırladım.' }] })] });
    const r = await polishBullets(s.call, cfg(), items, job);
    expect(r.accepted).toHaveLength(1);
    expect(r.trace.outcomes[0]).toBe('writer-one:no-json');
  });
  it('is a no-op when every model is unavailable', async () => {
    const r = await polishBullets(scripted({}).call, cfg(), items, job);
    expect(r.accepted).toEqual([]);
    expect(r.rejected.map((x) => x.id)).toEqual(['B1', 'B2', 'B3']); // nothing verified: every bullet keeps the candidate's wording
  });
  it('bounds all CV retries by the overall deadline', async () => {
    let t = 0;
    const timeouts: number[] = [];
    const slow: ModelCall = async (_m, _messages, o) => { timeouts.push(o.timeoutMs); t += 38_000; return null; };
    const r = await polishBullets(slow, cfg({ now: () => t, timeoutMs: 60_000 }), items, job);
    expect(timeouts).toEqual([60_000, 22_000]);
    expect(r.trace.outcomes).toContain('deadline');
    expect(r.accepted).toEqual([]);
    expect(r.rejected.map((x) => x.id)).toEqual(['B1', 'B2', 'B3']);
  });
});

describe('letterEvidence', () => {
  const persona = {
    basics: { name: 'Test', headline: '', email: '', phone: '', location: '', website: { url: '', label: '' } }, summary: '',
    experience: [{ company: 'Kafe', position: 'Satıcı', location: '', period: '2022–2023', highlights: ['Müştərilərlə işlədim.'] }],
    education: [{ school: 'BDU', degree: 'Bakalavr', area: 'İT', location: '', period: '2021–2025', grade: '' }],
    skills: [], languages: [], certifications: [], projects: [{ id: 'p', name: 'Bank API', period: '2024', description: 'Java ilə REST API yazdım', result: '' }],
  } as unknown as Persona;
  it('ranks vacancy-relevant evidence first and ranks education last', () => {
    const ev = letterEvidence(persona, job);
    expect(ev[0].kind).toBe('project');
    expect(ev.at(-1)?.kind).toBe('education');
    expect(ev.map((e) => e.id)).toEqual(ev.map((_, i) => `E${i + 1}`));
  });

  it('prioritizes audit and assurance research over unrelated startup bullets with numbers', () => {
    const auditJob = {
      position: 'Audit üzrə mütəxəssis',
      company: 'Deloitte',
      requirements: '- Daxili audit metodologiyası\n- Maliyyə hesabatlarının auditi və risk təhlili',
      description: 'Audit komandası üçün analitik axtarılır.',
    } as unknown as TailorJobInput;

    const candidate = {
      basics: { name: 'Test', headline: '', email: '', phone: '', location: '', website: { url: '', label: '' } }, summary: '',
      experience: [
        {
          company: 'Codveda Tech',
          position: 'Founder',
          location: '',
          period: '2023 - 2024',
          highlights: ['32+ SME müştəri ilə danışaraq 6-cı inkubasiya proqramını bitirdim.'],
        },
        {
          company: 'SRT Advisory / Deloitte Layihəsi',
          position: 'Assurance and Audit Analyst',
          location: '',
          period: '2022 - 2023',
          highlights: ['Daxili audit metodologiyası və risk hesabatlarını hazırlamışam.'],
        },
      ],
      education: [], skills: [], languages: [], certifications: [], projects: [],
    } as unknown as Persona;

    const ev = letterEvidence(candidate, auditJob);
    expect(ev[0].role).toMatch(/assurance and audit analyst/i);
    expect(ev[0].text).toContain('Daxili audit metodologiyası');
  });
});

describe('periodForWriter', () => {
  it('turns English month abbreviations into year-month and keeps the range', () => {
    expect(periodForWriter('Mar 2021 - Present')).toBe('2021-03 – present');
    expect(periodForWriter('Feb 2024 - Nov 2024')).toBe('2024-02 – 2024-11');
    expect(periodForWriter('2016 - 2020')).toBe('2016 – 2020');
    expect(periodForWriter('')).toBe('');
  });
});

describe('letterEvidence: periods that are still running', () => {
  const base = { basics: { name: 'T', headline: '', email: '', phone: '', location: '', website: { url: '', label: '' } }, summary: '', experience: [], skills: [], languages: [], projects: [], certifications: [] };
  it('marks a role or degree with an explicit ongoing indicator as current, and preserves uncertainty for future dates alone', () => {
    const persona = { ...base,
      experience: [{ company: 'X', position: 'Y', location: '', period: 'Mar 2021 - Present', highlights: ['Hesabat hazırlayıram'] }, { company: 'Z', position: 'W', location: '', period: 'Jan 2018 - Dec 2019', highlights: ['Hesabat yazdım'] }],
      education: [
        { school: 'BDU', degree: 'Bakalavr', area: 'İT', location: '', period: '2023 - Present', grade: '' },
        { school: 'ADNSU', degree: 'Magistr', area: 'Kiber', location: '', period: '2024 - 2028', grade: '' },
      ] } as unknown as Persona;
    const ev = letterEvidence(persona, job, 10, new Date('2026-10-10T00:00:00Z'));
    expect(ev.find((e) => e.text === 'Hesabat hazırlayıram')?.current).toBe(true);
    expect(ev.find((e) => e.text === 'Hesabat yazdım')?.current).toBe(false);
    // Explicit '2023 - Present' is marked current
    expect(ev.find((e) => e.kind === 'education' && e.role === 'BDU')?.current).toBe(true);
    // Future date alone '2024 - 2028' without ongoing indicator preserves uncertainty (not current)
    expect(ev.find((e) => e.kind === 'education' && e.role === 'ADNSU')?.current).toBe(false);
  });
});

describe('writeLetter: style-only problems are not fatal on the last attempt', () => {
  const repeating = { paragraphs: [
    { text: 'Bank Respublika ASC-nin Backend Developer (Java) vakansiyasına müraciət edirəm. Bankın real məlumat bazaları üzərində işləyib bacarıqlarımı inkişaf etdirmək istəyirəm.', uses: ['motivation'] },
    { text: 'Hakaton layihəsində verilənlər bazası hissəsini və REST API-ni Java-da yazdım. Komandada 4 nəfər idik, verilənlər bazası hissəsini və başqa hissələri də yazdım.', uses: ['E1'] },
  ] };
  it('asks again once for the repetition, then keeps the verified draft instead of falling back', async () => {
    const s = scripted({ 'a/writer-one': [JSON.stringify(repeating), JSON.stringify(repeating)], 'c/judge': [faithful] });
    const r = await writeLetter(s.call, cfg({ models: ['a/writer-one'] }), input);
    expect(r.letter).not.toBeNull();
    expect(r.trace.outcomes[0]).toMatch(/gates:.*repeated_phrase/);
    expect(s.calls.map((c) => c.model)).toEqual(['a/writer-one', 'a/writer-one', 'c/judge']);
  });
  it('a sentence that tells again what an earlier one said is dropped, and the letter is judged without it', async () => {
    const twice = { paragraphs: [repeating.paragraphs[0], { text: 'Hakaton layihəsində verilənlər bazası hissəsini və REST API-ni Java-da yazdım. Vakansiyada Java tələb olunur; mən hakaton layihəsində verilənlər bazası hissəsini və REST API-ni Java-da yazdım. Komandada 4 nəfər idik.', uses: ['E1', 'E2'] }] };
    const s = scripted({ 'a/writer-one': [JSON.stringify(twice)], 'c/judge': [faithful] });
    const r = await writeLetter(s.call, cfg({ models: ['a/writer-one'] }), input);
    expect(r.trace.outcomes).toContain('repaired:duplicate_sentence:1');
    expect(r.letter?.paragraphs[1].text).not.toContain('Vakansiyada Java tələb olunur');
    expect(r.letter?.paragraphs[1].text).toContain('Komandada 4 nəfər idik.');
  });
  it('dropRepeatedSentences never leaves fewer than two paragraphs', () => {
    const one = [{ text: 'Eyni cümlə burada beş altı yeddi səkkiz doqquz söz ilə yazılıb. Eyni cümlə burada beş altı yeddi səkkiz doqquz söz ilə yazılıb.' }, { text: '' }];
    expect(dropRepeatedSentences(one).dropped).toBe(0);
  });
  it('a factual problem on the second attempt is still fatal', async () => {
    const invented = { paragraphs: [repeating.paragraphs[0], { text: repeating.paragraphs[1].text + ' Layihədə 99 istifadəçi üçün sistem qurdum.', uses: ['E1'] }] };
    const s = scripted({ 'a/writer-one': [JSON.stringify(invented), JSON.stringify(invented)], 'c/judge': [faithful] });
    const r = await writeLetter(s.call, cfg({ models: ['a/writer-one'] }), input);
    expect(r.letter).toBeNull();
  });
});

describe('writeLetter: evidenced fallbacks of the production canary and the paired comparison', () => {
  const long = (text: string) => text;
  const oneParagraph = { paragraphs: [{ text: 'Bank Respublika ASC-nin Backend Developer (Java) vakansiyasına müraciət edirəm. Bankın real məlumat bazaları üzərində işləyib bacarıqlarımı inkişaf etdirmək istəyirəm. Hakaton layihəsində verilənlər bazası hissəsini və REST API-ni Java-da yazdım. Komandada 4 nəfər idik.', uses: ['motivation', 'E1', 'E2'] }] };
  it('a draft that comes back as one paragraph is split after its first sentence, words unchanged', async () => {
    const s = scripted({ 'a/writer-one': [JSON.stringify(oneParagraph)], 'c/judge': [faithful] });
    const r = await writeLetter(s.call, cfg({ models: ['a/writer-one'] }), input);
    expect(r.letter?.paragraphs).toHaveLength(2);
    expect(r.letter!.paragraphs[0].text).toBe('Bank Respublika ASC-nin Backend Developer (Java) vakansiyasına müraciət edirəm.');
    expect(r.letter!.paragraphs.map((p) => p.text).join(' ')).toBe(oneParagraph.paragraphs[0].text);
    expect(long('x')).toBe('x');
  });
  it('a fact-checker "finding" that only quotes the supplied position or employer is a false alarm; a real claim still rejects', async () => {
    const falseAlarm = JSON.stringify({ unsupported: [{ quote: 'Backend Developer (Java)', why: 'position not in evidence' }], verdict: 'unsupported_content', missing_answers: [] });
    const s = scripted({ 'a/writer-one': [JSON.stringify(goodLetter)], 'c/judge': [falseAlarm] });
    expect((await writeLetter(s.call, cfg({ models: ['a/writer-one'] }), input)).letter).not.toBeNull();
    const real = JSON.stringify({ unsupported: [{ quote: 'Backend Developer (Java)', why: 'x' }, { quote: 'komandanı idarə etdim', why: 'leadership not in evidence' }], verdict: 'unsupported_content', missing_answers: [] });
    const s2 = scripted({ 'a/writer-one': [JSON.stringify(goodLetter), JSON.stringify(goodLetter)], 'c/judge': [real, real] });
    expect((await writeLetter(s2.call, cfg({ models: ['a/writer-one'] }), input)).letter).toBeNull();
  });
});

describe('dropExperienceClaims', () => {
  it('drops sentences whose subject is the experience, keeps facts and "Bu müddət ərzində"', () => {
    const r = dropExperienceClaims([
      { text: 'Anbar müdirinin köməkçisi vakansiyasına müraciət edirəm.' },
      { text: '2022-ci ilin martından anbar işçisi kimi işləyirəm. Bu müddət ərzində gələn malları qəbul edirəm. Bu təcrübə mənə anbar uçotu bacarığı qazandırdı. Həmin iş məni məsuliyyətli olmağa hazırladı.' },
    ]);
    expect(r.dropped).toBe(2);
    expect(r.paragraphs[1].text).toBe('2022-ci ilin martından anbar işçisi kimi işləyirəm. Bu müddət ərzində gələn malları qəbul edirəm.');
  });
  it('keeps the draft unchanged when dropping would leave fewer than two paragraphs', () => {
    const input = [{ text: 'Müraciət edirəm.' }, { text: 'Bu təcrübə mənə çox şey öyrətdi.' }];
    expect(dropExperienceClaims(input)).toEqual({ paragraphs: input, dropped: 0 });
  });
});

describe('plainHyphens', () => {
  it('turns Unicode and non-breaking hyphens into "-" and drops soft hyphens (16 Oct letter: "MMC\u2011də")', () => {
    expect(plainHyphens('Aztrans Logistika MMC\u2011də 2017\u20102020 ar\u00ADxiv')).toBe('Aztrans Logistika MMC-də 2017-2020 arxiv');
  });
});

it('provides exact answer evidence ids, unpaired role context and metric spellings to the writer', async () => {
  const s = scripted({ 'a/writer-one': [null], 'b/writer-two': [null] });
  await writeLetter(s.call, cfg(), { ...input,
    evidence: [...evidence, { id: 'E3', kind: 'project', text: '120,000 qeydi SQL ilə yoxladım.' }],
    formative: 'SQL yoxlaması bu istiqamətə marağımı artırdı.',
    contribution: 'SQL yoxlamalarını tətbiq etmək istəyirəm.',
    links: [],
  });
  const payload = JSON.parse(s.calls[0].messages[1].content);
  expect(payload.allowed_use_ids).toContain('experience_that_clarified_it');
  expect(payload.allowed_use_ids).toContain('contribution_to_notice');
  expect(payload.allowed_use_ids).not.toContain('experience_that_clarity');
  expect(payload.allowed_use_ids).not.toContain('reason_for_company');
  expect(payload.role_needs).toContain(job.requirements);
  expect(payload.numeric_tokens).toContain('120,000');
  expect(s.calls[0].messages[0].content).toContain('Copy numeric_tokens exactly');
});

it('rejects a faithful draft that omits a confirmed contribution, then retries with coverage feedback', async () => {
  const missing = JSON.stringify({ unsupported: [], missing_answers: ['contribution_to_notice'], verdict: 'faithful' });
  const s = scripted({ 'a/writer-one': [JSON.stringify(goodLetter), JSON.stringify(goodLetter)], 'c/judge': [missing, faithful] });
  const result = await writeLetter(s.call, cfg(), { ...input, contribution: 'REST API üzrə gördüyüm işi göstərmək istəyirəm.' });
  expect(result.trace.outcomes).toContain('writer-one:judge:missing_answers:contribution_to_notice');
  expect(s.calls[2].messages.at(-1)?.content).toContain('contribution_to_notice');
});
it('does not call an unchecked omission verdict a complete letter', async () => {
  const s = scripted({ 'a/writer-one': [JSON.stringify(goodLetter)], 'c/judge': [JSON.stringify({ unsupported: [], verdict: 'faithful' })] });
  const result = await writeLetter(s.call, cfg(), input);
  expect(result.letter).toBeNull();
  expect(result.trace.outcomes).toContain('judge:coverage_unverified');
});

it('keeps same-employer roles and a separate project distinguishable in both writer and checker evidence', async () => {
  const persona = {
    experience: [
      { entryId: 'mentor', company: 'Example', position: 'Audit mentee', period: '2025', highlights: ['SQL ilə sənədləri yoxladım.', 'SQL ilə risk xəritəsi hazırladım.'] },
      { entryId: 'employee', company: 'Example', position: 'SQL analyst', period: '2025', highlights: ['SQL hesabatı hazırladım.'] },
    ],
    projects: [{ entryId: 'mentor', name: 'SQL tədris layihəsi', period: '2025', description: 'SQL ilə əməliyyatları uzlaşdırdım.' }],
  } as Persona;
  const facts = letterEvidence(persona, job);
  expect(facts.filter((e) => e.sourceId === 'experience:mentor')).toHaveLength(2);
  expect(facts.find((e) => e.sourceId === 'experience:mentor')?.scope).toBe('mentorship');
  expect(facts.find((e) => e.sourceId === 'project:mentor')?.kind).toBe('project');
  expect(facts.find((e) => e.sourceId === 'experience:employee')?.scope).toBe('employment');
  const s = scripted({ 'a/writer-one': [JSON.stringify(goodLetter)], 'c/judge': [faithful] });
  await writeLetter(s.call, cfg(), { ...input, evidence: facts });
  const payload = JSON.parse(s.calls[0].messages[1].content);
  expect(payload.evidence.map((e: { source_id: string }) => e.source_id)).toEqual(facts.map((e) => e.sourceId));
});

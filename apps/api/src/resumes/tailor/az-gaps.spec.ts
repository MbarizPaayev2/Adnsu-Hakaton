import { uncoveredRequirements } from './az-compose';

describe('uncoveredRequirements (the follow-up question of a letter review)', () => {
  const lines = [
    'Excel-də hesabat hazırlamaq təcrübəsi',
    'SQL biliyi',
    'Power BI və ya Tableau ilə vizuallaşdırma',
    'Komanda ilə işləmək bacarığı',
  ];

  it('returns only the requirements nothing confirmed speaks to, in the vacancy\'s order, at most two', () => {
    const have = ['Aylıq maliyyə hesabatlarını hazırlayırdım', 'Excel-də 5 min sətirlik cədvəllərlə işləyirdim', 'SQL'];
    expect(uncoveredRequirements(lines, have)).toEqual(['Power BI və ya Tableau ilə vizuallaşdırma', 'Komanda ilə işləmək bacarığı']);
    expect(uncoveredRequirements(lines, have, 1)).toEqual(['Power BI və ya Tableau ilə vizuallaşdırma']);
  });

  it('counts a shared tool name and an inflected form as covered', () => {
    expect(uncoveredRequirements(['SQL biliyi'], ['Verilənlər bazasında SQL sorğuları yazdım'])).toEqual([]);
    expect(uncoveredRequirements(['Hesabatların hazırlanması üzrə təcrübə'], ['Aylıq hesabat hazırlayırdım'])).toEqual([]);
  });

  it('asks about everything when the candidate confirmed nothing, and never invents coverage', () => {
    expect(uncoveredRequirements(lines, [], 4)).toHaveLength(4);
  });
});

import { candidateEvidence, composeLetterParagraphs, deterministicMatches, isNegatedStatement } from './az-compose';
import type { Persona, TailorJobInput } from './resume-tailor.types';

describe('composed fallback letter', () => {
  const persona = (over: Partial<Persona>): Persona => ({
    basics: { name: 'N', headline: '', email: '', phone: '', location: '', website: { url: '', label: '' } }, summary: '', experience: [], education: [], skills: [], languages: [], projects: [], certifications: [], ...over,
  });
  const job = (over: Partial<TailorJobInput>): TailorJobInput => ({ id: 'j', position: 'Junior QA mühəndisi', company: 'Kontakt Home', location: '', education: '', experience: '', salary_from: '', salary_to: '', category: '', description: '', requirements: '', responsibilities: '', ...over });

  it('uses projects and certificates when the candidate has no job, instead of an empty letter', () => {
    const p = persona({
      projects: [{ id: 'p0', name: 'Qeydiyyat sistemi', description: 'Test ssenarilərini yazdım və səhvləri qeyd etdim', result: '12 səhv tapdım', period: '2024', entryId: 'e1' }],
      certifications: [{ id: 'c0', title: 'ISTQB Foundation', issuer: 'ISTQB', date: '2025', entryId: 'e2' }],
    } as Partial<Persona>);
    const j = job({ requirements: '- Test ssenarilərinin yazılması\n- SQL biliyi', description: 'Veb tətbiqlərin test edilməsi.' });
    const text = composeLetterParagraphs(p, j, '', deterministicMatches([], candidateEvidence(p))).join('\n');
    expect(text).toMatch(/Təcrübəmdən nümunələr:/);
    expect(text).toContain('Test ssenarilərini yazdım');
    expect(text).not.toMatch(/Bu, Junior QA/);
  });

  it('does not present two incidental shared words as an answer to a requirement', () => {
    const ev = [{ id: 'E1', source: 'experience' as const, text: 'Komandada 4 nəfər idik, mən verilənlər bazası hissəsini və REST API-ni Java-da yazdım.' }];
    const reqs = ['Hibernate/JPA ilə işləmə, verilənlər bazası performansının optimallaşdırılması üzrə təcrübə'];
    expect(deterministicMatches(reqs, ev)).toEqual([]);
  });

  it('never lists what the candidate lacks as an example of experience', () => {
    expect(isNegatedStatement('Satış və CRM təcrübəsi yoxdur.')).toBe(true);
    expect(isNegatedStatement('Hüquqi məsləhət vermək səlahiyyəti olmayıb')).toBe(true);
    expect(isNegatedStatement('Altı il taksi sürücüsü olub')).toBe(false);
    const p = persona({ experience: [{ company: 'X', position: 'Y', location: '', period: '', highlights: ['Satış və CRM təcrübəsi yoxdur', 'Marşrut planlaması və gündəlik müştəri ünsiyyəti təcrübəsi var'] }] });
    const text = composeLetterParagraphs(p, job({ position: 'Ticarət nümayəndəsi', requirements: '- Satış və CRM təcrübəsi' }), '', []).join('\n');
    expect(text).not.toContain('yoxdur');
    expect(text).toContain('Marşrut planlaması');
  });
});

import {
  translationProblems,
  translateItems,
  untranslatedItems,
} from './az-translate';
import type { ModelCall, WriterConfig } from './az-writer';
import type { TailoredContent } from './resume-tailor.types';

describe('translationProblems validator: factual protection & title/location flexibility', () => {
  describe('valid translated generic titles and inflected locations', () => {
    it('accepts translated generic title words in title-case without false dropped_name', () => {
      const src = 'Corporate Risk Analyst';
      const out = 'Korporativ risk analitiki';
      const problems = translationProblems(src, out, { kind: 'headline' });
      expect(problems).toEqual([]);
    });

    it('accepts technical infrastructure terms translated to natural Azerbaijani', () => {
      const src = 'Distributed Infrastructure Engineer';
      const out = 'Paylanmış infrastruktur mühəndisi';
      const problems = translationProblems(src, out, { kind: 'headline' });
      expect(problems).toEqual([]);
    });

    it('accepts Baku State University translated without flagging Baku or State as missing proper nouns', () => {
      const src = 'Baku State University';
      const out = 'Bakı Dövlət Universiteti';
      const problems = translationProblems(src, out, { kind: 'label' });
      expect(problems).toEqual([]);
    });

    it('accepts inflected Baku location (Bakıda)', () => {
      const src = 'Operations Assistant in Baku, Azerbaijan';
      const out = 'Bakıda, Azərbaycanda əməliyyat üzrə köməkçi';
      const problems = translationProblems(src, out, { kind: 'headline' });
      expect(problems.filter((p) => p.code === 'dropped_name')).toEqual([]);
    });

    it('accepts higher education / academic curriculum terms', () => {
      const src = 'Academic Curriculum Specialist';
      const out = 'Akademik kurrikulum mütəxəssisi';
      const problems = translationProblems(src, out, { kind: 'headline' });
      expect(problems).toEqual([]);
    });

    it('accepts faithful translation of Deloitte Risk Advisory Intern preserving Deloitte and translating generic words', () => {
      const src = 'Deloitte Risk Advisory Intern';
      const out = 'Deloitte risk məsləhət təcrübəçisi';
      const problems = translationProblems(src, out, { kind: 'label' });
      expect(problems).toEqual([]);
    });
  });

  describe('strict factual protection against altered names, employers, tools, and numbers', () => {
    it('rejects altered employer name (substituting Deloitte with Pasha Holding)', () => {
      const src = 'Intern at Deloitte';
      const out = 'Pasha Holding təcrübəçisi kimi çalışdım';
      const problems = translationProblems(src, out, { kind: 'label' });
      const codes = problems.map((p) => p.code);
      expect(codes).toContain('dropped_name');
      expect(
        problems.some(
          (p) => p.code === 'dropped_name' && p.detail.includes('deloitte'),
        ),
      ).toBe(true);
    });

    it('rejects replacing employer at token 0 in label (Deloitte Risk Advisory Intern replaced by Pasha Holding)', () => {
      const src = 'Deloitte Risk Advisory Intern';
      const out = 'Pasha Holding risk məsləhət təcrübəçisi';
      const problems = translationProblems(src, out, { kind: 'label' });
      expect(
        problems.some(
          (p) => p.code === 'dropped_name' && p.detail.includes('deloitte'),
        ),
      ).toBe(true);
    });

    it('rejects replacing employer at token 0 with an invented organization', () => {
      const src = 'Deloitte Risk Advisory Intern';
      const out = 'AcmeCorp risk məsləhət təcrübəçisi';
      const problems = translationProblems(src, out, { kind: 'label' });
      expect(
        problems.some(
          (p) => p.code === 'dropped_name' && p.detail.includes('deloitte'),
        ),
      ).toBe(true);
      expect(
        problems.some(
          (p) => p.code === 'new_name' && p.detail.includes('acmecorp'),
        ),
      ).toBe(true);
    });

    it('rejects dropping Baku from Baku State University', () => {
      const src = 'Baku State University';
      const out = 'Dövlət Universiteti';
      const problems = translationProblems(src, out, { kind: 'label' });
      expect(
        problems.some(
          (p) => p.code === 'dropped_name' && p.detail.includes('baku'),
        ),
      ).toBe(true);
    });

    it('rejects altering Baku State University to a different institution (Azərbaycan Dövlət İqtisad Universiteti)', () => {
      const src = 'Baku State University';
      const out = 'Azərbaycan Dövlət İqtisad Universiteti';
      const problems = translationProblems(src, out, { kind: 'label' });
      expect(
        problems.some(
          (p) => p.code === 'dropped_name' && p.detail.includes('baku'),
        ),
      ).toBe(true);
    });

    it('rejects dropped employer name (dropping Google entirely)', () => {
      const src = 'Software Engineer at Google';
      const out = 'Proqram mühəndisi kimi çalışdım';
      const problems = translationProblems(src, out, { kind: 'bullet' });
      expect(
        problems.some(
          (p) => p.code === 'dropped_name' && p.detail.includes('google'),
        ),
      ).toBe(true);
    });

    it('rejects replaced technical tools (PostgreSQL and Docker replaced by MongoDB and Kubernetes)', () => {
      const src = 'Built backend microservices using PostgreSQL and Docker';
      const out = 'Yalnız Docker və Kubernetes ilə mikroxidmətlər qurdum';
      const problems = translationProblems(src, out, { kind: 'bullet' });
      expect(
        problems.some(
          (p) => p.code === 'dropped_name' && p.detail.includes('postgresql'),
        ),
      ).toBe(true);
    });

    it('rejects dropped technical tool when omitted completely', () => {
      const src = 'Built backend microservices using PostgreSQL and Docker';
      const out = 'Yalnız Docker istifadə edərək mikroxidmətlər qurdum';
      const problems = translationProblems(src, out, { kind: 'bullet' });
      expect(
        problems.some(
          (p) => p.code === 'dropped_name' && p.detail.includes('postgresql'),
        ),
      ).toBe(true);
    });

    it('rejects altered numbers (15 altered to 25)', () => {
      const src = 'Led a cross-functional team of 15 engineers';
      const out = '25 mühəndisdən ibarət komandaya rəhbərlik etdim';
      const problems = translationProblems(src, out, { kind: 'bullet' });
      expect(
        problems.some(
          (p) => p.code === 'invented_number' && p.detail.includes('25'),
        ),
      ).toBe(true);
      expect(
        problems.some(
          (p) => p.code === 'dropped_number' && p.detail.includes('15'),
        ),
      ).toBe(true);
    });

    it('rejects altered date years (2023 altered to 2022)', () => {
      const src = 'Research Fellow (2023 - 2024)';
      const out = 'Tədqiqatçı təqaüdçüsü (2022 - 2024)';
      const problems = translationProblems(src, out, { kind: 'label' });
      expect(
        problems.some(
          (p) => p.code === 'invented_number' && p.detail.includes('2022'),
        ),
      ).toBe(true);
      expect(
        problems.some(
          (p) => p.code === 'dropped_number' && p.detail.includes('2023'),
        ),
      ).toBe(true);
    });

    it('rejects invented metric claims where none existed in source', () => {
      const src = 'Organized community workshops on data literacy';
      const out =
        'Məlumat savadlılığı üzrə 100 nəfərlik icma seminarları təşkil etdim';
      const problems = translationProblems(src, out, { kind: 'bullet' });
      expect(
        problems.some(
          (p) => p.code === 'invented_number' && p.detail.includes('100'),
        ),
      ).toBe(true);
    });

    it('rejects dropped metrics when source had percentages', () => {
      const src = 'Optimized SQL queries, reducing API response latency by 45%';
      const out =
        'SQL sorğularını optimallaşdıraraq API cavab gecikməsini azaltdım';
      const problems = translationProblems(src, out, { kind: 'bullet' });
      expect(
        problems.some(
          (p) => p.code === 'dropped_number' && p.detail.includes('45'),
        ),
      ).toBe(true);
    });
  });

  describe('partial translation preservation and unresolved retry', () => {
    const cfg: WriterConfig = {
      models: ['m1'],
      judgeModel: 'j',
      timeoutMs: 10_000,
      deadlineMs: 60_000,
    };

    it('preserves successful fields and only retries unresolved fields without labeling failures successful', async () => {
      const item1 = {
        id: 'item1',
        text: 'Graduated from Baku State University with honors.',
        kind: 'bullet' as const,
      };
      const item2 = {
        id: 'item2',
        text: 'Software Engineer at Deloitte.',
        kind: 'bullet' as const,
      };

      let callCount = 0;
      const call: ModelCall = async (_m, messages) => {
        callCount++;
        const inputItems = JSON.parse(messages[1].content).items as {
          id: string;
        }[];
        if (callCount === 1) {
          // Attempt 1: item1 succeeds faithfully; item2 drops employer Deloitte (fails)
          expect(inputItems.map((i) => i.id)).toEqual(['item1', 'item2']);
          return {
            text: JSON.stringify({
              items: [
                {
                  id: 'item1',
                  text: 'Bakı Dövlət Universitetini fərqlənmə diplomu ilə bitirdim.',
                },
                { id: 'item2', text: 'Proqram mühəndisi kimi çalışdım.' }, // drops Deloitte!
              ],
            }),
            model: 'm1',
            promptTokens: 10,
            completionTokens: 10,
          };
        } else if (callCount === 2) {
          // Attempt 1 internal retry: translateItems only retries unresolved item2!
          expect(inputItems.map((i) => i.id)).toEqual(['item2']);
          return {
            text: JSON.stringify({
              items: [
                { id: 'item2', text: 'Proqram mühəndisi kimi işlədim.' }, // still drops Deloitte!
              ],
            }),
            model: 'm1',
            promptTokens: 5,
            completionTokens: 5,
          };
        } else {
          // Attempt 2 (external retry pass): candidate retries unresolved items only
          expect(inputItems.map((i) => i.id)).toEqual(['item2']);
          return {
            text: JSON.stringify({
              items: [
                {
                  id: 'item2',
                  text: 'Deloitte şirkətində proqram mühəndisi kimi çalışdım.',
                }, // faithfully keeps Deloitte!
              ],
            }),
            model: 'm1',
            promptTokens: 5,
            completionTokens: 5,
          };
        }
      };

      // Initial generation pass
      const result1 = await translateItems(call, cfg, [item1, item2]);
      expect(result1.accepted.map((a) => a.id)).toEqual(['item1']);
      expect(result1.accepted[0].text).toBe(
        'Bakı Dövlət Universitetini fərqlənmə diplomu ilə bitirdim.',
      );
      expect(result1.failed.map((f) => f.id)).toEqual(['item2']);
      expect(
        result1.failed[0].problems.some((p) => p.code === 'dropped_name'),
      ).toBe(true);

      // Verify that item1 is preserved and retry ONLY runs on unresolved item2
      const unresolvedItems = [item2].filter((item) =>
        result1.failed.some((f) => f.id === item.id),
      );
      expect(unresolvedItems.map((i) => i.id)).toEqual(['item2']);

      const result2 = await translateItems(call, cfg, unresolvedItems);
      expect(result2.accepted.map((a) => a.id)).toEqual(['item2']);
      expect(result2.accepted[0].text).toBe(
        'Deloitte şirkətində proqram mühəndisi kimi çalışdım.',
      );
      expect(result2.failed).toEqual([]);

      // Combined final state has both successfully translated items without re-translating item1
      const finalAccepted = [...result1.accepted, ...result2.accepted];
      expect(finalAccepted).toHaveLength(2);
      expect(finalAccepted.find((a) => a.id === 'item1')?.text).toBe(
        'Bakı Dövlət Universitetini fərqlənmə diplomu ilə bitirdim.',
      );
      expect(finalAccepted.find((a) => a.id === 'item2')?.text).toBe(
        'Deloitte şirkətində proqram mühəndisi kimi çalışdım.',
      );
    });

    it('blocks approval by identifying incomplete translations in untranslatedItems', () => {
      const content = {
        language: 'az',
        basics: { name: 'A', headline: 'Məlumat analitiki', location: 'Bakı' },
        summary: 'Təcrübəli analitik',
        experience: [
          {
            company: 'Deloitte',
            position: 'Biznes analitiki',
            location: 'Bakı',
            period: '2023 - 2024',
            highlights: ['Aylıq hesabatlar hazırladım.'],
          },
          {
            company: 'Acme',
            position: 'Developer',
            location: 'Bakı',
            period: '2022 - 2023',
            highlights: [
              'Built backend microservices using PostgreSQL and Docker.',
            ],
          }, // English remaining!
        ],
        education: [],
        skills: [],
        languages: [],
        projects: [],
        activities: [
          {
            title: 'Youth in Development Fellow',
            role: 'Participant',
            period: '2023',
          }, // English title remaining!
        ],
        certifications: [],
        awards: [],
      } as unknown as TailoredContent;

      const untranslated = untranslatedItems(content);
      expect(untranslated.map((u) => u.path)).toEqual([
        'experience.1.position',
        'experience.1.highlights.0',
        'activities.0.title',
      ]);
    });
  });
});

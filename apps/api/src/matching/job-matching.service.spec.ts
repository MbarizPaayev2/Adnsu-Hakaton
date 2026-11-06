import {
  buildJobPayload,
  buildPersonaFromProfile,
  buildVacancyPayload,
  estimateEducationRank,
  estimateYearsOfExperience,
  inferLanguagesFromText,
  JobMatchingService,
  type MatchableProfile,
} from './job-matching.service';

function profile(over: Partial<MatchableProfile> = {}): MatchableProfile {
  return {
    id: 'profile_1',
    headline: 'Senior Full Stack Engineer',
    skills: ['TypeScript', 'React'],
    location: 'Bakı',
    jobPreferences: { roles: ['Software Engineer'], locations: ['Bakı'], types: ['remote'] },
    experiences: [],
    education: [],
    ...over,
  };
}

describe('inferLanguagesFromText', () => {
  it('detects Azerbaijani/English/Russian from CV-style skill lists', () => {
    expect(inferLanguagesFromText('Azərbaycan dili, İngilis dili, Rus dili')).toEqual(
      expect.arrayContaining(['az', 'en', 'ru']),
    );
  });

  it('does not invent languages from empty text', () => {
    expect(inferLanguagesFromText('')).toEqual([]);
  });
});

describe('estimateYearsOfExperience', () => {
  const now = new Date('2026-09-01').getTime();

  it('sums tenures instead of now-minus-earliest-start (career gaps do not inflate)', () => {
    const experiences = [
      // 1 year, then a 3-year gap, then 1 more year: total 2.0.
      // The old now-minus-earliest-start math reported ~6.7 for the same rows.
      { title: 'A', company: 'A', description: '', startDate: new Date('2020-01-01'), endDate: new Date('2021-01-01') },
      { title: 'B', company: 'B', description: '', startDate: new Date('2024-01-01'), endDate: new Date('2025-01-01') },
    ];
    expect(estimateYearsOfExperience(experiences as any, now)).toBeCloseTo(2.0, 1);
  });

  it('returns 0 for no experience', () => {
    expect(estimateYearsOfExperience([])).toBe(0);
  });
});

describe('estimateEducationRank', () => {
  it('ranks bachelor-level degrees as 4', () => {
    expect(estimateEducationRank([{ institution: 'BDU', degree: 'Bakalavr', fieldOfStudy: 'CS' }])).toBe(4);
  });
});

describe('buildPersonaFromProfile', () => {
  it('infers languages from skills/headline instead of sending an empty array', () => {
    const persona = buildPersonaFromProfile(
      profile({ skills: ['Excel', 'İngilis dili'], headline: 'Mühasib, rus dili' }),
    ) as any;
    const codes = persona.languages.map((l: any) => l.code);
    expect(codes).toEqual(expect.arrayContaining(['en', 'ru']));
  });

  it('falls back to salaryExpectation as the min when prefs carry no range', () => {
    const persona = buildPersonaFromProfile(
      profile({ jobPreferences: { roles: [], locations: [], types: [] }, salaryExpectation: 1500 }),
    ) as any;
    expect(persona.salary_expectation.monthly_min).toBe(1500);
  });

  it('explicit prefs salary range wins over salaryExpectation', () => {
    const persona = buildPersonaFromProfile(
      profile({
        jobPreferences: { roles: [], locations: [], types: [], salaryMin: 2500, salaryMax: 5000 },
        salaryExpectation: 1500,
      }),
    ) as any;
    expect(persona.salary_expectation.monthly_min).toBe(2500);
    expect(persona.salary_expectation.monthly_max).toBe(5000);
  });

  it('passes work arrangements through for remote-neutral scoring', () => {
    const persona = buildPersonaFromProfile(profile()) as any;
    expect(persona.work_arrangements).toContain('remote');
  });

  it('passes only candidate-stated citizenship through to the scorer', () => {
    expect((buildPersonaFromProfile(profile({ citizenship: 'Azerbaijan' })) as any).citizenship).toBe('Azerbaijan');
    expect((buildPersonaFromProfile(profile()) as any).citizenship).toBeNull();
  });

  it('merges base-resume parsed skills into hard skills without duplicates', () => {
    const persona = buildPersonaFromProfile(
      profile({ resumes: [{ parsedContent: { skills: ['React', 'PostgreSQL'] } }] }),
    ) as any;
    expect(persona.hard_skills.filter((s: string) => s.toLowerCase() === 'react')).toHaveLength(1);
    expect(persona.hard_skills).toContain('PostgreSQL');
  });
});

describe('buildJobPayload', () => {
  it('preserves Glorri source facts and does not mutate the raw payload', () => {
    const raw = { slug: 'x', detail: { title: 'T' } };
    const payload = buildJobPayload({ id: '1', externalId: 'glorri:x', title: 'T', company: 'C', description: 'D', location: 'L', url: 'https://x', workArrangement: 'hybrid', rawPayload: raw });
    expect(payload).toMatchObject({ slug: 'x', workArrangement: 'hybrid' });
    expect(raw).not.toHaveProperty('workArrangement');
  });

  it('does not overwrite an explicit Glorri arrangement with a normalized row fallback', () => {
    const raw = { slug: 'x', workArrangement: 'remote', detail: { title: 'T' } };
    const payload = buildJobPayload({ id: '1', externalId: 'glorri:x', title: 'T', company: 'C', description: 'D', location: 'L', url: 'https://x', workArrangement: 'onsite', rawPayload: raw });
    expect(payload).toBe(raw);
    expect(payload.workArrangement).toBe('remote');
  });

  it('uses an explicit nested Glorri fact before a row fallback', () => {
    const raw = { slug: 'x', detail: { title: 'T', workArrangement: 'onsite' } };
    const payload = buildJobPayload({ id: '1', externalId: 'glorri:x', title: 'T', company: 'C', description: 'D', location: 'L', url: 'https://x', workArrangement: 'hybrid', rawPayload: raw });
    expect(payload).toBe(raw);
  });

  it('rebuilds generic jobs from row columns so the scorer embeds real text', () => {
    const payload = buildJobPayload({
      id: 'db_1', externalId: 'job-1', title: 'React Dev', company: 'ACME',
      description: 'React and TypeScript required', location: 'Bakı', url: 'https://x',
      workArrangement: 'hybrid',
      rawPayload: { source: 'seed-script' },
    }) as any;
    expect(payload.detail.description_text).toContain('React and TypeScript required');
    expect(payload.detail.title).toBe('React Dev');
    expect(payload.company.name).toBe('ACME');
    expect(payload.workArrangement).toBe('hybrid');
  });
});

describe('buildVacancyPayload', () => {
  it('maps native vacancy columns to the parse_vacancy contract', () => {
    const payload = buildVacancyPayload({
      id: 'vac_1', title: 'Frontend Dev', companyName: 'Startup', description: 'Build apps',
      requirements: 'React experience', responsibilities: 'Ship', skills: ['React'],
      salaryMin: 2000, salaryMax: 3000, location: 'Bakı', workArrangement: 'hybrid',
      experienceLevel: 'Middle', status: 'ACTIVE', views: 3,
    }) as any;
    expect(payload.skills).toEqual(['React']);
    expect(payload.workArrangement).toBe('hybrid');
    expect(payload.company.name).toBe('Startup');
  });
});

describe('JobMatchingService response validation', () => {
  const job = { id: 'job_1', externalId: 'glorri:x', title: 'Backend', company: 'Co', description: 'NestJS', location: 'Bakı', url: 'https://jobs.glorri.com/x' };
  const profile = { id: 'profile_1', headline: 'NestJS', skills: ['NestJS'], location: 'Bakı', jobPreferences: {}, experiences: [], education: [] };
  const respond = (body: unknown) =>
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }) as any);
  let service: JobMatchingService;
  beforeEach(() => {
    service = new JobMatchingService();
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('keeps well-formed scores', async () => {
    respond({ results: [{ profileId: 'profile_1', score: 0.62, matchedKeywords: ['nestjs'], breakdown: {}, gaps: [] }] });
    const scores = await service.scoreBatch(job, [profile as any]);
    expect(scores.get('profile_1')).toMatchObject({ score: 0.62, matchedKeywords: ['nestjs'] });
  });

  it('sends normalized imported-job facts and candidate citizenship in the actual /score request', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      results: [{ profileId: 'profile_1', score: 0, matchedKeywords: [], gaps: [], breakdown: { filters: { work_arrangement: false, recommendation_eligible: false } } }],
    }), { status: 200 }) as any);
    const imported = { ...job, workArrangement: 'onsite', rawPayload: { slug: 'x', detail: { title: 'Backend' } } };
    const candidate = { ...profile, citizenship: 'Georgia' };
    const result = await service.scoreBatch(imported, [candidate as any]);
    const sent = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
    expect(sent.job.workArrangement).toBe('onsite');
    expect(sent.profiles[0].persona.citizenship).toBe('Georgia');
    expect(result.get('profile_1')?.breakdown.filters).toMatchObject({ work_arrangement: false, recommendation_eligible: false });
  });

  it.each([
    ['no results array', { detail: 'oops' }],
    ['an empty entry', { results: [{}] }],
    ['an unrequested id', { results: [{ profileId: 'someone_else', score: 0.5, matchedKeywords: [] }] }],
    ['a null score', { results: [{ profileId: 'profile_1', score: null, matchedKeywords: [] }] }],
    ['an out-of-range score', { results: [{ profileId: 'profile_1', score: 81, matchedKeywords: [] }] }],
    ['non-array keywords', { results: [{ profileId: 'profile_1', score: 0.5, matchedKeywords: 'nestjs' }] }],
  ])('treats a /score response with %s as a failed chunk', async (_label, body) => {
    respond(body);
    const scores = await service.scoreBatch(job, [profile as any]);
    expect(scores.size).toBe(0);
  });

  it('treats a malformed /score-profile response as a failed chunk', async () => {
    respond({ results: [{ jobId: 'job:job_1', score: 'high', matchedKeywords: [] }] });
    const results = await service.scoreProfileBatch(profile as any, [job], []);
    expect(results.size).toBe(0);
  });

  it('treats an outage as a failed chunk', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    expect((await service.scoreBatch(job, [profile as any])).size).toBe(0);
  });

  describe('profile-direction chunking', () => {
    const jobs = (n: number) => Array.from({ length: n }, (_, i) => ({ ...job, id: `job_${i}`, externalId: `x:${i}` }));
    const echo = () =>
      jest.spyOn(global, 'fetch').mockImplementation(async (_url: any, init: any) => {
        const sent = JSON.parse(init.body).jobs as { clientId: string }[];
        return new Response(JSON.stringify({ results: sent.map((j) => ({ jobId: j.clientId, source: 'job', score: 0.5, matchedKeywords: [], breakdown: {}, gaps: [] })) }), { status: 200 }) as any;
      });

    it('sends bounded chunks and returns every posting', async () => {
      const fetchMock = echo();
      const results = await service.scoreProfileBatch(profile as any, jobs(60) as any, []);
      expect(results.size).toBe(60);
      expect(fetchMock.mock.calls.map(([, init]: any) => JSON.parse(init.body).jobs.length)).toEqual([25, 25, 10]);
    });

    it('stops at the first failed chunk instead of queuing more work on a failing scorer', async () => {
      const fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
      const results = await service.scoreProfileBatch(profile as any, jobs(60) as any, []);
      expect(results.size).toBe(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('keeps the results of chunks that finished before the failure, so the caller can see how far it got', async () => {
      let call = 0;
      jest.spyOn(global, 'fetch').mockImplementation(async (_url: any, init: any) => {
        if (++call === 2) throw new TypeError('fetch failed');
        const sent = JSON.parse(init.body).jobs as { clientId: string }[];
        return new Response(JSON.stringify({ results: sent.map((j) => ({ jobId: j.clientId, source: 'job', score: 0.5, matchedKeywords: [], breakdown: {}, gaps: [] })) }), { status: 200 }) as any;
      });
      jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
      const results = await service.scoreProfileBatch(profile as any, jobs(60) as any, []);
      expect(results.size).toBe(25);
      expect(call).toBe(2);
    });
  });
});

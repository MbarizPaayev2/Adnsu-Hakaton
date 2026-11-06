import { describe, it, expect, vi } from 'vitest';
import {
  syncCareerEntriesToBackend,
  parsePeriod,
  parsePeriodStrict,
  parseSingleDate,
  formatPeriod,
  formatSingleDate,
  careerEntriesToEvidenceState,
  CareerEvidenceState,
  BackendCareerEntry,
} from './career-evidence';

describe('career-evidence: Date parsing and formatting', () => {
  it('parses year-only periods and formats them with precision YEAR', () => {
    const parsed = parsePeriod('2022 - 2024');
    expect(parsed).toEqual({
      startDate: '2022-01-01',
      endDate: '2024-01-01',
      current: false,
      datePrecision: 'YEAR',
    });

    const formatted = formatPeriod(parsed!.startDate, parsed!.endDate, parsed!.current, parsed!.datePrecision);
    expect(formatted).toBe('2022 - 2024');
  });

  it('parses month-year periods and formats them with precision MONTH', () => {
    const parsed = parsePeriod('03/2021 - 11/2023');
    expect(parsed).toEqual({
      startDate: '2021-03-01',
      endDate: '2023-11-01',
      current: false,
      datePrecision: 'MONTH',
    });

    const formatted = formatPeriod(parsed!.startDate, parsed!.endDate, parsed!.current, parsed!.datePrecision);
    expect(formatted).toBe('2021-03 - 2023-11');
  });

  it('handles current / ongoing periods', () => {
    const parsed = parsePeriod('2023 - indiki');
    expect(parsed).toEqual({
      startDate: '2023-01-01',
      endDate: null,
      current: true,
      datePrecision: 'YEAR',
    });

    const formatted = formatPeriod(parsed!.startDate, parsed!.endDate, parsed!.current, parsed!.datePrecision);
    expect(formatted).toBe('2023 - Davam edir');
  });

  it('parses single dates (e.g. for certifications and awards)', () => {
    const parsedYear = parseSingleDate('2024');
    expect(parsedYear).toEqual({
      issuedAt: '2024-01-01',
      datePrecision: 'YEAR',
    });
    expect(formatSingleDate(parsedYear!.issuedAt, parsedYear!.datePrecision)).toBe('2024');

    const parsedMonth = parseSingleDate('05/2023');
    expect(parsedMonth).toEqual({
      issuedAt: '2023-05-01',
      datePrecision: 'MONTH',
    });
    expect(formatSingleDate(parsedMonth!.issuedAt, parsedMonth!.datePrecision)).toBe('2023-05');
  });
});

describe('career-evidence: syncCareerEntriesToBackend defect fixes', () => {
  it('preserves undisplayed STORY and OTHER entries and NEVER deletes them', async () => {
    const existingEntries: BackendCareerEntry[] = [
      {
        id: 'story-1',
        kind: 'STORY',
        origin: 'USER_ADDED',
        title: 'Lead Architect Incident Story',
        organization: 'Kapital Bank',
        role: 'Tech Lead',
        situation: 'Core banking outage during peak hours',
        action: 'Implemented failover circuit breaker',
        result: 'Recovered service within 90 seconds',
        status: 'CONFIRMED',
      },
      {
        id: 'other-1',
        kind: 'OTHER',
        origin: 'USER_ADDED',
        title: 'Patent Submission',
        organization: 'Intellectual Property Agency',
        description: 'Novel encryption method',
        status: 'CONFIRMED',
      },
      {
        id: 'proj-1',
        kind: 'PROJECT',
        origin: 'USER_ADDED',
        title: 'Existing Web App',
        organization: 'Startup',
        status: 'CONFIRMED',
      },
    ];

    const current: CareerEvidenceState = {
      projects: [
        {
          id: 'proj-1',
          name: 'Existing Web App',
          period: '2024',
          description: 'Updated description',
          confirmed: true,
          source: 'USER',
        },
      ],
      volunteering: [],
      certifications: [],
      languages: [],
      awards: [],
      deletedEntryIds: [], // User has NOT deleted story-1 or other-1
    };

    const mockApiFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/profile/career-entries/proj-1' && init?.method === 'PATCH') {
        return { ok: true, json: async () => ({ id: 'proj-1' }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    await syncCareerEntriesToBackend(current, existingEntries, mockApiFetch as any);

    // Verify: DELETE must NEVER be called for story-1 or other-1
    const deleteCalls = mockApiFetch.mock.calls.filter((call) => call[1]?.method === 'DELETE');
    expect(deleteCalls).toHaveLength(0);
  });

  it('deletes ONLY entries explicitly present in deletedEntryIds', async () => {
    const existingEntries: BackendCareerEntry[] = [
      {
        id: 'award-to-delete',
        kind: 'AWARD',
        origin: 'USER_ADDED',
        title: 'Best Hacker 2020',
        status: 'CONFIRMED',
      },
      {
        id: 'award-to-keep',
        kind: 'AWARD',
        origin: 'USER_ADDED',
        title: 'Innovator 2024',
        status: 'CONFIRMED',
      },
    ];

    const current: CareerEvidenceState = {
      projects: [],
      volunteering: [],
      certifications: [],
      languages: [],
      awards: [
        {
          id: 'award-to-keep',
          title: 'Innovator 2024',
          date: '2024',
          issuer: 'AzInTelecom',
          confirmed: true,
          source: 'USER',
        },
      ],
      deletedEntryIds: ['award-to-delete'],
    };

    const mockApiFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/profile/career-entries/award-to-delete' && init?.method === 'DELETE') {
        return { ok: true, json: async () => ({ success: true }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    await syncCareerEntriesToBackend(current, existingEntries, mockApiFetch as any);

    const deleteCalls = mockApiFetch.mock.calls.filter((call) => call[1]?.method === 'DELETE');
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0][0]).toBe('/profile/career-entries/award-to-delete');
  });

  it('preserves fields outside editor scope (situation, action, result, original kind, url) when updating', async () => {
    const existingEntries: BackendCareerEntry[] = [
      {
        id: 'proj-rich-1',
        kind: 'PROJECT',
        origin: 'USER_ADDED',
        title: 'Complex Banking Gateway',
        organization: 'Pasha Bank',
        role: 'Senior Engineer',
        situation: 'Legacy payment processing bottleneck',
        action: 'Migrated to reactive streaming architecture',
        result: 'Handled 5x transactions per second',
        url: 'https://github.com/example/gateway',
        alwaysInclude: true,
        sortOrder: 1,
        startDate: '2023-01-01T00:00:00.000Z',
        endDate: '2023-12-01T00:00:00.000Z',
        datePrecision: 'MONTH',
        status: 'CONFIRMED',
      },
    ];

    const current: CareerEvidenceState = {
      projects: [
        {
          id: 'proj-rich-1',
          name: 'Complex Banking Gateway',
          period: '2023 - 2024', // Edited period
          description: 'Updated description for gateway',
          confirmed: true,
          source: 'USER',
        },
      ],
      volunteering: [],
      certifications: [],
      languages: [],
      awards: [],
      deletedEntryIds: [],
    };

    let patchedPayload: any = null;
    const mockApiFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/profile/career-entries/proj-rich-1' && init?.method === 'PATCH') {
        patchedPayload = JSON.parse(String(init?.body));
        return { ok: true, json: async () => ({ id: 'proj-rich-1', ...patchedPayload }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    await syncCareerEntriesToBackend(current, existingEntries, mockApiFetch as any);

    expect(patchedPayload).toBeDefined();
    // Preserved fields
    expect(patchedPayload.situation).toBe('Legacy payment processing bottleneck');
    expect(patchedPayload.action).toBe('Migrated to reactive streaming architecture');
    expect(patchedPayload.result).toBe('Handled 5x transactions per second');
    expect(patchedPayload.url).toBe('https://github.com/example/gateway');
    expect(patchedPayload.alwaysInclude).toBe(true);
    expect(patchedPayload.sortOrder).toBe(1);
    expect(patchedPayload.role).toBe('Senior Engineer');
    // Updated fields
    expect(patchedPayload.description).toBe('Updated description for gateway');
    expect(patchedPayload.startDate).toBe('2023-01-01');
    expect(patchedPayload.endDate).toBe('2024-01-01');
    expect(patchedPayload.datePrecision).toBe('YEAR');
  });

  it('safely handles 409 twin conflict on POST and checks PATCH response in conflict branch', async () => {
    const existingEntries: BackendCareerEntry[] = [];

    const current: CareerEvidenceState = {
      projects: [
        {
          id: 'temp-id-99',
          name: 'Microservice Gateway',
          period: '2024',
          description: 'High throughput gateway',
          confirmed: true,
          source: 'USER',
        },
      ],
      volunteering: [],
      certifications: [],
      languages: [],
      awards: [],
    };

    let patchCalled = false;
    const mockApiFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/profile/career-entries' && init?.method === 'POST') {
        // Return 409 conflict pointing to existing twin
        return {
          ok: false,
          status: 409,
          json: async () => ({
            message: 'Duplicate entry',
            existingId: 'real-twin-123',
          }),
        };
      }
      if (url === '/profile/career-entries/real-twin-123' && init?.method === 'PATCH') {
        patchCalled = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'real-twin-123' }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    await syncCareerEntriesToBackend(current, existingEntries, mockApiFetch as any);

    expect(patchCalled).toBe(true);
    // Verified item id was reconciled to existing twin
    expect(current.projects[0].id).toBe('real-twin-123');
  });

  it('throws error if PATCH response fails during 409 conflict resolution', async () => {
    const current: CareerEvidenceState = {
      projects: [
        {
          id: 'temp-id-100',
          name: 'Failing Gateway',
          period: '',
          description: '',
          confirmed: true,
          source: 'USER',
        },
      ],
      volunteering: [],
      certifications: [],
      languages: [],
      awards: [],
    };

    const mockApiFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/profile/career-entries' && init?.method === 'POST') {
        return {
          ok: false,
          status: 409,
          json: async () => ({ existingId: 'conflict-id-456' }),
        };
      }
      if (url === '/profile/career-entries/conflict-id-456' && init?.method === 'PATCH') {
        return {
          ok: false,
          status: 500,
          json: async () => ({ message: 'Database write error' }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    await expect(syncCareerEntriesToBackend(current, [], mockApiFetch as any)).rejects.toThrow(
      'Database write error',
    );
  });
});

describe('career-evidence: periods are read exactly or refused, never guessed', () => {
  it('round-trips every period the editor itself displays (month ranges, year ranges, open-ended, single dates)', () => {
    for (const [start, end, current, precision] of [
      ['2022-05-01', '2023-01-01', false, 'MONTH'],
      ['2022-01-01', '2024-01-01', false, 'YEAR'],
      ['2023-09-01', null, true, 'MONTH'],
      ['2021-01-01', null, true, 'YEAR'],
      ['2020-01-01', null, false, 'YEAR'],
      ['2020-03-01', null, false, 'MONTH'],
    ] as const) {
      const text = formatPeriod(start, end, current, precision);
      const parsed = parsePeriodStrict(text);
      expect(parsed, text).toEqual({ ok: true, value: { startDate: start, endDate: end, current, datePrecision: precision } });
    }
  });

  it('accepts the usual ways of typing a range', () => {
    for (const [text, start, end, precision] of [
      ['2022-2024', '2022-01-01', '2024-01-01', 'YEAR'],
      ['2022 – 2024', '2022-01-01', '2024-01-01', 'YEAR'],
      ['05/2022 - 01/2023', '2022-05-01', '2023-01-01', 'MONTH'],
      ['2022.05 — 2023.01', '2022-05-01', '2023-01-01', 'MONTH'],
    ] as const) {
      expect(parsePeriodStrict(text), text).toEqual({ ok: true, value: { startDate: start, endDate: end, current: false, datePrecision: precision } });
    }
    expect(parsePeriodStrict('')).toEqual({ ok: true, value: null });
  });

  it('refuses mixed precision instead of inventing a month, an unreadable text, a reversed range and an impossible month', () => {
    for (const text of ['2022 - 2023-05', '2022-05 - 2024', 'keçən il', '2022 - tezliklə', '2024 - 2022', '13/2022', '2022 - 2023 - 2024']) {
      const r = parsePeriodStrict(text);
      expect(r.ok, text).toBe(false);
    }
    expect((parsePeriodStrict('2022 - 2023-05') as { error: string }).error).toContain('eyni dəqiqlikdə');
  });

  it('stops the whole save BEFORE any request when one edited period cannot be read, naming the entry', async () => {
    const existing: BackendCareerEntry[] = [
      { id: 'p1', kind: 'PROJECT', origin: 'EXTRACTED', status: 'CONFIRMED', title: 'Panel', startDate: '2022-05-01', endDate: '2023-01-01', datePrecision: 'MONTH' },
      { id: 'p2', kind: 'PROJECT', origin: 'EXTRACTED', status: 'CONFIRMED', title: 'Portal', startDate: '2020-01-01', datePrecision: 'YEAR' },
    ];
    const state = careerEntriesToEvidenceState(existing);
    state.projects[0].description = 'Yenilənmiş təsvir'; // valid edit that would be sent
    state.projects[1].period = 'keçən il'; // unreadable
    const api = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ entries: existing }) });
    await expect(syncCareerEntriesToBackend(state, existing, api as any)).rejects.toThrow(/Portal.*Dövr formatı/);
    expect(api).not.toHaveBeenCalled();
  });

  it('sends a month-precision range edited in the same format as displayed without turning it into a year', async () => {
    const existing: BackendCareerEntry[] = [{ id: 'p1', kind: 'PROJECT', origin: 'EXTRACTED', status: 'CONFIRMED', title: 'Panel', startDate: '2022-05-01', endDate: '2023-01-01', datePrecision: 'MONTH' }];
    const state = careerEntriesToEvidenceState(existing);
    state.projects[0].period = '2022-05 - 2023-02';
    const api = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => (init?.method === 'PATCH' ? { ok: true, json: async () => ({}) } : { ok: true, json: async () => ({ entries: existing }) }));
    await syncCareerEntriesToBackend(state, existing, api as any);
    const patch = api.mock.calls.find((c) => c[1]?.method === 'PATCH')!;
    expect(JSON.parse(patch[1].body)).toMatchObject({ startDate: '2022-05-01', endDate: '2023-02-01', datePrecision: 'MONTH', current: false });
  });
});

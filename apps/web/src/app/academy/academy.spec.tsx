import React from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AcademyDashboardPage from './page';
import AcademyJoinPage from './join/[token]/page';
import AcademyStaffJoinPage from './staff-join/[token]/page';
import { apiFetch } from '@/lib/api';

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'u_staff', name: 'Rashad Advisor', email: 'advisor@holberton.az' } },
    status: 'authenticated',
  }),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: 'synthetic-invite-token' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

describe('Academy Web Views', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  describe('AcademyDashboardPage', () => {
    const mockAcademy = {
      id: 'acad_1',
      name: 'Holberton School Baku',
      slug: 'holberton-baku',
      contactEmail: 'contact@holberton.az',
      myRole: 'OWNER',
    };

    const mockCohort = {
      id: 'coh_1',
      name: 'Cohort 12 Software Engineering',
      slug: 'c12-se',
      startDate: '2026-10-01T00:00:00Z',
      endDate: '2027-04-01T00:00:00Z',
      status: 'ACTIVE',
      _count: { enrollments: 15 },
    };

    const mockKpis = {
      reportingWindow: {
        training: { start: '2026-10-01T00:00:00Z', end: '2027-04-01T00:00:00Z' },
        observation: { start: '2026-10-01T00:00:00Z', end: '2027-06-30T00:00:00Z' },
        asOf: '2026-10-26T00:00:00Z',
        preEnrollmentActivity: 'EXCLUDED',
      },
      metrics: {
        eligibleStudents: { value: 12, status: 'MEASURED', unit: 'students', denominator: { value: 12, unit: 'students', label: 'Eligible' }, definition: 'Eligible students', provenance: ['AcademyEnrollment'] },
        applicants: { value: 9, status: 'MEASURED', unit: 'students', denominator: { value: 12, unit: 'students', label: 'Eligible' }, definition: 'Applicants', provenance: ['Application'] },
        submittedApplications: { value: 34, status: 'MEASURED', unit: 'applications', denominator: { value: 12, unit: 'students', label: 'Eligible' }, definition: 'Submitted', provenance: ['Application'] },
        preparedStudents: { value: 10, status: 'MEASURED', unit: 'students', denominator: { value: 12, unit: 'students', label: 'Eligible' }, definition: 'Prepared', provenance: ['Resume'] },
        interviewedStudents: { value: 5, status: 'MEASURED', unit: 'students', denominator: { value: 12, unit: 'students', label: 'Eligible' }, definition: 'Interviewed', provenance: ['CandidateOutcome'] },
        studentsWithOffers: { value: 2, status: 'MEASURED', unit: 'students', denominator: { value: 12, unit: 'students', label: 'Eligible' }, definition: 'Offers', provenance: ['CandidateOutcome'] },
        acceptedOffers: { value: 1, status: 'MEASURED', unit: 'students', denominator: { value: 12, unit: 'students', label: 'Eligible' }, definition: 'Accepted', provenance: ['CandidateOutcome'] },
        studentsStartedWork: { value: null, status: 'NOT_YET_REPORTED', unit: 'students', denominator: { value: 12, unit: 'students', label: 'Eligible' }, definition: 'Started', provenance: ['CandidateOutcome'] },
        medianDaysToFirstApplication: { value: 6, status: 'MEASURED', unit: 'days', denominator: { value: 9, unit: 'students', label: 'Applicants' }, definition: 'Median days', provenance: ['Application'] },
      },
      dataCompleteness: {
        studentsWithReportedOutcomes: 6,
        completenessPct: 50,
        status: 'MEASURED',
        definition: 'Nəticələr barədə məlumat verən tələbələrin payı.',
      },
      dateRange: { start: '2026-10-01', end: '2027-04-01' },
      cohortId: 'coh_1',
      cohortName: 'Cohort 12 Software Engineering',
      enrolledTotal: 15,
      activeConsented: 12,
      preparation: {
        activeStudents: 10,
        totalDocumentsPrepared: 18,
        definition: 'Kohort müddətində ən az bir CV və ya motivasiya məktubu hazırlayan tələbələr.',
      },
      applications: {
        totalSubmitted: 34,
        distinctStudentsApplied: 9,
        byChannel: { native: 14, external: 12, email: 8, browserAgent: 0, manualTracker: 0 },
        definition: 'Bütün kanallar üzrə göndərilən müraciətlər.',
      },
      funnel: {
        applied: 34,
        interviews: { count: 5, employerConfirmed: 3, candidateReported: 2, ratePct: 15, definition: 'Müsahibələr.' },
        offers: { count: 2, employerConfirmed: 2, candidateReported: 0, ratePct: 6, definition: 'Təkliflər.' },
        hires: { count: 0, status: 'NOT_YET_REPORTED', employerConfirmed: 0, candidateReported: 0, ratePct: null, definition: 'İşə qəbullar.' },
      },
      timeToFirstApplicationDays: {
        medianDays: 6,
        definition: 'İlk müraciətə qədər olan orta gün sayı.',
        status: 'MEASURED',
      },
    };

    const mockStudents = [
      {
        id: 'enr_1',
        invitedEmail: 'student1@holberton.az',
        status: 'ACTIVE',
        joinedAt: '2026-10-02T10:00:00Z',
        studentName: 'Nihad Əliyev',
        consentActive: true,
        consentStatus: 'ACTIVE',
        consentScope: 'IDENTIFIABLE_ROSTER',
        identityExposed: true,
      },
      {
        id: 'enr_2',
        invitedEmail: null,
        status: 'INVITED',
        consentActive: false,
        consentStatus: 'NONE',
        identityExposed: false,
      },
    ];

    it('renders workspace, cohort selector, aggregate KPIs, and privacy-protected roster', async () => {
      vi.mocked(apiFetch).mockImplementation((path: string) => {
        if (path === '/academies') {
          return Promise.resolve(new Response(JSON.stringify([mockAcademy]), { status: 200 }));
        }
        if (path === '/academies/acad_1/cohorts') {
          return Promise.resolve(new Response(JSON.stringify([mockCohort]), { status: 200 }));
        }
        if (path.includes('/kpis')) {
          return Promise.resolve(new Response(JSON.stringify(mockKpis), { status: 200 }));
        }
        if (path.includes('/students')) {
          return Promise.resolve(new Response(JSON.stringify(mockStudents), { status: 200 }));
        }
        return Promise.resolve(new Response('{}', { status: 200 }));
      });

      render(<AcademyDashboardPage />);

      // Workspace header
      expect(await screen.findByText('Holberton School Baku')).toBeDefined();
      expect(screen.getByText('Sahib')).toBeDefined();
      expect(await screen.findByText('Status: Aktiv')).toBeDefined();

      // Compact KPI cards lead with unique students and label event counts separately.
      expect(await screen.findByText('9 tələbə')).toBeDefined();
      expect(screen.getByText('34 təsdiqlənmiş göndəriş')).toBeDefined();
      expect(screen.getAllByText('5 tələbə').length).toBeGreaterThan(0);

      expect(screen.getAllByText('Hesabat verilməyib').length).toBeGreaterThan(0);

      // Roster privacy protection note and student list
      expect(screen.getByText(/Ad və e-poçt yalnız ayrıca razılıqla görünür/)).toBeDefined();
      expect(screen.getAllByText('student1@holberton.az')).toHaveLength(2); // desktop table + mobile card
      expect(screen.getAllByText(/Anonim tələbə/).length).toBeGreaterThan(0);
      expect(screen.getAllByText('Razılıq aktivdir')).toHaveLength(2);
    });

    it('clears the previous academy roster and report immediately when switching workspaces', async () => {
      const secondAcademy = { ...mockAcademy, id: 'acad_2', name: 'Code Academy' };
      const paths: string[] = [];
      vi.mocked(apiFetch).mockImplementation((path: string) => {
        paths.push(path);
        if (path === '/academies') return Promise.resolve(new Response(JSON.stringify([mockAcademy, secondAcademy]), { status: 200 }));
        if (path === '/academies/acad_1/cohorts') return Promise.resolve(new Response(JSON.stringify([mockCohort]), { status: 200 }));
        if (path === '/academies/acad_2/cohorts') return Promise.resolve(new Response('[]', { status: 200 }));
        if (path.includes('/kpis')) return Promise.resolve(new Response(JSON.stringify(mockKpis), { status: 200 }));
        if (path.includes('/students')) return Promise.resolve(new Response(JSON.stringify(mockStudents), { status: 200 }));
        return Promise.resolve(new Response('{}', { status: 200 }));
      });

      render(<AcademyDashboardPage />);
      expect(await screen.findAllByText('student1@holberton.az')).toHaveLength(2);
      fireEvent.change(screen.getByRole('combobox', { name: 'Akademiya seçin' }), { target: { value: 'acad_2' } });
      expect(await screen.findByText('Code Academy')).toBeDefined();
      expect(await screen.findByText('İlk kohortunuzu yaradın')).toBeDefined();
      expect(screen.queryAllByText('student1@holberton.az')).toHaveLength(0);
      expect(paths).not.toContain('/academies/acad_2/cohorts/coh_1/kpis');
    });

    it('shows a focused first-cohort state when the academy has no cohorts', async () => {
      vi.mocked(apiFetch).mockImplementation((path: string) => {
        if (path === '/academies') return Promise.resolve(new Response(JSON.stringify([mockAcademy]), { status: 200 }));
        if (path === '/academies/acad_1/cohorts') return Promise.resolve(new Response('[]', { status: 200 }));
        return Promise.resolve(new Response('{}', { status: 200 }));
      });

      render(<AcademyDashboardPage />);
      expect(await screen.findByText('İlk kohortunuzu yaradın')).toBeDefined();
      expect(screen.getByRole('button', { name: /Kohort yarat/ })).toBeDefined();
      expect(screen.queryByText('Karyera nəticələri')).toBeNull();
    });

    it('shows aggregate sponsor seat utilization without exposing student identities', async () => {
      vi.mocked(apiFetch).mockImplementation((path: string) => {
        if (path === '/academies') return Promise.resolve(new Response(JSON.stringify([mockAcademy]), { status: 200 }));
        if (path === '/academies/acad_1/sponsorship') return Promise.resolve(new Response(JSON.stringify({
          id: 'sponsor_1', academyId: 'acad_1', academyName: 'Holberton School Baku', plan: 'PLUS', status: 'ACTIVE',
          startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-11-30T00:00:00Z', seatCapacity: 30, usedSeats: 12, availableSeats: 18,
        }), { status: 200 }));
        if (path === '/academies/acad_1/cohorts') return Promise.resolve(new Response('[]', { status: 200 }));
        return Promise.resolve(new Response('{}', { status: 404 }));
      });

      render(<AcademyDashboardPage />);

      expect(await screen.findByText('12 / 30 istifadə olunub')).toBeDefined();
      expect(screen.getByText(/18 boş yer/)).toBeDefined();
      expect(screen.queryByText('student@example.az')).toBeNull();
    });

    it('offers retry after a cohort report request fails', async () => {
      let kpiRequests = 0;
      vi.mocked(apiFetch).mockImplementation((path: string) => {
        if (path === '/academies') return Promise.resolve(new Response(JSON.stringify([mockAcademy]), { status: 200 }));
        if (path === '/academies/acad_1/cohorts') return Promise.resolve(new Response(JSON.stringify([mockCohort]), { status: 200 }));
        if (path.includes('/kpis') && ++kpiRequests === 1) return Promise.resolve(new Response('{}', { status: 503 }));
        if (path.includes('/kpis')) return Promise.resolve(new Response(JSON.stringify(mockKpis), { status: 200 }));
        if (path.includes('/students')) return Promise.resolve(new Response(JSON.stringify(mockStudents), { status: 200 }));
        return Promise.resolve(new Response('{}', { status: 200 }));
      });

      render(<AcademyDashboardPage />);
      expect(await screen.findByText(/Kohort hesabatını yükləmək mümkün olmadı/)).toBeDefined();
      fireEvent.click(screen.getByRole('button', { name: 'Yenilə' }));
      expect(await screen.findByText('9 tələbə')).toBeDefined();
      expect(kpiRequests).toBe(2);
    });

    it('renders suppressed metrics as hidden instead of zero', async () => {
      const mockSuppressedKpis = {
        ...mockKpis,
        isSuppressed: true,
        suppressionReason: 'Az sayda iştirakçıya aid göstəricilər gizlədilir; bu minimum hədd anonimliyə zəmanət vermir.',
        metrics: {
          ...mockKpis.metrics,
          applicants: { ...mockKpis.metrics.applicants, value: null, status: 'SUPPRESSED', denominator: { value: null, unit: 'students', label: 'Hidden' } },
          interviewedStudents: { ...mockKpis.metrics.interviewedStudents, value: null, status: 'SUPPRESSED', denominator: { value: null, unit: 'students', label: 'Hidden' } },
          studentsWithOffers: { ...mockKpis.metrics.studentsWithOffers, value: null, status: 'NOT_YET_REPORTED', denominator: { value: 12, unit: 'students', label: 'Eligible' } },
          studentsStartedWork: { ...mockKpis.metrics.studentsStartedWork, value: null, status: 'SUPPRESSED', denominator: { value: null, unit: 'students', label: 'Hidden' } },
        },
        dataCompleteness: {
          studentsWithReportedOutcomes: null,
          completenessPct: null,
          status: 'INSUFFICIENT_DATA',
          definition: 'Tələbə məxfiliyini qorumaq üçün nəticələr ən azı 5 fərqli tələbə töhfə verdikdə göstərilir.',
        },
        funnel: {
          applied: 34,
          interviews: { count: 0, status: 'INSUFFICIENT_DATA', employerConfirmed: 0, candidateReported: 0, ratePct: null, definition: 'Müsahibələr.' },
          offers: { count: 0, status: 'INSUFFICIENT_DATA', employerConfirmed: 0, candidateReported: 0, ratePct: null, definition: 'Təkliflər.' },
          hires: { count: 0, status: 'INSUFFICIENT_DATA', employerConfirmed: 0, candidateReported: 0, ratePct: null, definition: 'İşə qəbullar.' },
        },
        timeToFirstApplicationDays: {
          medianDays: null,
          definition: 'İlk müraciətə qədər olan orta gün sayı.',
          status: 'INSUFFICIENT_DATA',
        },
      };

      vi.mocked(apiFetch).mockImplementation((path: string) => {
        if (path === '/academies') {
          return Promise.resolve(new Response(JSON.stringify([mockAcademy]), { status: 200 }));
        }
        if (path === '/academies/acad_1/cohorts') {
          return Promise.resolve(new Response(JSON.stringify([mockCohort]), { status: 200 }));
        }
        if (path.includes('/kpis')) {
          return Promise.resolve(new Response(JSON.stringify(mockSuppressedKpis), { status: 200 }));
        }
        if (path.includes('/students')) {
          return Promise.resolve(new Response(JSON.stringify(mockStudents), { status: 200 }));
        }
        return Promise.resolve(new Response('{}', { status: 200 }));
      });

      render(<AcademyDashboardPage />);

      expect(await screen.findAllByText('Göstərilmir')).toHaveLength(3);
      expect(screen.getByText(/bu minimum hədd anonimliyə zəmanət vermir/)).toBeDefined();
    });

    it('shows newly created student links and clearly says email was not sent', async () => {
      let inviteAttempts = 0;
      vi.mocked(apiFetch).mockImplementation((path: string, options?: RequestInit) => {
        if (path === '/academies') return Promise.resolve(new Response(JSON.stringify([mockAcademy]), { status: 200 }));
        if (path === '/academies/acad_1/cohorts') return Promise.resolve(new Response(JSON.stringify([mockCohort]), { status: 200 }));
        if (path.includes('/kpis')) return Promise.resolve(new Response(JSON.stringify(mockKpis), { status: 200 }));
        if (path.includes('/students')) return Promise.resolve(new Response(JSON.stringify(mockStudents), { status: 200 }));
        if (path.endsWith('/invitations') && options?.method === 'POST' && ++inviteAttempts === 1) return Promise.resolve(new Response(JSON.stringify({ message: 'Müvəqqəti xəta' }), { status: 503 }));
        if (path.endsWith('/invitations') && options?.method === 'POST') return Promise.resolve(new Response(JSON.stringify({
          createdCount: 1, renewedCount: 0, skippedCount: 0, delivery: 'MANUAL_LINKS',
          invitations: [{ email: 'new@student.az', inviteToken: 'one-time-token', expiresAt: '2026-11-09T00:00:00.000Z', disposition: 'CREATED' }],
          skipped: [],
        }), { status: 201 }));
        return Promise.resolve(new Response('{}', { status: 200 }));
      });

      render(<AcademyDashboardPage />);
      const createButton = await screen.findByRole('button', { name: 'Keçid yarat' });
      await waitFor(() => expect(createButton).not.toBeDisabled());
      fireEvent.click(createButton);
      fireEvent.change(screen.getByLabelText(/E-poçt ünvanları/), { target: { value: 'new@student.az' } });
      fireEvent.click(screen.getByRole('button', { name: 'Keçidlər yarat' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Müvəqqəti xəta');
      expect(screen.getByLabelText(/E-poçt ünvanları/)).toHaveValue('new@student.az');
      fireEvent.click(screen.getByRole('button', { name: 'Keçidlər yarat' }));

      expect(await screen.findByText('new@student.az')).toBeDefined();
      expect(screen.getByText(/E-poçt göndərilməyib/)).toBeDefined();
      expect(screen.getByText(/one-time-token/)).toBeDefined();
    });
  });

  describe('AcademyJoinPage (Student Join & Consent)', () => {
    const mockInvitation = {
      token: 'synthetic-invite-token',
      invitedEmail: 'nihad@example.az',
      status: 'INVITED',
      academy: {
        name: 'Holberton School Baku',
        slug: 'holberton-baku',
        contactEmail: 'contact@holberton.az',
      },
      cohort: {
        name: 'Cohort 12 Software Engineering',
        slug: 'c12-se',
        description: 'Intensive full stack software engineering program.',
        startDate: '2026-10-01T00:00:00Z',
        endDate: '2027-04-01T00:00:00Z',
      },
      consentExplanation: {
        title: 'Akademiyanın görəcəyi məlumatlar',
        visibleItems: ['Kohort üzrə ümumi statistikaya daxil edilmə', 'Müraciətlərin mərhələləri üzrə anonim statuslar'],
        hiddenItems: ['Şəxsi CV və motivasiya məktublarınız', 'İşəgötürənlərlə yazışmalar və qeydlər'],
        revocationNote: 'Razılığı istənilən vaxt profil ayarlarınızdan ləğv edə bilərsiniz.',
      },
    };

    it('renders invitation details with explicit consent breakdown and accepts on click', async () => {
      vi.mocked(apiFetch).mockImplementation((path: string) => {
        if (path.includes('/academies/invitations/synthetic-invite-token/accept')) {
          return Promise.resolve(new Response(JSON.stringify({ status: 'ACTIVE' }), { status: 200 }));
        }
        if (path.includes('/academies/invitations/synthetic-invite-token')) {
          return Promise.resolve(new Response(JSON.stringify(mockInvitation), { status: 200 }));
        }
        return Promise.resolve(new Response('{}', { status: 200 }));
      });

      render(<AcademyJoinPage />);

      expect(await screen.findByText('«Holberton School Baku» kohortuna qoşulun')).toBeDefined();
      expect(screen.getByText('Cohort 12 Software Engineering')).toBeDefined();
      expect(screen.getByText('Kohort üzrə ümumi statistikaya daxil edilmə')).toBeDefined();
      expect(screen.getByText('Şəxsi CV və motivasiya məktublarınız')).toBeDefined();

      const acceptButton = screen.getByRole('button', { name: /Razıyam — Kohorta qoşul/ });
      fireEvent.click(acceptButton);

      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalledWith(
          '/academies/invitations/synthetic-invite-token/accept',
          expect.objectContaining({ method: 'POST' }),
        );
      });
      expect(await screen.findByText('Kohorta qoşuldunuz!')).toBeDefined();
    });
  });

  describe('AcademyStaffJoinPage', () => {
    it('accepts a staff invitation through the authenticated server endpoint', async () => {
      vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({ role: 'COACH' }), { status: 200 }));
      render(<AcademyStaffJoinPage />);
      fireEvent.click(await screen.findByRole('button', { name: 'Dəvəti qəbul et' }));
      await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
        '/academies/staff-invitations/synthetic-invite-token/accept',
        { method: 'POST' },
      ));
    });
  });
});

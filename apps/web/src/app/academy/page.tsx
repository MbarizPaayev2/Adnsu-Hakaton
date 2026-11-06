'use client';

import React, { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { formatAzDate } from '@/lib/format-date';
import type { AcademyCohortKpisResponse } from '@aise/shared-types';
import { AcademyOutcomes } from '@/components/academy/academy-outcomes';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import {
  Building2,
  Users,
  Calendar,
  Plus,
  ShieldCheck,
  Sparkles,
  Info,
  Copy,
  Check,
  UserPlus,
} from 'lucide-react';

interface AcademyData {
  id: string;
  name: string;
  slug: string;
  contactEmail: string;
  website?: string;
  myRole: string;
}

interface CohortData {
  id: string;
  name: string;
  slug: string;
  startDate: string;
  endDate: string;
  status: string;
  _count: { enrollments: number };
}

interface SponsorshipUsage {
  academyId: string;
  academyName: string;
  plan: string;
  status: string;
  startsAt: string;
  endsAt: string;
  seatCapacity: number;
  usedSeats: number;
  availableSeats: number;
}


interface StudentRosterItem {
  id: string;
  invitedEmail?: string | null;
  status: string;
  joinedAt?: string;
  withdrawnAt?: string;
  expiresAt?: string;
  studentName?: string | null;
  consentActive?: boolean;
  consentStatus: 'ACTIVE' | 'REVOKED' | 'NONE';
  consentScope?: string | null;
  identityExposed?: boolean;
}

function messageForError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

const academyRoleLabel = (role?: string) => ({ OWNER: 'Sahib', ADMIN: 'Administrator', COACH: 'Karyera məsləhətçisi' }[role ?? ''] ?? 'Komanda üzvü');
const cohortStatusLabel = (status: string) => ({ UPCOMING: 'Başlamayıb', ACTIVE: 'Aktiv', COMPLETED: 'Başa çatıb', ARCHIVED: 'Arxivdə' }[status] ?? 'Naməlum');
const enrollmentStatusLabel = (status: string) => ({ ACTIVE: 'Aktiv', INVITED: 'Dəvət gözləyir', WITHDRAWN: 'Çıxıb', GRADUATED: 'Məzun', EXPIRED: 'Vaxtı bitib' }[status] ?? 'Naməlum');
const consentStatusLabel = (status: string) => ({ ACTIVE: 'Razılıq aktivdir', REVOKED: 'Razılıq ləğv edilib', NONE: 'Razılıq verilməyib' }[status] ?? status);

export default function AcademyDashboardPage() {
  const { data: session, status: authStatus } = useSession();

  const [loading, setLoading] = useState(true);
  const [academies, setAcademies] = useState<AcademyData[]>([]);
  const [activeAcademyId, setActiveAcademyId] = useState<string | null>(null);
  const [cohorts, setCohorts] = useState<CohortData[]>([]);
  const [selectedCohortId, setSelectedCohortId] = useState<string | null>(null);
  const [kpis, setKpis] = useState<AcademyCohortKpisResponse | null>(null);
  const [students, setStudents] = useState<StudentRosterItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cohortLoading, setCohortLoading] = useState(false);
  const [cohortRefreshKey, setCohortRefreshKey] = useState(0);
  const [sponsorshipUsage, setSponsorshipUsage] = useState<SponsorshipUsage | null>(null);

  // Modal States
  const [showCohortModal, setShowCohortModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [cohortPending, setCohortPending] = useState(false);
  const [cohortError, setCohortError] = useState<string | null>(null);
  const [invitePending, setInvitePending] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [createdInvites, setCreatedInvites] = useState<Array<{ email: string; inviteToken: string; expiresAt: string; disposition: 'CREATED' | 'RENEWED' }>>([]);
  const [copiedInviteToken, setCopiedInviteToken] = useState<string | null>(null);
  const [staffInviteLink, setStaffInviteLink] = useState<string | null>(null);
  const [staffInviteCopied, setStaffInviteCopied] = useState(false);
  const [staffInvitePending, setStaffInvitePending] = useState(false);
  const [staffInviteError, setStaffInviteError] = useState<string | null>(null);

  // Form states
  const [newCohortName, setNewCohortName] = useState('');
  const [newCohortSlug, setNewCohortSlug] = useState('');
  const [newCohortStart, setNewCohortStart] = useState('');
  const [newCohortEnd, setNewCohortEnd] = useState('');
  const [studentEmails, setStudentEmails] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [staffRole, setStaffRole] = useState('COACH');
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  useEffect(() => {
    const isOpen = showCohortModal || showInviteModal || showStaffModal;
    if (!isOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const getFocusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ) || []);
    getFocusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowCohortModal(false);
        setShowInviteModal(false);
        setShowStaffModal(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const items = getFocusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [showCohortModal, showInviteModal, showStaffModal]);


  // 1. Load user's academies
  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) return;

    let active = true;
    apiFetch('/academies')
      .then(async (res) => {
        if (!res.ok) throw new Error('Akademiyalar yüklənə bilmədi');
        return res.json();
      })
      .then((data: AcademyData[]) => {
        if (!active) return;
        setAcademies(data);
        if (data.length > 0) {
          setActiveAcademyId(data[0].id);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setError(err.message || 'Xəta baş verdi');
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [session, authStatus]);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (!active || !activeAcademyId) return null;
      return apiFetch(`/academies/${activeAcademyId}/sponsorship`);
    }).then(async (response) => {
      if (!active || !response?.ok) {
        if (active) setSponsorshipUsage(null);
        return;
      }
      const data = await response.json();
      if (active && data && typeof data.seatCapacity === 'number') setSponsorshipUsage(data as SponsorshipUsage);
      else if (active) setSponsorshipUsage(null);
    }).catch(() => { if (active) setSponsorshipUsage(null); });
    return () => { active = false; };
  }, [activeAcademyId]);

  // 2. Load cohorts when academy changes
  useEffect(() => {
    if (!activeAcademyId) return;
    let active = true;

    // Clear the prior tenant's data before the next request so a slow response can never leave another academy's roster visible.
    setCohorts([]);
    setSelectedCohortId(null);
    setKpis(null);
    setStudents([]);
    setError(null);

    apiFetch(`/academies/${activeAcademyId}/cohorts`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Kohortlar yüklənə bilmədi');
        return res.json();
      })
      .then((data: CohortData[]) => {
        if (!active) return;
        setKpis(null);
        setStudents([]);
        setError(null);
        setCohorts(data);
        if (data.length > 0) {
          setSelectedCohortId(data[0].id);
        } else {
          setSelectedCohortId(null);
          setKpis(null);
          setStudents([]);
        }
      })
      .catch((err) => {
        if (active) setError(err.message || 'Kohortlar yüklənə bilmədi');
      });

    return () => {
      active = false;
    };
  }, [activeAcademyId]);

  // 3. Load KPIs and students when selected cohort changes
  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return null;
      if (!activeAcademyId || !selectedCohortId) {
        setCohortLoading(false);
        return null;
      }
      setKpis(null);
      setStudents([]);
      setError(null);
      setCohortLoading(true);
      return Promise.all([
        apiFetch(`/academies/${activeAcademyId}/cohorts/${selectedCohortId}/kpis`),
        apiFetch(`/academies/${activeAcademyId}/cohorts/${selectedCohortId}/students`),
      ]);
    })
      .then((responses) => {
        if (!responses) return null;
        return responses;
      })
      .then(async (responses) => {
        if (!responses) return;
        const [kpiResponse, studentResponse] = responses;
        if (!active) return;
        if (!kpiResponse.ok || !studentResponse.ok) {
          throw new Error('Kohort hesabatını yükləmək mümkün olmadı. Yenidən cəhd edin.');
        }
        const [kpiData, studentData] = await Promise.all([kpiResponse.json(), studentResponse.json()]);
        if (!active) return;
        setKpis(kpiData);
        setStudents(studentData);
      })
      .catch((err: unknown) => {
        if (active) setError(messageForError(err, 'Kohort hesabatını yükləmək mümkün olmadı'));
      })
      .finally(() => {
        if (active) setCohortLoading(false);
      });

    return () => {
      active = false;
    };
  }, [activeAcademyId, selectedCohortId, cohortRefreshKey]);

  const handleCreateCohort = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAcademyId || cohortPending) return;

    const academyId = activeAcademyId;
    setCohortPending(true);
    setCohortError(null);
    try {
      const res = await apiFetch(`/academies/${academyId}/cohorts`, {
        method: 'POST',
        body: JSON.stringify({
          name: newCohortName,
          slug: newCohortSlug,
          startDate: new Date(newCohortStart).toISOString(),
          endDate: new Date(newCohortEnd).toISOString(),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Kohort yaradılmadı');
      }

      const created = await res.json();
      if (activeAcademyId !== academyId) return;
      setCohorts((cur) => [created, ...cur]);
      setSelectedCohortId(created.id);
      setShowCohortModal(false);
      setNewCohortName('');
      setNewCohortSlug('');
      setNewCohortStart('');
      setNewCohortEnd('');
      setActionNotice('Yeni kohort uğurla yaradıldı');
    } catch (err: unknown) {
      if (activeAcademyId === academyId) setCohortError(messageForError(err, 'Kohort yaradılmadı'));
    } finally {
      setCohortPending(false);
    }
  };

  const handleInviteStudents = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAcademyId || !selectedCohortId) return;

    const emails = studentEmails
      .split(/[\n,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const academyId = activeAcademyId;
    const cohortId = selectedCohortId;

    setInvitePending(true);
    setInviteError(null);
    try {
      const res = await apiFetch(`/academies/${academyId}/cohorts/${cohortId}/invitations`, {
        method: 'POST',
        body: JSON.stringify({ emails }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Dəvətlər göndərilmədi');
      }

      const result = await res.json();
      if (activeAcademyId !== academyId || selectedCohortId !== cohortId) return;
      setCreatedInvites(result.invitations || []);
      setActionNotice(`${result.createdCount ?? 0} yeni keçid yaradıldı; ${result.renewedCount ?? 0} dəvət yeniləndi; ${result.skippedCount ?? 0} mövcud qeyd saxlanıldı. E-poçt göndərilməyib.`);

      // Refresh student roster
      if (activeAcademyId === academyId && selectedCohortId === cohortId) {
        const studentResponse = await apiFetch(`/academies/${academyId}/cohorts/${cohortId}/students`);
        if (studentResponse.ok) setStudents(await studentResponse.json());
      }
      setStudentEmails('');
    } catch (err: unknown) {
      if (activeAcademyId === academyId && selectedCohortId === cohortId) setInviteError(messageForError(err, 'Keçid yaratmaq alınmadı'));
    } finally {
      setInvitePending(false);
    }
  };

  const copyInviteLink = async (token: string) => {
    const link = `${window.location.origin}/academy/join/${encodeURIComponent(token)}`;
    await navigator.clipboard.writeText(link);
    setCopiedInviteToken(token);
  };

  const handleInviteStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAcademyId || !canManageAcademy) return;
    const academyId = activeAcademyId;
    setStaffInvitePending(true);
    setStaffInviteError(null);
    try {
      const res = await apiFetch(`/academies/${academyId}/members/invite`, {
        method: 'POST',
        body: JSON.stringify({ email: staffEmail.trim(), role: staffRole }),
      });
      if (!res.ok) {
        const result = await res.json().catch(() => ({}));
        throw new Error(result.message || 'Dəvət keçidi yaradıla bilmədi');
      }
      const result = await res.json();
      if (activeAcademyId !== academyId) return;
      setStaffInviteLink(`${window.location.origin}/academy/staff-join/${encodeURIComponent(result.token)}`);
      setActionNotice('Koordinator üçün keçid yaradıldı. E-poçt göndərilməyib; keçidi özünüz paylaşın.');
    } catch (err: unknown) {
      if (activeAcademyId === academyId) setStaffInviteError(messageForError(err, 'Dəvət keçidi yaradıla bilmədi'));
    } finally {
      setStaffInvitePending(false);
    }
  };

  const activeAcademy = academies.find((a) => a.id === activeAcademyId);
  const activeCohort = cohorts.find((c) => c.id === selectedCohortId);
  const canManageAcademy = activeAcademy?.myRole === 'OWNER' || activeAcademy?.myRole === 'ADMIN';

  if (authStatus === 'unauthenticated') {
    return (
      <main className="min-h-screen bg-background-warm p-8 flex items-center justify-center">
        <section className="product-card max-w-lg rounded-2xl border border-primary/10 bg-surface p-8 text-center shadow-xs">
          <h1 className="text-xl font-semibold text-neutral-dark">Akademiya panelinə daxil olun</h1>
          <p className="mt-2 text-sm text-neutral-muted">Davam etmək üçün hesabınıza daxil olun.</p>
          <Link className="button-primary mt-5 inline-flex" href="/login?callbackUrl=%2Facademy">Daxil ol</Link>
        </section>
      </main>
    );
  }

  if (loading || authStatus === 'loading') {
    return (
      <div className="min-h-screen bg-background-warm p-8 flex items-center justify-center">
        <div className="product-card text-center p-8 bg-surface rounded-2xl border border-primary/10 shadow-xs">
          <Sparkles className="mx-auto h-8 w-8 text-primary animate-pulse mb-2" />
          <p className="text-sm font-semibold text-neutral-dark">Akademiya paneli yüklənir...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-background-warm p-8 flex items-center justify-center">
        <div className="product-card text-center p-8 max-w-md w-full bg-surface rounded-2xl border border-primary/15 shadow-xs">
          <Building2 className="mx-auto h-12 w-12 text-primary mb-3" />
          <h1 className="text-xl font-bold text-neutral-dark mb-2">Akademiya Girişi</h1>
          <p className="text-sm text-neutral-dark/70 mb-6">
            Kohort analitikasını və tələbə tərəqqisini görmək üçün zəhmət olmasa daxil olun.
          </p>
          <Link href="/login" className="ui-btn ui-btn-primary w-full justify-center">
            Daxil ol
          </Link>
        </div>
      </div>
    );
  }

  if (academies.length === 0) {
    return (
      <div className="min-h-screen bg-background-warm p-8 flex items-center justify-center">
        <div className="product-card text-center p-8 max-w-lg w-full bg-surface rounded-2xl border border-primary/15 shadow-xs">
          <Building2 className="mx-auto h-12 w-12 text-primary/40 mb-3" />
          <h1 className="text-xl font-bold text-neutral-dark mb-2">Akademiya iş sahəniz yoxdur</h1>
          <p className="text-sm text-neutral-dark/70 mb-6">
            AISE tələbələrinizin iş axtarışını dəstəkləyir və kohort səviyyəsində anonim hesabat təqdim edir. Pilot proqramına qoşulmaq üçün sorğu göndərə bilərsiniz.
          </p>
          <Link href="/institutions#enquiry" className="ui-btn ui-btn-primary justify-center">
            Pilot sorğusu göndərin
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background-warm text-neutral-dark pb-16">
      {/* Top Navigation Bar */}
      <header className="border-b border-primary/10 bg-surface/90 backdrop-blur-md sticky top-0 z-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 min-h-16 py-2 flex flex-col items-stretch justify-center gap-2 sm:h-16 sm:flex-row sm:items-center sm:justify-between sm:py-0">
          <div className="flex items-center gap-3">
            <Link href="/" className="font-serif text-xl font-bold text-primary">
              AISE
            </Link>
            <span className="text-neutral-dark/30">/</span>
            <div className="flex items-center gap-2">
              {academies.length > 1 ? (
                <select
                  aria-label="Akademiya seçin"
                  value={activeAcademyId || ''}
                  onChange={(e) => { setSelectedCohortId(null); setCohorts([]); setKpis(null); setStudents([]); setError(null); setActiveAcademyId(e.target.value); }}
                  className="max-w-48 rounded-lg border border-primary/15 bg-surface px-2 py-1 text-sm font-semibold text-neutral-dark"
                >
                  {academies.map((academy) => (
                    <option key={academy.id} value={academy.id}>{academy.name}</option>
                  ))}
                </select>
              ) : (
                <span className="font-semibold text-sm">{activeAcademy?.name}</span>
              )}
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary uppercase">
                {academyRoleLabel(activeAcademy?.myRole)}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => { setCreatedInvites([]); setInviteError(null); setShowInviteModal(true); }}
              disabled={!selectedCohortId}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-background px-3.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary/5 transition-colors disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Keçid yarat
            </button>
            {canManageAcademy && <button
              type="button"
              onClick={() => setShowCohortModal(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> Yeni kohort
            </button>}
            {canManageAcademy && <button type="button" onClick={() => { setStaffInviteLink(null); setStaffInviteError(null); setStaffInviteCopied(false); setShowStaffModal(true); }} className="hidden rounded-full px-3.5 py-1.5 text-xs font-semibold text-[#253B2C] hover:bg-[#E9EDDF] sm:inline-flex"><UserPlus className="mr-1 h-3.5 w-3.5" /> Koordinator dəvət et</button>}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-8 space-y-8">
        {sponsorshipUsage?.academyId === activeAcademyId && (
          <section className="rounded-xl border border-primary/10 bg-surface px-4 py-3 shadow-xs" aria-label="Sponsorlu plan yerləri">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-neutral-dark">Tələbə plan yerləri</p>
                <p className="text-xs text-neutral-dark/65">{sponsorshipUsage.plan} · {sponsorshipUsage.status === 'ENDED' ? 'Müddəti bitib' : sponsorshipUsage.status === 'PAUSED' ? 'Fasilədədir' : 'Aktivdir'} · {formatAzDate(sponsorshipUsage.endsAt)} tarixinədək · kohort sayı ayrıca yer yaratmır</p>
              </div>
              <p className="text-sm font-semibold text-primary" aria-label={`${sponsorshipUsage.usedSeats} istifadə olunan yer, ${sponsorshipUsage.availableSeats} boş yer`}>
                {sponsorshipUsage.usedSeats} / {sponsorshipUsage.seatCapacity} istifadə olunub
                <span className="ml-2 text-xs font-normal text-neutral-dark/65">{sponsorshipUsage.availableSeats} boş yer</span>
              </p>
            </div>
          </section>
        )}
        <section className="rounded-2xl border border-primary/10 bg-surface p-5 shadow-xs sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-2xl">
              <p className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-primary">Akademiyalar üçün karyera xidməti</p>
              <h1 className="text-xl font-bold tracking-tight text-neutral-dark sm:text-2xl">Təlimdən işə qədər tələbə tərəqqisi</h1>
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium text-[#253B2C]">
                <span className="rounded-full bg-[#E9EDDF] px-3 py-1.5">İş axtarışı dəstəyi</span>
                <span className="rounded-full bg-[#E9EDDF] px-3 py-1.5">Razılığa əsaslanan hesabat</span>
                <span className="rounded-full bg-[#E9EDDF] px-3 py-1.5">CV və əlaqə məlumatları gizli</span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs font-semibold text-amber-900" role="status">
              <ShieldCheck className="h-4 w-4 text-amber-700" /> Nəzarətli pilot
            </div>
          </div>
          <details className="mt-4 border-t border-primary/10 pt-3 text-xs text-neutral-dark/65">
            <summary className="w-fit cursor-pointer font-semibold text-primary">Pilot necə işləyir?</summary>
            <p className="mt-2 max-w-3xl leading-relaxed">Tələbə razılığını ləğv edə bilər. Akademiya fərdi CV, telefon və müraciət qeydlərini görmür. Sponsorlu planlar bu hesabat razılığından ayrıdır və hazırda bu paneldə idarə edilmir.</p>
            <Link href="/institutions" className="mt-2 inline-flex items-center gap-1 font-semibold text-primary hover:underline">Pilot şərtləri <span aria-hidden="true">→</span></Link>
            {canManageAcademy && <button type="button" onClick={() => { setStaffInviteLink(null); setStaffInviteError(null); setStaffInviteCopied(false); setShowStaffModal(true); }} className="mt-2 inline-flex min-h-10 items-center rounded-lg border border-[#253B2C]/20 px-3 text-xs font-semibold text-[#253B2C] sm:hidden">Koordinator dəvət et</button>}
          </details>
        </section>

        {actionNotice && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-medium text-emerald-950 flex items-center justify-between">
            <span>{actionNotice}</span>
            <button type="button" onClick={() => setActionNotice(null)} className="underline text-emerald-800">
              Bağla
            </button>
          </div>
        )}

        {/* Cohort Selector & Info Bar */}
        <div className="bg-surface rounded-2xl border border-primary/10 p-5 shadow-xs flex flex-wrap items-center justify-between gap-4">
          <div className="flex w-full min-w-0 flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3">
            <span className="text-xs font-semibold text-neutral-dark/60 uppercase tracking-wide">Kohort:</span>
            {cohorts.length > 0 ? (
              <select
                aria-label="Kohort seçin"
                value={selectedCohortId || ''}
                onChange={(e) => setSelectedCohortId(e.target.value)}
                className="w-full min-w-0 rounded-xl border border-primary/20 bg-background px-3 py-1.5 text-sm font-semibold text-neutral-dark focus:outline-hidden focus:ring-2 focus:ring-primary/40 sm:w-auto sm:max-w-[22rem]"
              >
                {cohorts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({new Date(c.startDate).getFullYear()})
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs text-neutral-dark/60">Aktiv kohort yoxdur</span>
            )}
          </div>

          {activeCohort && (
            <div className="flex items-center gap-4 text-xs text-neutral-dark/70">
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {formatAzDate(activeCohort.startDate)} – {formatAzDate(activeCohort.endDate)}
              </span>
              <span className="rounded-full bg-neutral-dark/5 px-2.5 py-1 text-[11px] font-medium text-neutral-dark/80">
                Status: {cohortStatusLabel(activeCohort.status)}
              </span>
            </div>
          )}
        </div>

        {kpis ? (
          <AcademyOutcomes report={kpis} />
        ) : cohortLoading ? (
          <div className="rounded-2xl border border-primary/10 bg-surface px-6 py-10 text-center" role="status">
            <Sparkles className="mx-auto mb-3 h-7 w-7 animate-pulse text-primary" />
            <p className="text-sm font-semibold text-neutral-dark">Kohort hesabatı yüklənir…</p>
          </div>
        ) : cohorts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-primary/25 bg-surface px-6 py-10 text-center">
            <Users className="mx-auto mb-3 h-9 w-9 text-primary/60" />
            <h2 className="text-lg font-bold text-neutral-dark">İlk kohortunuzu yaradın</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-neutral-dark/65">Proqram qrupunu yaradın, sonra tələbələri e-poçtla dəvət edin. Hesabatlar razılıq və məxfilik qaydalarına uyğun göstəriləcək.</p>
            {canManageAcademy ? <button type="button" onClick={() => setShowCohortModal(true)} className="ui-btn ui-btn-primary mt-5 justify-center"><Plus className="mr-1 h-4 w-4" /> Kohort yarat</button> : <p className="text-sm text-[#667064]">Yeni kohort yaratmaq üçün akademiya admininə müraciət edin.</p>}
          </div>
        ) : error ? (
          <div className="flex items-center justify-between gap-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => setCohortRefreshKey((key) => key + 1)} className="shrink-0 font-semibold underline">Yenilə</button>
          </div>
        ) : (
          <div className="bg-surface rounded-2xl border border-primary/10 p-8 text-center">
            <Info className="mx-auto h-8 w-8 text-neutral-dark/40 mb-2" />
            <p className="text-sm font-semibold text-neutral-dark">Kohort seçilməyib və ya məlumat yoxdur</p>
          </div>
        )}

        {selectedCohortId && (
          <div className="bg-surface rounded-2xl border border-primary/10 p-5 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-neutral-dark">Tələbələr və dəvətlər</h3>
              <p className="text-xs text-neutral-dark/60 mt-0.5">Ad və e-poçt yalnız ayrıca razılıqla görünür. Şəxsi CV və əlaqə məlumatları paylaşılmır.</p>
              <details className="mt-1 text-[11px] text-neutral-dark/60">
                <summary className="w-fit cursor-pointer font-semibold text-primary">Məxfilik qaydaları</summary>
                <p className="mt-1 max-w-2xl leading-relaxed">Razılıq verilmədikdə və ya ləğv edildikdə şəxsiyyət anonim qalır. Şəxsi CV mətnləri, telefon nömrələri və fərdi müraciət qeydləri heç bir halda akademiyaya ötürülmür.</p>
              </details>
            </div>
            <button
              type="button"
              onClick={() => { setCreatedInvites([]); setInviteError(null); setShowInviteModal(true); }}
              disabled={!selectedCohortId}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-background px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/5 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-3 w-3" /> Keçid yarat
            </button>
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-primary/10 text-neutral-dark/60">
                  <th className="py-2.5 px-3 font-semibold">Tələbə / E-poçt</th>
                  <th className="py-2.5 px-3 font-semibold">Status</th>
                  <th className="py-2.5 px-3 font-semibold">Qoşulma Tarixi</th>
                  <th className="py-2.5 px-3 font-semibold">Razılıq Statusu</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-primary/5">
                {students.map((student) => (
                  <tr key={student.id} className="hover:bg-primary/5 transition-colors">
                    <td className="py-2.5 px-3 font-medium text-neutral-dark">
                      {student.identityExposed && (student.invitedEmail || student.studentName) ? (
                        <div>
                          <span>{student.studentName || student.invitedEmail}</span>
                          {student.studentName && student.invitedEmail && (
                            <span className="block text-[10px] text-neutral-dark/50">{student.invitedEmail}</span>
                          )}
                        </div>
                      ) : (
                        <span className="italic text-neutral-dark/50">
                          {student.consentStatus === 'ACTIVE'
                            ? 'Anonim tələbə (Yalnız aqreqat razılıq)'
                            : student.consentStatus === 'REVOKED'
                              ? 'Anonim tələbə (Razılıq ləğv edilib)'
                              : 'Anonim tələbə (Razılıq gözlənilir)'}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                        student.status === 'ACTIVE'
                          ? 'bg-emerald-500/10 text-emerald-800'
                          : student.status === 'INVITED'
                            ? 'bg-amber-500/10 text-amber-800'
                            : 'bg-neutral-dark/10 text-neutral-dark/60'
                      }`}>
                        {enrollmentStatusLabel(student.status)}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-neutral-dark/70">
                      {student.joinedAt ? new Date(student.joinedAt).toLocaleDateString('az-AZ') : 'Gözlənilir'}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                        student.consentStatus === 'ACTIVE'
                          ? 'text-emerald-700'
                          : student.consentStatus === 'REVOKED'
                            ? 'text-red-700'
                            : 'text-neutral-dark/50'
                      }`}>
                        <ShieldCheck className="h-3 w-3" />
                        {consentStatusLabel(student.consentStatus)}
                      </span>
                    </td>
                  </tr>
                ))}
                {students.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-neutral-dark/50 italic">
                      Bu kohortda hələ qeydiyyatdan keçmiş tələbə yoxdur.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2 md:hidden" aria-label="Tələbə siyahısı">
            {students.map((student) => (
              <li key={student.id} className="rounded-xl border border-primary/10 bg-background-warm/50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-neutral-dark">
                      {student.identityExposed && (student.studentName || student.invitedEmail)
                        ? (student.studentName || student.invitedEmail)
                        : student.status === 'INVITED' ? 'Dəvət gözləyir' : student.status === 'EXPIRED' ? 'Dəvətin vaxtı bitib' : 'Anonim tələbə'}
                    </p>
                    {student.identityExposed && student.studentName && student.invitedEmail && <p className="break-all text-xs text-neutral-dark/60">{student.invitedEmail}</p>}
                  </div>
                  <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">{enrollmentStatusLabel(student.status)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 border-t border-primary/10 pt-2 text-xs text-neutral-dark/65">
                  <span>{student.joinedAt ? `Qoşulub ${formatAzDate(student.joinedAt)}` : 'Qoşulma gözlənilir'}</span>
                  <span>{consentStatusLabel(student.consentStatus)}</span>
                </div>
              </li>
            ))}
            {students.length === 0 && <li className="rounded-xl border border-dashed border-primary/20 p-5 text-center text-sm text-neutral-dark/60">Bu kohortda hələ tələbə yoxdur.</li>}
          </ul>
          </div>
        )}
      </main>

      {/* Create Cohort Modal */}
      {showCohortModal && (
        <div className="fixed inset-0 z-50 bg-neutral-dark/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="create-cohort-title" className="bg-surface rounded-2xl border border-primary/15 shadow-lg p-6 max-w-md w-full space-y-4">
            <h3 id="create-cohort-title" className="font-bold text-base text-neutral-dark">Yeni kohort</h3>
            <form onSubmit={handleCreateCohort} className="space-y-3">
              <div>
                <label htmlFor="academy-cohort-name" className="block text-xs font-semibold text-neutral-dark mb-1">Kohortun adı</label>
                <input
                  id="academy-cohort-name"
                  type="text"
                  required
                  placeholder="Məs. Software Engineering 2026"
                  value={newCohortName}
                  onChange={(e) => {
                    setNewCohortName(e.target.value);
                    if (!newCohortSlug) {
                      setNewCohortSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
                    }
                  }}
                  className="w-full rounded-xl border border-neutral-dark/20 bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="academy-cohort-slug" className="block text-xs font-semibold text-neutral-dark mb-1">İdentifikator (slug)</label>
                <input
                  id="academy-cohort-slug"
                  type="text"
                  required
                  placeholder="se-2026"
                  value={newCohortSlug}
                  onChange={(e) => setNewCohortSlug(e.target.value)}
                  className="w-full rounded-xl border border-neutral-dark/20 bg-background px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="academy-cohort-start" className="block text-xs font-semibold text-neutral-dark mb-1">Başlama tarixi</label>
                  <input
                    id="academy-cohort-start"
                    type="date"
                    required
                    value={newCohortStart}
                    onChange={(e) => setNewCohortStart(e.target.value)}
                    className="w-full rounded-xl border border-neutral-dark/20 bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="academy-cohort-end" className="block text-xs font-semibold text-neutral-dark mb-1">Bitmə tarixi</label>
                  <input
                    id="academy-cohort-end"
                    type="date"
                    required
                    value={newCohortEnd}
                    onChange={(e) => setNewCohortEnd(e.target.value)}
                    className="w-full rounded-xl border border-neutral-dark/20 bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {cohortError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{cohortError}</p>}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCohortModal(false)}
                  className="rounded-full px-4 py-2 text-xs font-semibold text-neutral-dark/70 hover:bg-neutral-dark/5"
                >
                  Ləğv et
                </button>
                <button
                  type="submit"
                  disabled={cohortPending}
                  className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
                >
                  {cohortPending ? 'Yaradılır…' : 'Yarat'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invite Students Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 bg-neutral-dark/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="invite-students-title" className="bg-surface rounded-2xl border border-primary/15 shadow-lg p-6 max-h-[90vh] max-w-xl w-full overflow-y-auto space-y-4">
            <h3 id="invite-students-title" className="font-bold text-base text-neutral-dark">Tələbə qoşulma keçidi</h3>
            <form onSubmit={handleInviteStudents} className="space-y-3">
              <div>
                <label htmlFor="student-invitation-emails" className="block text-xs font-semibold text-neutral-dark mb-1">
                  E-poçt ünvanları (vergüllə və ya yeni sətirdən ayırın)
                </label>
                <textarea
                  id="student-invitation-emails"
                  rows={4}
                  required
                  placeholder="student1@example.az, student2@example.az"
                  value={studentEmails}
                  onChange={(e) => setStudentEmails(e.target.value)}
                  className="w-full rounded-xl border border-neutral-dark/20 bg-background p-2.5 text-xs font-mono"
                />
              </div>
              <p className="text-[11px] text-neutral-dark/60 leading-relaxed">
                AISE e-poçt göndərmir. Keçid yaradıldıqdan sonra onu öz kanalınızla paylaşın. Tələbə hesabla daxil olub razılıq seçimini özü edir.
              </p>
              {inviteError && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{inviteError}</p>}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowInviteModal(false); setCreatedInvites([]); }}
                  className="rounded-full px-4 py-2 text-xs font-semibold text-neutral-dark/70 hover:bg-neutral-dark/5"
                >
                  Ləğv et
                </button>
                <button
                  type="submit"
                  disabled={invitePending}
                  className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary-hover"
                >
                  {invitePending ? 'Keçidlər yaradılır…' : 'Keçidlər yarat'}
                </button>
              </div>
            </form>
            {createdInvites.length > 0 && <section aria-label="Yaradılmış qoşulma keçidləri" className="space-y-2 border-t border-[#DCE0D5] pt-4">
              <h4 className="text-sm font-semibold text-[#232A24]">Paylaşmağa hazır keçidlər</h4>
              {createdInvites.map((invite) => {
                const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/academy/join/${encodeURIComponent(invite.inviteToken)}`;
                return <div key={invite.inviteToken} className="rounded-xl border border-[#DCE0D5] bg-[#F6F7F0] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div><p className="text-sm font-medium text-[#232A24]">{invite.email}</p><p className="text-xs text-[#667064]">{invite.disposition === 'CREATED' ? 'Yeni keçid' : 'Yenilənmiş keçid'} · bitmə tarixi {new Date(invite.expiresAt).toLocaleDateString('az-AZ')}</p></div>
                    <button type="button" onClick={() => copyInviteLink(invite.inviteToken).catch(() => setInviteError('Linki avtomatik köçürmək olmadı; mətni seçib köçürün.'))} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#253B2C] px-3 text-xs font-semibold text-[#253B2C]">
                      {copiedInviteToken === invite.inviteToken ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copiedInviteToken === invite.inviteToken ? 'Köçürüldü' : 'Linki köçür'}
                    </button>
                  </div>
                  <p className="mt-2 break-all rounded-md bg-white px-2 py-1.5 font-mono text-[11px] text-[#667064]">{url}</p>
                </div>;
              })}
            </section>}
          </div>
        </div>
      )}

      {showStaffModal && canManageAcademy && (
        <div className="fixed inset-0 z-50 bg-neutral-dark/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="invite-staff-title" className="bg-surface rounded-2xl border border-primary/15 shadow-lg p-6 max-w-md w-full space-y-4">
            <h3 id="invite-staff-title" className="font-bold text-base text-neutral-dark">Koordinator dəvət et</h3>
            <form onSubmit={handleInviteStaff} className="space-y-3">
              <label className="block text-xs font-semibold text-neutral-dark">E-poçt
                <input required type="email" value={staffEmail} onChange={(e) => setStaffEmail(e.target.value)} className="mt-1 w-full rounded-xl border border-neutral-dark/20 bg-background px-3 py-2 text-sm" />
              </label>
              <label className="block text-xs font-semibold text-neutral-dark">Rol
                <select value={staffRole} onChange={(e) => setStaffRole(e.target.value)} className="mt-1 w-full rounded-xl border border-neutral-dark/20 bg-background px-3 py-2 text-sm"><option value="COACH">Koordinator</option><option value="ADMIN">Admin</option></select>
              </label>
              <p className="text-xs text-[#667064]">Keçid yaradılır, e-poçt göndərilmir. Admin dəvətini yalnız sahibi qəbul edə bilər.</p>
              {staffInviteError && <p role="alert" className="text-sm text-red-800">{staffInviteError}</p>}
              {staffInviteLink && <div className="space-y-2 rounded-lg bg-[#F6F7F0] p-3"><p className="break-all font-mono text-xs">{staffInviteLink}</p><button type="button" onClick={() => navigator.clipboard.writeText(staffInviteLink).then(() => setStaffInviteCopied(true)).catch(() => setStaffInviteError('Linki avtomatik köçürmək olmadı; mətni seçib köçürün.'))} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#253B2C] px-3 text-xs font-semibold text-[#253B2C]"><Copy className="h-4 w-4" />{staffInviteCopied ? 'Köçürüldü' : 'Linki köçür'}</button></div>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowStaffModal(false)} className="rounded-full px-4 py-2 text-xs font-semibold text-neutral-dark/70">Bağla</button>
                <button type="submit" disabled={staffInvitePending} className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{staffInvitePending ? 'Hazırlanır…' : 'Dəvət linki yarat'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

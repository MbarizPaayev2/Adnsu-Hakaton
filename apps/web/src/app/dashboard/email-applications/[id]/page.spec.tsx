import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import EmailApplicationPage from './page';

const { apiFetch, downloadAuthedFile } = vi.hoisted(() => ({ apiFetch: vi.fn(), downloadAuthedFile: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiFetch, downloadAuthedFile }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const props = { params: Promise.resolve({ id: 'ea-1' }) };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const view = (over: Record<string, unknown> = {}) => ({
  id: 'ea-1', jobId: 'job-1', jobTitle: 'Analyst', jobCompany: 'Acme MMC', jobUrl: 'https://acme.example/jobs/1', mode: 'REVIEW_AND_SEND',
  deliveryState: 'AWAITING_APPROVAL', recruitmentState: 'NOT_SENT', holdReason: null, failureCode: null, subject: 'Analyst - REF-7',
  approvedAt: null, providerAcceptedAt: null, deliveredAt: null, interviewAt: null, interviewTimezone: null, createdAt: '2026-10-02T08:00:00Z',
  recipient: 'hr@acme.example', instructions: 'Send your CV to hr@acme.example with the subject "Analyst - REF-7".', reference: 'REF-7', subjectSource: 'published', subjectLocked: true,
  body: 'Hello,\nI am applying for the Analyst position.\nKind regards', copyToSelf: true, replyTo: 'candidate@example.com', senderName: 'Aysel',
  cv: { resumeId: 'r1', kind: 'base', fileName: 'CV-Aysel.pdf', mimeType: 'application/pdf', sha256: 'a'.repeat(64), bytes: null },
  payloadSha256: 'f'.repeat(64), consentVersion: null, sharing: ['Seçdiyiniz CV faylı', 'Yuxarıdakı məktub mətni'],
  evidence: { providerAcceptedAt: null, deliveredAt: null, bouncedAt: null, complainedAt: null, uncertainAt: null },
  reminderOptIn: false, interviewNotes: null, attemptCount: 0, history: [], replies: [], ...over,
});

async function renderPage(initial = view(), handlers: Record<string, (init?: RequestInit) => Response> = {}) {
  apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${path}`;
    if (handlers[key]) return handlers[key](init);
    if (path === '/email-applications/ea-1') return json(initial);
    if (path === '/email-applications/capabilities') return json({ enabled: true, testMode: true });
    if (path === '/resumes') return json([{ id: 'r1', isBase: true, status: 'READY', reviewedAt: null, createdAt: '2026-10-01T00:00:00Z', version: 1 }]);
    throw new Error(`unexpected ${key}`);
  });
  await act(async () => { render(<EmailApplicationPage {...props} />); });
}

describe('e-mail application review and tracking page', () => {
  beforeEach(() => { apiFetch.mockReset(); downloadAuthedFile.mockReset(); });

  it('shows the recipient, the vacancy instructions, the locked subject, the CV and what is shared, with approval disabled until the candidate agrees', async () => {
    await renderPage();
    expect(screen.getByTestId('recipient')).toHaveTextContent('hr@acme.example');
    expect(screen.getByText(/with the subject "Analyst - REF-7"/)).toBeInTheDocument();
    expect(screen.getByLabelText('Mövzu')).toBeDisabled();
    expect(screen.getByLabelText('Mövzu')).toHaveValue('Analyst - REF-7');
    expect(screen.getByText('CV-Aysel.pdf')).toBeInTheDocument();
    expect(screen.getByText('Seçdiyiniz CV faylı')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('Sınaq rejimi');
    const approve = screen.getByRole('button', { name: /Təsdiq et və göndər/ });
    expect(approve).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Elanın müraciət göstərişini oxudum/));
    expect(approve).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/göndərilməsinə razıyam/));
    expect(approve).toBeEnabled();
  });

  it('approves exactly the previewed fingerprint with explicit consent, and shows the queued state without claiming delivery', async () => {
    let posted: Record<string, unknown> = {};
    await renderPage(view(), {
      'POST /email-applications/ea-1/approve': (init) => { posted = JSON.parse(String(init?.body)); return json(view({ deliveryState: 'QUEUED', approvedAt: '2026-10-02T09:00:00Z' })); },
    });
    fireEvent.click(screen.getByLabelText(/Elanın müraciət göstərişini oxudum/));
    fireEvent.click(screen.getByLabelText(/göndərilməsinə razıyam/));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Təsdiq et və göndər/ })); });
    await waitFor(() => expect(posted).toEqual({ payloadSha256: 'f'.repeat(64), consent: true, instructionsAcknowledged: true }));
    expect(await screen.findByText(/Göndəriş növbəsindədir/)).toBeInTheDocument();
    expect(screen.queryByText(/Çatdırıldı|qəbul etdi/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Göndərişi ləğv et' })).toBeInTheDocument();
  });

  it('saves edits first and approves the new fingerprint, never the stale one', async () => {
    const calls: string[] = [];
    await renderPage(view(), {
      'PATCH /email-applications/ea-1/draft': (init) => { calls.push(`patch:${JSON.parse(String(init?.body)).body}`); return json(view({ body: 'My own words', payloadSha256: 'e'.repeat(64) })); },
      'POST /email-applications/ea-1/approve': (init) => { calls.push(`approve:${JSON.parse(String(init?.body)).payloadSha256}`); return json(view({ deliveryState: 'QUEUED' })); },
    });
    fireEvent.change(screen.getByLabelText(/Məktub \(e-poçtun mətni\)/), { target: { value: 'My own words' } });
    fireEvent.click(screen.getByLabelText(/Elanın müraciət göstərişini oxudum/));
    fireEvent.click(screen.getByLabelText(/göndərilməsinə razıyam/));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Saxla, təsdiq et və göndər/ })); });
    await waitFor(() => expect(calls).toEqual(['patch:My own words', `approve:${'e'.repeat(64)}`]));
  });

  it('shows a refused approval (for example a changed CV) as an error and keeps the draft', async () => {
    await renderPage(view(), { 'POST /email-applications/ea-1/approve': () => json({ message: 'CV önizləmədən sonra dəyişdi. Yenidən baxın. (CV_CHANGED)' }, 409) });
    fireEvent.click(screen.getByLabelText(/Elanın müraciət göstərişini oxudum/));
    fireEvent.click(screen.getByLabelText(/göndərilməsinə razıyam/));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Təsdiq et və göndər/ })); });
    expect(await screen.findByRole('alert')).toHaveTextContent('CV_CHANGED');
    expect(screen.getByRole('button', { name: /Təsdiq et və göndər/ })).toBeInTheDocument();
  });

  it('words provider acceptance as not delivery and not review, and offers tracking only after sending', async () => {
    await renderPage(view({ deliveryState: 'PROVIDER_ACCEPTED', recruitmentState: 'SENT', approvedAt: 'x', evidence: { providerAcceptedAt: '2026-10-02T09:00:00Z', deliveredAt: null, bouncedAt: null, complainedAt: null, uncertainAt: null }, history: [{ id: 'h1', from: 'NOT_SENT', to: 'SENT', evidence: 'PROVIDER_ACCEPTED', note: null, at: '2026-10-02T09:00:00Z' }] }));
    expect(screen.getByText(/aldığı və ya oxuduğu demək deyil/)).toBeInTheDocument();
    expect(screen.getByText('Çatdırılma: E-poçt xidməti qəbul etdi')).toBeInTheDocument();
    expect(screen.getByText('E-poçt xidməti · 02.10.2026', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Müraciətin gedişatı' })).toBeInTheDocument();
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('requires an interview date before scheduling and sends it with its time zone', async () => {
    let body: Record<string, unknown> = {};
    await renderPage(view({ deliveryState: 'DELIVERED', recruitmentState: 'SENT' }), {
      'PATCH /email-applications/ea-1/status': (init) => { body = JSON.parse(String(init?.body)); return json(view({ deliveryState: 'DELIVERED', recruitmentState: 'INTERVIEW_SCHEDULED', interviewAt: '2026-10-20T06:00:00.000Z', interviewTimezone: 'Asia/Baku' })); },
    });
    fireEvent.change(screen.getByLabelText('Yeni mərhələ'), { target: { value: 'INTERVIEW_SCHEDULED' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yadda saxla' })); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Müsahibə tarixini');
    expect(body).toEqual({});
    fireEvent.change(screen.getByLabelText('Müsahibə tarixi və saatı'), { target: { value: '2026-10-20T10:00' } });
    fireEvent.click(screen.getByLabelText(/24 saat əvvəl mənə e-poçtla xatırlat/));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yadda saxla' })); });
    await waitFor(() => expect(body).toMatchObject({ state: 'INTERVIEW_SCHEDULED', interviewAt: '2026-10-20T06:00:00.000Z', interviewTimezone: 'Asia/Baku', reminderOptIn: true }));
  });

  it('lets the candidate retry an uncertain delivery only after acknowledging the duplicate risk', async () => {
    let retried = false;
    await renderPage(view({ deliveryState: 'UNCERTAIN', approvedAt: 'x' }), { 'POST /email-applications/ea-1/retry': () => { retried = true; return json(view({ deliveryState: 'QUEUED' })); } });
    expect(screen.getByText(/Göndərilib-göndərilmədiyini təsdiq edə bilmirik/)).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Yenidən göndər' });
    expect(retry).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/dublikat yarada biləcəyini başa düşürəm/));
    await act(async () => { fireEvent.click(retry); });
    await waitFor(() => expect(retried).toBe(true));
  });

  it('confirms or dismisses a suggested stage from a reply only on the candidate\'s click', async () => {
    const calls: unknown[] = [];
    await renderPage(view({ deliveryState: 'DELIVERED', recruitmentState: 'SENT', replies: [{ id: 'rp1', subject: 'Interview invitation', receivedAt: '2026-10-03T08:00:00Z', suggestedState: 'INTERVIEW_INVITED', suggestionReason: 'subject mentions an interview', status: 'PENDING_REVIEW', attachmentCount: 1 }] }), {
      'POST /email-applications/ea-1/replies/rp1': (init) => { calls.push(JSON.parse(String(init?.body))); return json(view({ deliveryState: 'DELIVERED', recruitmentState: 'INTERVIEW_INVITED', replies: [] })); },
    });
    expect(screen.getByText(/1 əlavə \(açılmır\)/)).toBeInTheDocument();
    expect(calls).toEqual([]);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Təsdiq et' })); });
    await waitFor(() => expect(calls).toEqual([{ accept: true }]));
  });

  it('reports a missing application plainly', async () => {
    apiFetch.mockImplementation(async () => json({ message: 'x' }, 404));
    await act(async () => { render(<EmailApplicationPage {...props} />); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Müraciət tapılmadı');
  });
});

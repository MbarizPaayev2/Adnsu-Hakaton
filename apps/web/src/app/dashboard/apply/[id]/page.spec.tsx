import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ExternalApplyPage from './page';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiFetch, fetchAuthedFileUrl: vi.fn(async () => null) }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const props = { params: Promise.resolve({ id: 'ext-1' }) };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const base = {
  id: 'ext-1', matchId: 'match-1', status: 'DRAFT', stateReason: null, applyUrl: 'https://jobs.glorri.com/vacancies/acme/dev/apply',
  destinationHost: 'jobs.glorri.com', destinationName: 'Glorri', vacancy: { title: 'Backend developer', company: 'Acme', url: 'https://jobs.glorri.com/vacancies/acme/dev' },
  previewData: null, missingFields: null, reviewScreenshotUrl: null, reviewVersion: 0, otpAttempts: 0, errorMessage: null,
  submittedAt: null, receiptConfirmed: false, receiptReference: null, dryRun: false, disclosedFields: [], answers: [], consent: null,
};
const preparation = {
  status: 'DRAFT',
  destination: { key: 'glorri', displayName: 'Glorri', host: 'jobs.glorri.com', applyUrl: base.applyUrl },
  employer: 'Acme', vacancyTitle: 'Backend developer', postingUrl: base.vacancy.url,
  notice: { url: 'https://jobs.glorri.com/privacy', version: 'fixture-1', declarationText: 'Sintetik bəyanat mətni', hash: 'a'.repeat(64) },
  fields: [{ key: 'firstName', label: 'Ad', value: 'Sintetik' }, { key: 'phone', label: 'Mobil nömrə', value: '+994500000000' }],
  missingFields: [], disclosureHash: 'b'.repeat(64), approvedFieldKeys: ['firstName', 'phone', 'motivationLetter'],
  motivationLetter: 'Sintetik motivasiya məktubu, iyirmi simvoldan uzun.',
  documents: [
    { kind: 'CV', label: 'Əsas CV', reason: 'Müraciət formasının CV sahəsi', sha256: 'c'.repeat(64) },
    { kind: 'ID_DOCUMENT', label: 'Şəxsiyyət vəsiqəsinin şəkli', reason: 'Forma şəxsiyyət vəsiqəsini tələb edir.', sha256: 'd'.repeat(64) },
  ],
  blockers: [], blockerMessages: [], canConsent: true,
};
const reviewed = {
  ...base, status: 'READY_FOR_REVIEW', reviewVersion: 4,
  disclosedFields: [{ key: 'firstName', label: 'Ad', value: 'Sintetik' }],
  answers: [{ fieldKey: 'questions.0.answer', label: 'Sürücülük vəsiqəniz var?', value: 'Bəli' }],
  previewData: { line_0: 'Formadakı icmal' },
  consent: {
    destinationHost: 'jobs.glorri.com', noticeVersion: 'fixture-1', noticeUrl: 'https://jobs.glorri.com/privacy', grantedAt: '2026-09-28', revokedAt: null,
    approvedDocuments: [{ kind: 'CV', sha256: 'c'.repeat(64), reason: 'x' }, { kind: 'ID_DOCUMENT', sha256: 'd'.repeat(64), reason: 'y' }],
    disclosure: { motivationLetter: 'Sintetik motivasiya məktubu' },
  },
};

async function renderPage() {
  await act(async () => { render(<ExternalApplyPage {...props} />); });
}

describe('external application page', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  it('shows destination, the actual notice and exact disclosure, and needs explicit scoped approval before consent', async () => {
    apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/external-applications/ext-1') return json(base);
      if (path.endsWith('/preparation')) return json(preparation);
      if (path.endsWith('/consent')) return json({ ...base, status: 'FILLING' });
      throw new Error(`unexpected ${path} ${init?.method}`);
    });
    await renderPage();
    expect(await screen.findByText('Sintetik bəyanat mətni')).toBeInTheDocument();
    expect(screen.getByText(base.applyUrl)).toBeInTheDocument();
    expect(screen.getByText('+994500000000')).toBeInTheDocument();
    expect(screen.getByText(/Forma şəxsiyyət vəsiqəsini tələb edir/)).toBeInTheDocument();

    const grant = screen.getByRole('button', { name: 'Razılıq ver və formanı hazırla' });
    expect(grant).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /bəyanatı \(fixture-1\) oxudum/ }));
    expect(grant).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /yalnız bu vakansiya üçün jobs\.glorri\.com/ }));
    expect(grant).toBeEnabled();
    await act(async () => { fireEvent.click(grant); });

    const consentCall = apiFetch.mock.calls.find(([p]) => p.endsWith('/consent'))!;
    expect(JSON.parse(consentCall[1].body)).toEqual({
      destinationHost: 'jobs.glorri.com', noticeHash: 'a'.repeat(64), noticeVersion: 'fixture-1', disclosureHash: 'b'.repeat(64),
      approvedFields: ['firstName', 'phone', 'motivationLetter'],
      approvedDocuments: [{ kind: 'CV', sha256: 'c'.repeat(64) }, { kind: 'ID_DOCUMENT', sha256: 'd'.repeat(64) }],
      motivationLetter: preparation.motivationLetter,
    });
    expect(await screen.findByText(/Yekun göndəriş düyməsi basılmır/)).toBeInTheDocument();
  });

  it('reloads the preparation and requires approval again when something shown has changed', async () => {
    let prepCalls = 0;
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/external-applications/ext-1') return json(base);
      if (path.endsWith('/preparation')) { prepCalls += 1; return json(preparation); }
      if (path.endsWith('/consent')) return json({ message: 'Göstərilən məlumat dəyişib (bəyanat).', reason: 'PREPARATION_CHANGED' }, 409);
      throw new Error(path);
    });
    await renderPage();
    await screen.findByText('Sintetik bəyanat mətni');
    fireEvent.click(screen.getByRole('checkbox', { name: /oxudum/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /icazə verirəm\. Yekun/ }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Razılıq ver və formanı hazırla' })); });
    expect(await screen.findByRole('alert')).toHaveTextContent('dəyişib (bəyanat)');
    expect(prepCalls).toBe(2);
    expect(screen.getByRole('checkbox', { name: /oxudum/ })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Razılıq ver və formanı hazırla' })).toBeDisabled();
  });

  it.each([
    ['NOT_VERIFIABLE', true],
    ['VERIFIED_BY_CONTRACT', false],
  ] as const)('says before consent whether the destination can confirm receipt (%s)', async (receipt, warned) => {
    const destinationCapability = { key: 'glorri', displayName: 'Glorri', preparation: 'AVAILABLE', receipt, rejection: 'NOT_DETECTABLE', identityDocumentRequired: true };
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/external-applications/ext-1') return json({ ...base, destinationCapability });
      if (path.endsWith('/preparation')) return json({ ...preparation, destinationCapability });
      throw new Error(`unexpected ${path}`);
    });
    await renderPage();
    await screen.findByText('Sintetik bəyanat mətni');
    if (warned) {
      const note = screen.getByTestId('receipt-unverifiable');
      expect(note).toHaveTextContent('Qəbul təsdiqlənə bilməz');
      expect(note).toHaveTextContent('Glorri göndərişin qəbulunu AISE-nin yoxlaya biləcəyi şəkildə təsdiqləmir');
      expect(note).toHaveTextContent('«Çatdırılma təsdiqlənməyib»');
    } else {
      expect(screen.queryByTestId('receipt-unverifiable')).not.toBeInTheDocument();
    }
    // The consent controls are the existing ones; no extra checkbox is added.
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });

  it.each([
    ['NOT_VERIFIABLE', /Çatdırılma təsdiqlənməyib/],
    ['VERIFIED_BY_CONTRACT', /Qəbul yalnız sayt təsdiq nömrəsi göstərərsə təsdiqlənmiş sayılacaq/],
  ] as const)('repeats the receipt expectation in the final, irreversible confirmation (%s)', async (receipt, text) => {
    const destinationCapability = { key: 'glorri', displayName: 'Glorri', preparation: 'AVAILABLE', receipt, rejection: 'NOT_DETECTABLE', identityDocumentRequired: true };
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/external-applications/ext-1') return json({ ...reviewed, destinationCapability });
      throw new Error(`unexpected ${path}`);
    });
    await renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Göndərişi təsdiqlə/ }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(text);
    expect(apiFetch.mock.calls.some(([p]) => /confirm-submit/.test(p))).toBe(false);
  });

  it('offers only the assisted route when the destination is unsupported or gated', async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/external-applications/ext-1') return json(base);
      if (path.endsWith('/preparation')) {
        return json({ ...preparation, notice: null, blockers: ['NOTICE_NOT_CAPTURED'], blockerMessages: ['Bəyanat qeydə alınmayıb. Mənbə saytda özünüz müraciət edin.'], canConsent: false });
      }
      throw new Error(path);
    });
    await renderPage();
    expect(await screen.findByText('Avtomatik müraciət bu vakansiya üçün mümkün deyil')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Vakansiyanı mənbə saytda aç/ })).toHaveAttribute('href', base.vacancy.url);
    expect(screen.queryByRole('button', { name: /Razılıq ver/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/göndərildi|təsdiqləndi/i)).not.toBeInTheDocument();
  });

  it('asks unknown screening questions without offering the recipient declaration as one', async () => {
    apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/external-applications/ext-1') {
        return json({ ...base, status: 'NEEDS_INPUT', missingFields: [{ fieldKey: 'questions.0.answer', label: 'Sürücülük vəsiqəniz var?', type: 'radio', options: ['Bəli', 'Xeyr'] }] });
      }
      if (path.endsWith('/answers') && init?.method === 'PATCH') return json(reviewed);
      throw new Error(path);
    });
    await renderPage();
    expect(await screen.findByText('Sürücülük vəsiqəniz var?')).toBeInTheDocument();
    expect(screen.getByText(/cavabları təxmin etmir/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Xeyr' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cavabları Formaya Yaz' })); });
    const call = apiFetch.mock.calls.find(([p]) => p.endsWith('/answers'))!;
    expect(JSON.parse(call[1].body)).toEqual({ answers: [{ fieldKey: 'questions.0.answer', value: 'Xeyr' }] });
    expect(await screen.findByText('Göndərişdən əvvəl yoxlayın')).toBeInTheDocument();
  });

  it('shows exact documents and answers, sends one attempt per deliberate confirmation, and reuses it after a lost reply', async () => {
    let confirmCalls = 0;
    apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/external-applications/ext-1') return json(reviewed);
      if (path.endsWith('/confirm-submit')) {
        confirmCalls += 1;
        if (confirmCalls === 1) throw new TypeError('Failed to fetch');
        return json({ ...reviewed, status: 'DELIVERY_UNCONFIRMED', stateReason: 'NO_RECEIPT_EVIDENCE' });
      }
      throw new Error(`${path} ${init?.method}`);
    });
    await renderPage();
    expect(await screen.findByText('Sürücülük vəsiqəniz var?')).toBeInTheDocument();
    expect(screen.getByText('Bəli')).toBeInTheDocument();
    expect(screen.getByText(/CV \(razılıq verdiyiniz anda saxlanılan surət\)/)).toBeInTheDocument();
    expect(screen.getByText('Şəxsiyyət vəsiqəsinin şəkli')).toBeInTheDocument();
    expect(screen.getByText('Formadakı icmal')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Göndərişi təsdiqlə/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Backend developer');
    const send = screen.getByRole('button', { name: 'Bəli, real olaraq göndər' });
    await act(async () => { fireEvent.click(send); });
    expect(await screen.findByRole('alert')).toHaveTextContent('eyni göndəriş təkrarlanmayacaq');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Bəli, real olaraq göndər' })); });

    const bodies = apiFetch.mock.calls.filter(([p]) => p.endsWith('/confirm-submit')).map(([, init]) => JSON.parse(init.body));
    expect(bodies).toHaveLength(2);
    expect(bodies[0].attemptId).toMatch(/^[0-9a-f-]{36}$/);
    expect(bodies[1].attemptId).toBe(bodies[0].attemptId);
    expect(bodies[0].reviewVersion).toBe(4);
    // Uncertain delivery is never shown as success, and cannot be resent from here.
    expect(await screen.findByText('Çatdırılma təsdiqlənməyib')).toBeInTheDocument();
    expect(screen.getByText(/avtomatik yenidən göndərmir/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Yenidən Başla|Göndərişi təsdiqlə/ })).not.toBeInTheDocument();
  });

  it('a new confirmation after a refusal uses a new attempt id', async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/external-applications/ext-1') return json(reviewed);
      if (path.endsWith('/confirm-submit')) return json({ message: 'Avtomatik xarici müraciət hazırda dayandırılıb.', reason: 'LIVE_GATE_OFF' }, 403);
      throw new Error(path);
    });
    await renderPage();
    await screen.findByText('Göndərişdən əvvəl yoxlayın');
    fireEvent.click(screen.getByRole('button', { name: /Göndərişi təsdiqlə/ }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Bəli, real olaraq göndər' })); });
    expect(await screen.findByRole('alert')).toHaveTextContent('dayandırılıb');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Bəli, real olaraq göndər' })); });
    const ids = apiFetch.mock.calls.filter(([p]) => p.endsWith('/confirm-submit')).map(([, init]) => JSON.parse(init.body).attemptId);
    expect(ids).toHaveLength(2);
    expect(ids[1]).not.toBe(ids[0]);
  });

  it('OTP: shows remaining attempts, reports an invalid code and the confirmed receipt', async () => {
    let state: Record<string, unknown> & { otpAttempts: number } = { ...reviewed, status: 'AWAITING_OTP', otpAttempts: 1 };
    apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/external-applications/ext-1') return json(state);
      if (path.endsWith('/otp')) {
        const { code } = JSON.parse(String(init?.body));
        state = code === '424242'
          ? { ...state, status: 'SUBMITTED', receiptConfirmed: true, receiptReference: 'GL-0001' }
          : { ...state, otpAttempts: state.otpAttempts + 1, stateReason: 'OTP_INVALID' };
        return json(state);
      }
      throw new Error(path);
    });
    await renderPage();
    expect(await screen.findByText('Qalan cəhd: 4 / 5')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Təsdiq kodu' }), { target: { value: '000000' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Təsdiqlə' })); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Kod yanlışdır');
    expect(screen.getByText('Qalan cəhd: 3 / 5')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Təsdiq kodu' }), { target: { value: '424242' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Təsdiqlə' })); });
    expect(await screen.findByText('Müraciətin qəbulu təsdiqləndi')).toBeInTheDocument();
    expect(screen.getByText('GL-0001')).toBeInTheDocument();
  });

  it.each([
    ['legacy SUBMITTED without a receipt', { status: 'SUBMITTED', receiptConfirmed: false }, 'Göndərilib, qəbul təsdiqlənməyib', false],
    ['cancelled while awaiting OTP', { status: 'CANCELLED', stateReason: 'CANCELLED_AFTER_SEND_PENDING_OTP' }, 'saytdakı müraciəti geri götürmür', false],
    ['OTP session lost after the send', { status: 'EXPIRED', stateReason: 'OTP_SESSION_LOST_AFTER_SEND' }, 'avtomatik yenidən göndərmir', false],
    ['failed before any send', { status: 'FAILED', stateReason: 'CONFIRM_CONTROL_MISSING', errorMessage: 'Saytda göndəriş düyməsi tapılmadı. Heç nə göndərilmədi.' }, 'Heç nə göndərilmədi', true],
    ['stopped at a CAPTCHA', { status: 'FAILED', stateReason: 'MANUAL_INTERVENTION_REQUIRED', errorMessage: 'Sayt insan yoxlaması (CAPTCHA) tələb edir. AISE bunu keçməyə çalışmır; heç nə göndərilmədi.' }, 'Özünüz müraciət edin', false],
    ['preparation session expired', { status: 'EXPIRED', stateReason: 'SESSION_EXPIRED' }, 'Yekun göndəriş edilmədi', true],
    ['dry run', { status: 'SUBMITTED_DRY_RUN' }, 'göndəriş düyməsi basılmadı', false],
    ['CAPTCHA after the click', { status: 'DELIVERY_UNCONFIRMED', stateReason: 'CHALLENGE_AFTER_SEND' }, 'AISE bunu keçmir; müraciətin çatıb-çatmadığı bilinmir', false],
  ])('%s is described honestly', async (_label, over, text, canRestart) => {
    apiFetch.mockImplementation(async () => json({ ...reviewed, ...over }));
    await renderPage();
    expect(await screen.findByText(new RegExp(text))).toBeInTheDocument();
    expect(screen.queryByText('Müraciətin qəbulu təsdiqləndi')).not.toBeInTheDocument();
    if (canRestart) expect(screen.getByRole('button', { name: 'Yenidən Başla' })).toBeInTheDocument();
    else expect(screen.queryByRole('button', { name: 'Yenidən Başla' })).not.toBeInTheDocument();
  });

  it('keeps polling a send in flight and says it will not be repeated', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let calls = 0;
      apiFetch.mockImplementation(async () => {
        calls += 1;
        return json(calls < 2 ? { ...reviewed, status: 'SUBMITTING' } : { ...reviewed, status: 'SUBMITTED', receiptConfirmed: true, receiptReference: 'GL-7' });
      });
      await renderPage();
      expect(await screen.findByText(/göndəriş təkrarlanmayacaq/)).toBeInTheDocument();
      await act(async () => { vi.advanceTimersByTime(3100); });
      await waitFor(() => expect(screen.getByText('GL-7')).toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });
});

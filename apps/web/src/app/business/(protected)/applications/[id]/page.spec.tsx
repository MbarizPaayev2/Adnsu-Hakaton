import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ApplicationDetailPage from './page';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

describe('employer application detail', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retains the saved status and shows an error when the update fails', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'APPLIED',
          candidateName: 'Leyla',
          candidateEmail: 'leyla@example.com',
          answers: [],
          experiences: [],
        }),
      ),
    );
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }));

    await act(async () => {
      render(<ApplicationDetailPage params={Promise.resolve({ id: 'application-1' })} />);
    });

    const status = await screen.findByRole('combobox', { name: 'Müraciət statusu' });
    fireEvent.change(status, { target: { value: 'REVIEWING' } });

    expect(await screen.findByRole('alert')).toHaveTextContent('Status dəyişmədi');
    await waitFor(() => expect(status).toHaveValue('APPLIED'));
  });

  it('renders expired-session state when API returns 401', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }));

    await act(async () => {
      render(<ApplicationDetailPage params={Promise.resolve({ id: 'app-expired' })} />);
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Sessiyanız bitib');
    expect(screen.getByRole('link', { name: 'Yenidən daxil ol' })).toHaveAttribute(
      'href',
      '/business/login',
    );
  });

  it('renders not found state when API returns 404', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 404 }));

    await act(async () => {
      render(<ApplicationDetailPage params={Promise.resolve({ id: 'app-not-found' })} />);
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Müraciət tapılmadı');
    expect(screen.getByRole('link', { name: /Müraciətlərə qayıt/ })).toHaveAttribute(
      'href',
      '/business/applications',
    );
  });

  it('renders candidate details, CV upload link, and internal status disclaimer', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'app-100',
          status: 'REVIEWING',
          createdAt: '2026-10-01T12:00:00.000Z',
          vacancyTitle: 'Senior Frontend Developer',
          candidateName: 'Elmir Məmmədov',
          candidateEmail: 'elmir@example.com',
          candidatePhone: '+994 50 123 45 67',
          resumeUrl: '/uploads/elmir-cv-2026.pdf',
          experiences: [
            {
              title: 'Frontend Mühəndisi',
              company: 'FinTech MMC',
              startDate: '2022-01-01',
              endDate: null,
              description: 'Next.js və Tailwind ilə bank tətbiqi',
            },
          ],
          answers: [
            {
              questionLabel: 'Diplom və ya sertifikat',
              fileUrl: '/uploads/certificate-aws.pdf',
            },
          ],
        }),
      ),
    );

    await act(async () => {
      render(<ApplicationDetailPage params={Promise.resolve({ id: 'app-100' })} />);
    });

    const candidateMatches = await screen.findAllByText('Elmir Məmmədov');
    expect(candidateMatches.length).toBeGreaterThan(0);
    expect(screen.getByText('Senior Frontend Developer')).toBeInTheDocument();
    expect(screen.getAllByText('elmir@example.com').length).toBeGreaterThan(0);
    expect(screen.getByText('+994 50 123 45 67')).toBeInTheDocument();

    // Verify CV download authorization link matches /api/business/uploads/:filename
    const cvLink = screen.getByRole('link', { name: /CV-yə bax/ });
    expect(cvLink).toHaveAttribute('href', '/api/business/uploads/elmir-cv-2026.pdf');

    // Verify question file upload link
    const fileLink = screen.getByRole('link', { name: /Faylı yüklə/ });
    expect(fileLink).toHaveAttribute('href', '/api/business/uploads/certificate-aws.pdf');

    // Verify internal status disclaimer distinguishing internal status from email/interview
    expect(screen.getByText(/Status AISE daxilində qeyd olunur/)).toBeInTheDocument();
    expect(
      screen.getByText(/Namizədə e-poçt və ya bildiriş göndərilmir, müsahibə təyin olunmur/),
    ).toBeInTheDocument();
    expect(screen.getByText(/xronologiyasında sizin təsdiqiniz kimi görünə bilər/)).toBeInTheDocument();
  });
});

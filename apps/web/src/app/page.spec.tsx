import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import Home from './page';
import { documentAvailability, emailApplicationAvailability, emailAutomationAvailability } from '@/lib/document-availability';
vi.mock('@/lib/document-availability', () => ({ documentAvailability: vi.fn(), emailApplicationAvailability: vi.fn(), emailAutomationAvailability: vi.fn() }));
vi.mock('@/lib/candidate-plans-public', () => ({ candidatePlansTeaser: vi.fn().mockResolvedValue([
  { id: 'free', price: null, documents: 5, emailApplications: 5, browserAssistant: false },
  { id: 'plus', price: 8, documents: 30, emailApplications: 30, browserAssistant: false },
  { id: 'premium', price: 50, documents: null, emailApplications: 100, browserAssistant: true },
]) }));
import NotFound from './not-found';
import GlobalError from './error';

describe('Landing discovery and navigation', () => {
  beforeEach(() => { vi.mocked(documentAvailability).mockResolvedValue(false); vi.mocked(emailApplicationAvailability).mockResolvedValue(true); vi.mocked(emailAutomationAvailability).mockResolvedValue(false); });
  it('says who AISE is for, what it does, what the candidate controls and how to start, without promising documents that are off', async () => {
    render(await Home());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('İş müraciətlərini avtomatlaşdır. Vaxtın özünə qalsın.');
    expect(screen.getByText(/AZƏRBAYCANDA İŞ AXTARANLAR ÜÇÜN/)).toBeInTheDocument();
    expect(screen.getByText(/tezliklə hər elan üçün ayrıca CV/)).toBeInTheDocument();
    const control = screen.getByRole('list', { name: 'Nəzarət səndədir' });
    expect(within(control).getByText('Sənin təsdiqin olmadan heç nə göndərilmir.')).toBeInTheDocument();
    for (const link of screen.getAllByRole('link', { name: 'Ödənişsiz başla' })) expect(link).toHaveAttribute('href', '/register');
    expect(screen.getByRole('link', { name: 'Vakansiyalara bax' })).toHaveAttribute('href', '/jobs');
    expect(screen.queryByText(/94%|5.000|Ən populyar seçim/)).not.toBeInTheDocument();
  });
  it('separates what works today from what is still in testing, and says e-mail sending only when the server has it on', async () => {
    vi.mocked(documentAvailability).mockResolvedValue(true);
    render(await Home());
    expect(screen.getAllByText('Hazırdır')).toHaveLength(2);
    expect(screen.getByText(/sən təsdiqləyəndə elanın e-poçt ünvanına göndərir/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sınaqdadır, hələ açıq deyil' })).toBeInTheDocument();
    expect(screen.getByText('Qaydalarla avtomatik göndəriş')).toBeInTheDocument();
    expect(screen.getByText(/Hər müraciəti ayrıca təsdiqləmədən avtomatik göndəriş hazırda açıq deyil/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /DAHA AZ TƏKRAR İŞ/ })).toBeInTheDocument();
    vi.mocked(emailApplicationAvailability).mockResolvedValue(null);
    const { container } = render(await Home());
    expect(within(container).queryByText(/sən təsdiqləyəndə elanın e-poçt ünvanına göndərir/)).toBeNull();
  });
  it('lists rule-based sending as available only when the server has automatic sending on', async () => {
    vi.mocked(emailAutomationAvailability).mockResolvedValue(true);
    render(await Home());
    expect(screen.getByText('Qaydalarla avtomatik e-poçt göndərişi')).toBeInTheDocument();
    expect(screen.getByText(/Premium-da avtomatik e-poçt müraciətini aktiv et/)).toBeInTheDocument();
    expect(screen.queryByText('Qaydalarla avtomatik göndəriş')).toBeNull();
    expect(screen.queryByText(/avtomatik göndəriş hələ açıq deyil/)).toBeNull();
  });
  it('compares plans with the allowances the server states', async () => {
    render(await Home());
    const plans = screen.getByRole('list', { name: 'Namizəd planları' });
    expect(within(plans).getByText('ayda 5 sənəd')).toBeInTheDocument();
    expect(within(plans).getByText('sənəd üçün aylıq limit yoxdur')).toBeInTheDocument();
    expect(within(plans).getByText(/50 AZN\/ay/)).toBeInTheDocument();
  });
  it('walks through profile, vacancy, prepared application, review and tracking with a labelled synthetic example', async () => {
    vi.mocked(documentAvailability).mockResolvedValue(true);
    render(await Home());
    const steps = screen.getByRole('list', { name: 'AISE ilə müraciət addımları' });
    expect(within(steps).getAllByRole('button').map((b) => b.textContent)).toEqual(['1Profil', '2Vakansiya', '3Hazırlıq', '4Təsdiq', '5İzləmə']);
    expect(screen.getByText('NÜMUNƏ')).toBeInTheDocument();
    expect(screen.getByText('Sintetik namizəd')).toBeInTheDocument();
    const match = within(steps).getByRole('button', { name: /Vakansiya/ });
    fireEvent.click(match);
    expect(match).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: 'Uyğun vakansiyanı seçir' })).toBeInTheDocument();
    expect(within(steps.parentElement!).getByText(/profilində göstərilməyib/)).toBeInTheDocument();
    fireEvent.click(within(steps).getByRole('button', { name: /Hazırlıq/ }));
    expect(screen.getByText('Hazırdır · göndərilməyib')).toBeInTheDocument();
    fireEvent.click(within(steps).getByRole('button', { name: /Təsdiq/ }));
    expect(screen.getByText('Təsdiq et və göndər · Düzəlt · Keç')).toBeInTheDocument();
  });
  it('gives candidates, institutions and employers their own route', async () => {
    render(await Home());
    expect(screen.getByRole('link', { name: 'Pilot haqqında' })).toHaveAttribute('href', '/institutions');
    expect(screen.getByText(/tələbələrin şəxsi sənədləri onlarda qalır/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'İşəgötürənlər üçün' })).toHaveAttribute('href', '#employers');
    expect(screen.getByRole('link', { name: 'Planları müqayisə et' })).toHaveAttribute('href', '/pricing');
    expect(screen.queryByText(/400 AZN/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tez-tez verilən suallar' })).toBeInTheDocument();
    expect(screen.getByText('Brauzer genişlənməsini quraşdırmalıyam?')).toBeInTheDocument();
  });
  it('submits a labelled public search as a GET query without authentication', async () => {
    render(await Home());
    const form = screen.getByRole('search');
    const input = within(form).getByRole('searchbox', { name: 'Vəzifə və ya şirkət axtar' });
    fireEvent.change(input, { target: { value: 'mühasib' } });
    expect(input).toHaveValue('mühasib');
    expect(input).toHaveAttribute('name', 'q');
    expect(form).toHaveAttribute('action', '/jobs');
    expect(form).toHaveAttribute('method', 'get');
  });
  it('closes the mobile menu on Escape and restores focus to its toggle', async () => {
    render(await Home());
    const toggle = screen.getByRole('button', { name: 'Menyunu aç' });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('navigation', { name: 'Mobil menyu' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
    expect(screen.queryByRole('navigation', { name: 'Mobil menyu' })).not.toBeInTheDocument();
  });
  it('keeps employer entry and legal information reachable', async () => {
    render(await Home());
    expect(screen.getByRole('link', { name: /Vakansiya yerləşdirin/ })).toHaveAttribute('href', '/business/register');
    const footer = screen.getByRole('navigation', { name: 'Hüquqi və əlavə məlumatlar' });
    expect(within(footer).getByRole('link', { name: 'Məxfilik' })).toHaveAttribute('href', '/privacy');
    expect(within(footer).getByRole('link', { name: 'Hüquqi məlumatlar' })).toHaveAttribute('href', '/legal');
  });
});

describe('Not Found (404) & Error Boundary Pages', () => {
  it('renders 404 page with clear Azerbaijani copy and navigation', () => {
    render(<NotFound />);

    expect(screen.getByRole('heading', { name: 'Səhifə tapılmadı' })).toBeInTheDocument();
    expect(screen.getByText(/Axtardığınız səhifə silinmiş/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Əsas səhifəyə qayıt/i })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /Vakansiyalara bax/i })).toHaveAttribute('href', '/jobs');
  });

  it('renders error page with retry button and error details', () => {
    const reset = vi.fn();
    const error = new Error('Test crash') as Error & { digest?: string };
    error.digest = 'ERR_TEST_123';

    render(<GlobalError error={error} reset={reset} />);

    expect(screen.getByRole('heading', { name: 'Gözlənilməz xəta baş verdi' })).toBeInTheDocument();
    expect(screen.getByText(/Xəta kodu: ERR_TEST_123/)).toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: /Yenidən cəhd et/i });
    retryBtn.click();
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

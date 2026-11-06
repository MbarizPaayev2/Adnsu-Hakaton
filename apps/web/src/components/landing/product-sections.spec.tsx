import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { DocumentBenefits, EmployerSection } from './product-sections';

// Wording rules: docs/cv-harvard-template-evidence-2026-10-03.md §5. These assert what a visitor can read, not markup.
const FORBIDDEN = /Harvard\s*(təsdiqli|sertifikatlı|rəsmi|tərəfdaş)|Harvard-(approved|certified)|ATS|garanti|zəmanət|\d+\s*%|müsahibə(yə)?\s+(zəmanət|qazan)|limitsiz\s+AI|unlimited/i;

describe('candidate document benefits', () => {
  it('advertises available generation only when the server confirms it', () => {
    render(<DocumentBenefits enabled />);
    expect(screen.getAllByText('Hazırdır')).toHaveLength(2);
    expect(screen.queryByText('Tezliklə')).toBeNull();
    expect(screen.getByText(/yalnız təsdiqlədiyin faktlar/)).toBeInTheDocument();
    expect(screen.getByText(/Sən mətni yoxlayıb təsdiqləyirsən/)).toBeInTheDocument();
  });
  it('shows unknown availability on a failed status request', () => {
    render(<DocumentBenefits enabled={null} />);
    expect(screen.getAllByText('Yoxlanılır')).toHaveLength(2);
    expect(screen.queryByText('Hazırdır')).toBeNull();
    expect(screen.getAllByText(/Əlçatanlıq hazırda yoxlanıla bilmir/)).toHaveLength(2);
  });
  it('marks both the tailored CV and the letter as not yet available (document generation is off in the first release), and keeps the review promise', () => {
    render(<DocumentBenefits />);
    const section = screen.getByRole('region', { name: /Hər elana öz sənədləri/ });
    // Generation is switched off in the first release: the CV must read as coming soon too, never as a working feature.
    const cv = within(section).getByText('Vakansiyaya uyğun CV').closest('li')!;
    expect(within(cv).getByText('Tezliklə')).toBeInTheDocument();
    expect(within(cv).getByText(/Hələ əlçatan deyil/)).toBeInTheDocument();
    // The letter is `planned` in the server catalogue: it must read as coming soon, never as a working feature.
    const letter = within(section).getByText('Fərdi motivasiya məktubu').closest('li')!;
    expect(within(letter).getByText('Tezliklə')).toBeInTheDocument();
    expect(within(letter).getByText(/Hələ əlçatan deyil/)).toBeInTheDocument();
    expect(within(section).getByText(/Sənin təsdiqin olmadan heç nə göndərilmir/)).toBeInTheDocument();
  });

  it('carries the server fine print, never overclaims, and labels the preview as an illustration', () => {
    const { container } = render(<DocumentBenefits />);
    expect(screen.getByText(/Harvard Universiteti ilə əlaqə, təsdiq və ya sertifikat yoxdur/)).toBeInTheDocument();
    expect(screen.getByText(/müsahibə vəd edilmir/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(FORBIDDEN);
    expect(screen.getByText(/illüstrasiya\. Real CV deyil/)).toBeInTheDocument();
    // The sample sheet is decorative skeleton shapes: no invented person, company or figure is exposed to assistive tech.
    expect(container.querySelector('[aria-hidden="true"] b')).not.toBeNull();
  });

  it('links to account creation', () => {
    render(<DocumentBenefits />);
    expect(screen.getByRole('link', { name: /Ödənişsiz hesab yarat/ })).toHaveAttribute('href', '/register');
  });
});

describe('employer section', () => {
  it('links to the real employer registration and workspace and lists only supported capabilities', () => {
    const { container } = render(<EmployerSection />);
    expect(screen.getByRole('link', { name: /İşəgötürən kimi qeydiyyat/ })).toHaveAttribute('href', '/business/register');
    expect(screen.getByRole('link', { name: /Panelə daxil ol/ })).toHaveAttribute('href', '/business/login');
    const steps = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(steps).toHaveLength(3);
    expect(steps.join(' ')).toMatch(/Vakansiya yerləşdir/);
    expect(steps.join(' ')).toMatch(/Namizədləri yoxla/);
    expect(steps.join(' ')).toMatch(/Müraciətləri idarə et/);
    expect(container.textContent).not.toMatch(FORBIDDEN);
    // No invented partner logos, testimonials or counters.
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).not.toMatch(/\d{2,}/);
  });

  it('states employer plans only from what the server reported, and never a price it did not mark purchasable', () => {
    const { rerender, container } = render(<EmployerSection plans={{ trialDays: 14, singleDays: 30, singlePrice: null, businessPrice: null }} />);
    const list = screen.getByRole('list', { name: 'İşəgötürən planları' });
    expect(list.textContent).toMatch(/Sınaq.*14 gün ödənişsiz, kart tələb olunmur/);
    expect(list.textContent).not.toMatch(/AZN/);
    expect(list.textContent).toMatch(/Ödəniş hazır olduqda/);
    rerender(<EmployerSection plans={{ trialDays: 14, singleDays: 30, singlePrice: 20, businessPrice: 100 }} />);
    const priced = screen.getByRole('list', { name: 'İşəgötürən planları' }).textContent ?? '';
    expect(priced).toMatch(/20 AZN, bir dəfəlik, 30 gün\. Avtomatik yenilənmir/);
    expect(priced).toMatch(/100 AZN \/ ay/);
    expect(container.textContent).not.toMatch(FORBIDDEN);
  });
});

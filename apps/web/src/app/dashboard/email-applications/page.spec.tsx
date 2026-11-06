import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Page from './page';
import { fetchCatalogue } from '@/lib/job-catalogue';
import { emailApplicationAvailability } from '@/lib/document-availability';

vi.mock('@/lib/job-catalogue', async (load) => ({ ...(await load<object>()), fetchCatalogue: vi.fn() }));
vi.mock('@/lib/document-availability', () => ({ emailApplicationAvailability: vi.fn() }));
const data = { data: [{ id: 'email-job', kind: 'imported', title: 'Junior Analyst', company: 'Example Employer', location: 'Bakı', deadline: null }], meta: { total: 3, totalPages: 2, page: 1 }, companies: [{ company: 'Example Employer', count: 3 }] };
const response = (body: unknown) => new Response(JSON.stringify(body));
beforeEach(() => { vi.mocked(fetchCatalogue).mockReset().mockResolvedValue(response(data)); vi.mocked(emailApplicationAvailability).mockResolvedValue(true); });

describe('email application opportunities', () => {
  it('always requests the email-only catalogue and offers employers, job review, existing drafts and settings', async () => {
    render(await Page({ searchParams: Promise.resolve({ application: 'all', q: 'Analyst', company: 'Example Employer' }) }));
    const query = new URL(vi.mocked(fetchCatalogue).mock.calls[0][0], 'http://local');
    expect(Object.fromEntries(query.searchParams)).toMatchObject({ application: 'email', q: 'Analyst', company: 'Example Employer' });
    expect(screen.getByRole('option', { name: 'Example Employer (3)' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Junior Analyst' })).toHaveAttribute('href', '/jobs/imported/email-job');
    expect(screen.getByRole('link', { name: /Agent və göndəriş qaydaları/ })).toHaveAttribute('href', '/dashboard/email-applications/settings');
    expect(screen.getByRole('link', { name: /Hazır müraciətlərim/ })).toHaveAttribute('href', '/dashboard/applications#review');
    expect(screen.queryByRole('button', { name: /göndər/i })).toBeNull();
    const next = new URL(screen.getByRole('link', { name: 'Növbəti' }).getAttribute('href')!, 'http://local');
    expect(Object.fromEntries(next.searchParams)).toMatchObject({ application: 'email', page: '2', q: 'Analyst', company: 'Example Employer' });
    expect(screen.getByRole('button', { name: 'Axtar' }).closest('form')?.querySelector('[name="page"]')).toBeNull();
  });

  it('distinguishes a load failure from an actual empty result', async () => {
    vi.mocked(fetchCatalogue).mockResolvedValueOnce(null);
    const view = render(await Page({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('alert')).toHaveTextContent('yüklənə bilmədi');
    expect(screen.queryByText('0 vakansiya')).toBeNull();
    view.unmount();
    vi.mocked(fetchCatalogue).mockResolvedValueOnce(response({ ...data, data: [], meta: { total: 0, totalPages: 0, page: 1 } }));
    render(await Page({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText('0 vakansiya')).toBeDefined();
    expect(screen.getByText('Bu seçimlə açıq e-poçt vakansiyası tapılmadı')).toBeDefined();
  });

  it('does not promise sending when the feature status is disabled', async () => {
    vi.mocked(emailApplicationAvailability).mockResolvedValue(false);
    render(await Page({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('alert')).toHaveTextContent('göndərişi hazırda aktiv deyil');
  });
});

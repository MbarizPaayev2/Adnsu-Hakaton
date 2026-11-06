import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ApplyPage from './page';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiFetch }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const vacancy = {
  title: 'Engineer', company: { name: 'Example' },
  questions: [
    { id: 'text', type: 'SHORT_TEXT', label: 'Motivasiya', required: true },
    { id: 'file', type: 'FILE_UPLOAD', label: 'Portfolio', required: true },
  ],
};
const resumes = [{ id: 'cv-1', isBase: true, status: 'READY', fileUrl: '/uploads/cv.docx', createdAt: '2026-09-01' }];
const props = { params: Promise.resolve({ id: 'company-1', vacancyId: 'vacancy-1' }) };

describe('candidate application page', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation(async (path: string) => new Response(JSON.stringify(
      path === '/vacancies/vacancy-1' ? vacancy :
      path === '/resumes' ? resumes :
      path === '/dashboard/applications' ? [] : { name: 'Leyla', email: 'leyla@example.com' },
    ), { status: 200 }));
  });

  it('associates required questions with their controls and limits the file picker', async () => {
    await act(async () => { render(<ApplyPage {...props} />); });
    expect(await screen.findByRole('textbox', { name: 'Motivasiya *' })).toBeInTheDocument();
    const file = screen.getByLabelText(/Portfolio/) as HTMLInputElement;
    expect(file.type).toBe('file');
    expect(file.accept).toContain('.pdf,.docx');
    expect(screen.getByLabelText('Göndəriləcək CV')).toHaveValue('cv-1');
  });

  it('shows the API rejection without claiming submission and keeps the form retryable', async () => {
    apiFetch.mockImplementation(async (path: string) => path.endsWith('/apply')
      ? new Response(JSON.stringify({ message: 'Müraciət müddəti bitmişdir' }), { status: 400 })
      : new Response(JSON.stringify(path === '/vacancies/vacancy-1' ? vacancy : path === '/resumes' ? resumes : path === '/dashboard/applications' ? [] : {})));
    await act(async () => { render(<ApplyPage {...props} />); });
    await screen.findByRole('textbox', { name: 'Motivasiya *' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Motivasiya *' }), { target: { value: 'Synthetic interest' } });
    fireEvent.change(screen.getByLabelText(/Portfolio/), { target: { files: [new File(['test'], 'portfolio.pdf', { type: 'application/pdf' })] } });
    fireEvent.submit(screen.getByRole('button', { name: 'Müraciət et' }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Müraciət müddəti bitmişdir');
    expect(screen.queryByRole('heading', { name: 'Müraciətiniz göndərildi!' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Müraciət et' })).not.toBeDisabled());
  });
});

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PastedVacancyModal } from './pasted-vacancy-modal';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

beforeEach(() => apiFetch.mockReset());

describe('candidate pasted vacancy flow', () => {
  it('parses, lets the candidate confirm fields, quotes and generates without publishing to catalogue', async () => {
    apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/jobs/parse-text') return { ok: true, json: async () => ({ success: true, job: { title: 'Junior BI Analyst', company: null, location: null, deadline: null, description: 'Original full vacancy text', sourceUrl: null } }) };
      if (path === '/documents/quote') return { ok: true, json: async () => ({ units: 1, affordable: true }) };
      if (path === '/documents/generate') return { ok: true, json: async () => ({ documents: [{ id: 'resume-private-1' }] }) };
      if (!path) return { ok: true, json: async () => ({}) };
      throw new Error(`Unexpected API ${path} ${init?.method}`);
    });
    const onGenerated = vi.fn();
    render(<PastedVacancyModal open onClose={vi.fn()} onGenerated={onGenerated} />);
    const originalText = `Junior BI Analyst\n${'Build useful Power BI reports and analyze business data with SQL. '.repeat(2)}`;
    fireEvent.change(screen.getByLabelText('Vakansiya mətni'), { target: { value: originalText } });
    fireEvent.click(screen.getByRole('button', { name: /Sahələri çıxar və yoxla/ }));
    const title = await screen.findByLabelText('Vəzifə adı *');
    fireEvent.change(title, { target: { value: 'BI Analyst Intern' } });
    expect(screen.getByLabelText(/Şirkət/)).toHaveValue('');
    expect(screen.getByLabelText(/^Yer/)).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Limitə bax' }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/documents/quote', expect.objectContaining({ method: 'POST' })));
    const quoteBody = JSON.parse(apiFetch.mock.calls.find(([path]) => path === '/documents/quote')![1].body as string);
    expect(quoteBody.privateVacancy).toMatchObject({ title: 'BI Analyst Intern', company: null, location: null, originalText });
    fireEvent.click(await screen.findByRole('button', { name: /Sənədi hazırla/ }));
    await waitFor(() => expect(onGenerated).toHaveBeenCalledWith('resume-private-1'));
    expect(apiFetch.mock.calls.map(([path]) => path).filter(Boolean)).toEqual(['/jobs/parse-text', '/documents/quote', '/documents/generate']);
    const generateBody = JSON.parse(apiFetch.mock.calls.find(([path]) => path === '/documents/generate')![1].body as string);
    expect(generateBody.privateVacancy.originalText).toBe(originalText);
    expect(generateBody.matchId).toBeUndefined();
  });

  it('keeps pasted text available after parse failures for correction and retry', async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: 'Mətn qısadır' }) });
    render(<PastedVacancyModal open onClose={vi.fn()} onGenerated={vi.fn()} />);
    const text = `An analyst will prepare reports and review business data for the product team. ${'More detail. '.repeat(4)}`;
    fireEvent.change(screen.getByLabelText('Vakansiya mətni'), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: /Sahələri çıxar və yoxla/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mətn qısadır');
    expect(screen.getByLabelText('Vakansiya mətni')).toHaveValue(text);
  });

  it('uses a new idempotency key when motivation is edited after a failed attempt', async () => {
    let generateCount = 0;
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/jobs/parse-text') return { ok: true, json: async () => ({ job: { title: 'Analyst', company: null, location: null, deadline: null, description: 'Original vacancy text', sourceUrl: null } }) };
      if (path === '/documents/quote') return { ok: true, json: async () => ({ units: 1, affordable: true }) };
      if (path === '/documents/generate') {
        generateCount += 1;
        return generateCount <= 2
          ? { ok: false, json: async () => ({ message: 'Müvəqqəti xəta' }) }
          : { ok: true, json: async () => ({ documents: [{ id: 'letter-1' }] }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    const onGenerated = vi.fn();
    render(<PastedVacancyModal open onClose={vi.fn()} onGenerated={onGenerated} />);
    fireEvent.change(screen.getByLabelText('Vakansiya mətni'), { target: { value: `Analyst\n${'Prepare clear reports and analyze customer data. '.repeat(2)}` } });
    fireEvent.click(screen.getByRole('button', { name: /Sahələri çıxar və yoxla/ }));
    await screen.findByLabelText('Vəzifə adı *');
    fireEvent.change(screen.getByLabelText('Sənəd'), { target: { value: 'LETTER' } });
    const motivation = screen.getByLabelText('Bu vəzifəyə marağınız nədir?');
    fireEvent.change(motivation, { target: { value: 'Analitik işin təsirini görmək istəyirəm.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Limitə bax' }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/documents/quote', expect.any(Object)));
    const generateButton = await screen.findByRole('button', { name: /Sənədi hazırla/ });
    fireEvent.click(generateButton);
    expect(await screen.findByRole('alert')).toHaveTextContent('Müvəqqəti xəta');
    fireEvent.click(generateButton);
    await waitFor(() => expect(apiFetch.mock.calls.filter(([path]) => path === '/documents/generate')).toHaveLength(2));
    expect(apiFetch.mock.calls.filter(([path]) => path === '/documents/generate').map(([, init]) => JSON.parse(init.body as string))[0].requestId)
      .toBe(apiFetch.mock.calls.filter(([path]) => path === '/documents/generate').map(([, init]) => JSON.parse(init.body as string))[1].requestId);
    expect(await screen.findByRole('alert')).toHaveTextContent('Müvəqqəti xəta');
    fireEvent.change(motivation, { target: { value: 'Bu rol mənə məlumatlardan qərar dəstəyi yaratmağa imkan verir.' } });
    fireEvent.click(generateButton);
    await waitFor(() => expect(onGenerated).toHaveBeenCalledWith('letter-1'));
    const requests = apiFetch.mock.calls.filter(([path]) => path === '/documents/generate').map(([, init]) => JSON.parse(init.body as string));
    expect(requests).toHaveLength(3);
    expect(requests[0].requestId).toBe(requests[1].requestId);
    expect(requests[1].requestId).not.toBe(requests[2].requestId);
    expect(requests[2].letter.motivation).toContain('məlumatlardan qərar dəstəyi');
  });
});

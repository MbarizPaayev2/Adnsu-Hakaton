import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InstitutionEnquiryForm } from './enquiry-form';
import { apiFetch } from '@/lib/api';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

const fill = () => {
  fireEvent.change(screen.getByLabelText('Təşkilat *'), { target: { value: 'Example Academy' } });
  fireEvent.change(screen.getByLabelText('Ad və soyad *'), { target: { value: 'Aysel Example' } });
  fireEvent.change(screen.getByLabelText('E-poçt *'), { target: { value: 'aysel@example.test' } });
  fireEvent.change(screen.getByLabelText('Təxmini tələbə sayı'), { target: { value: '30' } });
  fireEvent.click(screen.getByLabelText(/mənimlə əlaqə saxlanılmasına razıyam/));
};

describe('institution pilot enquiry form', () => {
  beforeEach(() => vi.mocked(apiFetch).mockReset());

  it('sends the enquiry once and confirms without promising anything', async () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({ received: true }), { status: 201 }));
    render(<InstitutionEnquiryForm />);
    fill();
    const button = screen.getByRole('button', { name: 'Pilot üçün sorğu göndər' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByTestId('enquiry-sent')).toHaveTextContent('öhdəlik və ya ödəniş deyil'));
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse((vi.mocked(apiFetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ organization: 'Example Academy', email: 'aysel@example.test', cohortSize: 30, consent: true });
  });

  it('explains a rate limit instead of failing silently', async () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response('{}', { status: 429 }));
    render(<InstitutionEnquiryForm />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Pilot üçün sorğu göndər' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('support@aisehr.com');
  });
});

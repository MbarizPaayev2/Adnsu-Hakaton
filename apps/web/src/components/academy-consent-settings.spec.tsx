import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AcademyConsentSettings } from './academy-consent-settings';
import { apiFetch } from '@/lib/api';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

describe('AcademyConsentSettings', () => {
  const enrollment = {
    id: 'enrollment-1',
    academy: { name: 'Holberton Baku' },
    cohort: { name: '2026 Data Cohort' },
    status: 'ACTIVE',
    joinedAt: '2026-10-27T10:00:00.000Z',
    withdrawnAt: null,
    consentActive: true,
    consentScope: 'AGGREGATE_ONLY',
  };

  beforeEach(() => vi.clearAllMocks());

  it('loads active academy consent, asks for confirmation, revokes, then displays the inactive state', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url: string) => {
      if (url === '/academies/my-enrollments') return new Response(JSON.stringify([enrollment]), { status: 200 });
      if (url === '/academies/enrollments/enrollment-1/revoke') return new Response(JSON.stringify({ status: 'WITHDRAWN' }), { status: 200 });
      throw new Error(`Unexpected API request: ${url}`);
    });

    render(<AcademyConsentSettings />);
    expect(await screen.findByText('Holberton Baku')).toBeDefined();
    expect(screen.getByText(/CV, motivasiya məktubları, telefon və müraciət qeydləri akademiya ilə paylaşılmır/)).toBeDefined();
    expect(screen.getByText('Əhatə: Anonim, ümumi hesabat')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Razılığı ləğv et' }));
    expect(screen.getByRole('group', { name: 'Razılığı ləğv etmə təsdiqi' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Bəli, razılığı ləğv et' }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/academies/enrollments/enrollment-1/revoke', { method: 'POST' }));
    expect(screen.getByText('Holberton Baku üçün paylaşım razılığı ləğv edildi.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Razılığı ləğv et' })).toBeNull();
  });

  it('shows an honest empty state and keeps access errors visible', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    render(<AcademyConsentSettings />);
    expect(await screen.findByText('Hazırda akademiya dəvətiniz və ya aktiv qeydiyyatınız yoxdur.')).toBeDefined();
  });
});

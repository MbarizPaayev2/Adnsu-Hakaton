import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SaveJobButton } from './save-job-button';
import { FollowCompanyButton } from './follow-company-button';
import { CompanyLogo } from '../company-logo';
import { UnavailableBlock, ErrorBlock, CompanyMark } from './shared';
import * as retentionApiModule from '@/lib/retention/api';
import type { RetentionApi } from '@/lib/retention/api';
import { RetentionError } from '@/lib/retention/contract';

const dummyJob = {
  key: 'imported:job-1',
  title: 'Senior Frontend Engineer',
  company: 'Kapital Bank',
  location: 'Bakı',
  deadline: '2026-12-31T00:00:00Z',
};

describe('SaveJobButton interactions', () => {
  it('rolls back optimistic save state and displays retry alert if API fails', async () => {
    const mockSaveJob = vi.fn().mockRejectedValue(new Error('Network failure'));
    const mockIsJobSaved = vi.fn().mockResolvedValue(false);

    const testApi: RetentionApi = {
      mode: 'fixture',
    capabilities: { weeklyDigest: true, perSearchFrequency: true },
    getEntitlements: vi.fn(),
      listSavedJobs: vi.fn().mockResolvedValue([]),
      saveJob: mockSaveJob,
      unsaveJob: vi.fn().mockResolvedValue(undefined),
      isJobSaved: mockIsJobSaved,
      listSearches: vi.fn().mockResolvedValue([]),
      createSearch: vi.fn(),
      updateSearch: vi.fn(),
      deleteSearch: vi.fn(),
      listCompanies: vi.fn().mockResolvedValue([]),
      listFollowed: vi.fn().mockResolvedValue([]),
      setFollowed: vi.fn(),
      getPreferences: vi.fn(),
      updatePreferences: vi.fn(),
      startTelegramLink: vi.fn(),
      disconnectTelegram: vi.fn(),
      getCatalogue: vi.fn(),
      getHome: vi.fn(),
    };

    vi.spyOn(retentionApiModule, 'loadRetentionApi').mockResolvedValue(testApi);

    render(<SaveJobButton job={dummyJob} />);

    // Wait for initial button load
    const button = await screen.findByRole('button', { name: /Yadda saxla/i });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    // Click to save
    fireEvent.click(button);

    // Should call API
    expect(mockSaveJob).toHaveBeenCalledWith(dummyJob);

    // Expect rollback to unsaved state and error notification
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Alınmadı.');
      expect(button).toHaveAttribute('aria-pressed', 'false');
    });
  });
});

describe('FollowCompanyButton interactions with stable company IDs', () => {
  it('uses stable backend companyId and rolls back on failure', async () => {
    const mockSetFollowed = vi.fn().mockRejectedValue(new Error('Server error'));
    const mockListFollowed = vi.fn().mockResolvedValue(['company:existing-id-1']);

    const testApi: RetentionApi = {
      mode: 'fixture',
    capabilities: { weeklyDigest: true, perSearchFrequency: true },
    getEntitlements: vi.fn(),
      listSavedJobs: vi.fn().mockResolvedValue([]),
      saveJob: vi.fn(),
      unsaveJob: vi.fn(),
      isJobSaved: vi.fn(),
      listSearches: vi.fn().mockResolvedValue([]),
      createSearch: vi.fn(),
      updateSearch: vi.fn(),
      deleteSearch: vi.fn(),
      listCompanies: vi.fn().mockResolvedValue([]),
      listFollowed: mockListFollowed,
      setFollowed: mockSetFollowed,
      getPreferences: vi.fn(),
      updatePreferences: vi.fn(),
      startTelegramLink: vi.fn(),
      disconnectTelegram: vi.fn(),
      getCatalogue: vi.fn(),
      getHome: vi.fn(),
    };

    vi.spyOn(retentionApiModule, 'loadRetentionApi').mockResolvedValue(testApi);

    render(<FollowCompanyButton companyId="company-cuid-99" companyName="Kapital Bank ASC" />);

    const button = await screen.findByRole('button', { name: /Kapital Bank ASC şirkətini izlə/i });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(button);

    expect(mockSetFollowed).toHaveBeenCalledWith('company:company-cuid-99', true, 'Kapital Bank ASC');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('İzləmə vəziyyətini dəyişmək mümkün olmadı.');
      expect(button).toHaveAttribute('aria-pressed', 'false');
    });
  });
});

describe('FollowCompanyButton against the API key shape', () => {
  it('shows an already-followed company as followed (list holds company:<id> keys; the page passes the bare id)', async () => {
    const testApi = {
      mode: 'live', capabilities: { weeklyDigest: false, perSearchFrequency: false }, getEntitlements: vi.fn(),
      listFollowed: vi.fn().mockResolvedValue(['company:abc']), setFollowed: vi.fn().mockResolvedValue(undefined),
    } as unknown as RetentionApi;
    vi.spyOn(retentionApiModule, 'loadRetentionApi').mockResolvedValue(testApi);
    render(<FollowCompanyButton companyId="abc" companyName="Aİ Şirkət" />);
    const button = await screen.findByRole('button', { name: /Aİ Şirkət izlənilir/ });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(button);
    expect(testApi.setFollowed).toHaveBeenCalledWith('company:abc', false, 'Aİ Şirkət');
  });

  it('follows an observed public company by its normalized key and restores the follow after remount', async () => {
    const followed: string[] = [];
    const testApi = {
      mode: 'live', capabilities: { weeklyDigest: false, perSearchFrequency: false },
      listFollowed: vi.fn(async () => [...followed]),
      setFollowed: vi.fn(async (key: string, follow: boolean) => {
        if (follow && !followed.includes(key)) followed.push(key);
        if (!follow) followed.splice(followed.indexOf(key), 1);
      }),
    } as unknown as RetentionApi;
    vi.spyOn(retentionApiModule, 'loadRetentionApi').mockResolvedValue(testApi);
    const props = { followKey: 'baker tilly azerbaijan', companyName: 'Baker Tilly Azerbaijan' };
    const first = render(<FollowCompanyButton {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: /Baker Tilly Azerbaijan şirkətini izlə/ }));
    expect(testApi.setFollowed).toHaveBeenCalledWith(props.followKey, true, props.companyName);
    await waitFor(() => expect(screen.getByRole('button', { name: /Baker Tilly Azerbaijan izlənilir/ })).toHaveAttribute('aria-pressed', 'true'));
    first.unmount();
    render(<FollowCompanyButton {...props} />);
    expect(await screen.findByRole('button', { name: /Baker Tilly Azerbaijan izlənilir/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('offers sign-in with a return path when an observed company is viewed signed out', async () => {
    const testApi = {
      mode: 'live', capabilities: { weeklyDigest: false, perSearchFrequency: false },
      listFollowed: vi.fn().mockRejectedValue(new RetentionError('SIGNED_OUT', 'Sessiya bitib.')),
      setFollowed: vi.fn(),
    } as unknown as RetentionApi;
    vi.spyOn(retentionApiModule, 'loadRetentionApi').mockResolvedValue(testApi);
    window.history.replaceState(null, '', '/companies/oc_test');
    render(<FollowCompanyButton followKey="example company" companyName="Example Company" />);
    const link = await screen.findByRole('link', { name: 'İzləmək üçün daxil olun' });
    expect(link).toHaveAttribute('href', '/login?next=%2Fcompanies%2Foc_test');
    expect(testApi.setFollowed).not.toHaveBeenCalled();
  });
});

describe('CompanyLogo fallbacks', () => {
  it('renders monogram initials fallback when src is missing or null', () => {
    render(<CompanyLogo src={null} alt="SOCAR MMC" name="SOCAR MMC" />);
    const monogram = screen.getByRole('img', { name: /SOCAR MMC \(loqo yoxdur\)/i });
    expect(monogram).toBeInTheDocument();
    expect(monogram).toHaveTextContent('SO');
  });

  it('renders custom fallback element when provided and image fails', () => {
    render(
      <CompanyLogo
        src=""
        alt="Paşa Bank"
        fallback={<span data-testid="custom-fallback">PB Mark</span>}
      />
    );
    expect(screen.getByTestId('custom-fallback')).toHaveTextContent('PB Mark');
  });
});

describe('UnavailableBlock and error handling for retention services', () => {
  it('renders honest unavailable status and guidance without claiming success', () => {
    render(
      <UnavailableBlock
        title="Saxlanan axtarışlar"
        alt={{ href: '/jobs', label: 'Vakansiyalara keç' }}
      />
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Bu imkan hələ aktiv deyil. Heç nə yadda saxlanmır.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Vakansiyalara keç' })).toHaveAttribute('href', '/jobs');
  });

  it('renders ErrorBlock with retry action', () => {
    const retryFn = vi.fn();
    render(<ErrorBlock onRetry={retryFn} text="Məlumat yüklənmədi." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Məlumat yüklənmədi.');
    const retryBtn = screen.getByRole('button', { name: 'Yenidən cəhd et' });
    fireEvent.click(retryBtn);
    expect(retryFn).toHaveBeenCalledTimes(1);
  });
});

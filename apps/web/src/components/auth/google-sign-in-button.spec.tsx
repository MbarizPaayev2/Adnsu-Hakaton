import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleSignInButton, authErrorMessage } from './google-sign-in-button';

const signInMock = vi.fn();
vi.mock('next-auth/react', () => ({ signIn: (...a: unknown[]) => signInMock(...a) }));

beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); signInMock.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

describe('Google sign-in button', () => {
  it('renders nothing while the deployment has Google sign-in off (no dead button), also when the status cannot be read', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ google: false })));
    const { container } = render(<GoogleSignInButton callbackUrl="/dashboard" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));
    const again = render(<GoogleSignInButton callbackUrl="/dashboard" />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(again.container).toBeEmptyDOMElement();
  });

  it('offers "Google ilə davam et" when the API says it is on, and starts the Google flow with the safe callback', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ google: true })));
    render(<GoogleSignInButton callbackUrl="/jobs/imported/abc" />);
    const button = await screen.findByRole('button', { name: /Google ilə davam et/ });
    expect(button.className).toMatch(/min-h-11/); // touch target on phones
    fireEvent.click(button);
    expect(signInMock).toHaveBeenCalledWith('google', { callbackUrl: '/jobs/imported/abc' });
  });

  it('maps every error code the flow can return to a plain Azerbaijani message', () => {
    for (const code of ['google_conflict', 'google_suspended', 'google_failed', 'OAuthCallback', 'AccessDenied']) expect(authErrorMessage(code)).toBeTruthy();
    expect(authErrorMessage(null)).toBeNull();
    expect(authErrorMessage('SomethingElse')).toBeNull();
  });
});

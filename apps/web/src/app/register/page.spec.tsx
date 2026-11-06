import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RegisterPage from '@/app/register/page';
import {
  VERIFICATION_RESEND_ACCEPTED_LABEL,
  VERIFICATION_RESEND_FAILED_LABEL,
} from '@/lib/verification-resend';

vi.mock('@/components/auth/google-sign-in-button', () => ({ GoogleSignInButton: () => null })); // its own status fetch is covered in the component's spec
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

describe('RegisterPage resend', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function reachResendScreen() {
    fetchMock.mockResolvedValueOnce(new Response('{"email":"user@example.com"}', { status: 201 }));
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText('E-poçt ünvanı'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText('Şifrə'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Şifrəni təsdiqləyin'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /İstifadə şərtləri/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Hesab yarat' }));
    expect(await screen.findByText(/hesab yaradıldı/i)).toBeInTheDocument();
  }

  it('does not submit without accepting the Terms and Privacy Policy, and sends the acceptance when given', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"email":"user@example.com"}', { status: 201 }));
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText('E-poçt ünvanı'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText('Şifrə'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Şifrəni təsdiqləyin'), { target: { value: 'password123' } });
    const box = screen.getByRole('checkbox', { name: /İstifadə şərtləri/ });
    expect(box).not.toBeChecked();
    fireEvent.submit(box.closest('form') as HTMLFormElement);
    expect(await screen.findByRole('alert')).toHaveTextContent(/razılaşın/);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: 'Hesab yarat' }));
    await screen.findByText(/hesab yaradıldı/i);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: 'user@example.com', password: 'password123', acceptTerms: true });
  });

  it('does not claim the verification email was sent when resend fails', async () => {
    await reachResendScreen();
    fetchMock.mockResolvedValueOnce(new Response('error', { status: 503 }));

    fireEvent.click(screen.getByRole('button', { name: 'Təsdiq e-poçtunu yenidən göndər' }));

    expect(await screen.findByRole('button', { name: VERIFICATION_RESEND_FAILED_LABEL })).toBeInTheDocument();
    expect(screen.queryByText('Təsdiq e-poçtu yenidən göndərildi')).not.toBeInTheDocument();
  });

  it('allows retry after an accepted generic API response without claiming mailbox delivery', async () => {
    await reachResendScreen();
    fetchMock.mockResolvedValueOnce(new Response('{"success":true}', { status: 200 }));

    fireEvent.click(screen.getByRole('button', { name: 'Təsdiq e-poçtunu yenidən göndər' }));

    const accepted = await screen.findByRole('button', { name: VERIFICATION_RESEND_ACCEPTED_LABEL });
    expect(accepted).not.toBeDisabled();
    expect(accepted.textContent).not.toContain('göndərildi');
  });
});

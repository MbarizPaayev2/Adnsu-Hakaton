import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LinkedInImportPanel } from './linkedin-import-panel';

const props = () => ({ text: '', onTextChange: vi.fn(), onImport: vi.fn(), onFile: vi.fn(), busy: false, error: null });

describe('LinkedIn import choices', () => {
  it('shows URL, text and PDF options and explains honest fallback', () => {
    render(<LinkedInImportPanel {...props()} />);
    expect(screen.getByRole('heading', { name: 'LinkedIn profilindən əlavə edin' })).toBeDefined();
    expect(screen.getByLabelText('LinkedIn PDF-i yüklə')).toBeDefined();
    expect(screen.getByText(/Keçidlə tam idxala zəmanət verilmir/)).toBeDefined();
  });

  it('allows extracting directly when a valid LinkedIn profile URL is entered', () => {
    const p = props();
    render(<LinkedInImportPanel {...p} text="https://www.linkedin.com/in/synthetic-profile" />);
    const button = screen.getByRole('button', { name: 'Keçiddən çıxar' });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(p.onImport).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toContain('Profil keçidi aşkarlandı');
  });

  it('accepts a LinkedIn export via the upload handler', () => {
    const p = props();
    render(<LinkedInImportPanel {...p} />);
    const file = new File(['pdf'], 'linkedin.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('LinkedIn PDF-i yüklə'), { target: { files: [file] } });
    expect(p.onFile).toHaveBeenCalledWith(file);
  });

  it('requires a fresh explicit reader choice and does not carry it to another URL', () => {
    const p = props();
    const view = render(<LinkedInImportPanel {...p} text="https://www.linkedin.com/in/ada" />);
    fireEvent.click(screen.getByRole('button', { name: 'Keçiddən çıxar' }));
    expect(p.onImport).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole('checkbox', { name: /Jina AI/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Keçiddən çıxar' }));
    expect(p.onImport).toHaveBeenLastCalledWith(true);
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('checkbox'));
    view.rerender(<LinkedInImportPanel {...p} text="https://www.linkedin.com/in/another" />);
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Keçiddən çıxar' }));
    expect(p.onImport).toHaveBeenLastCalledWith(false);
  });

  it('renders immediate actionable fallbacks upon error while retaining entered input', () => {
    const p = props();
    render(
      <LinkedInImportPanel
        {...p}
        text="https://www.linkedin.com/in/restricted-profile"
        error="LinkedIn birbaşa keçidlə oxunmanı müvəqqəti məhdudlaşdırdı. Zəhmət olmasa profil mətnini kopyalayın və ya PDF yükləyin."
      />,
    );
    // Verifies text remains in the textarea
    const textarea = screen.getByLabelText('LinkedIn profil mətni') as HTMLTextAreaElement;
    expect(textarea.value).toBe('https://www.linkedin.com/in/restricted-profile');

    // Verifies alert and fallback actions are rendered
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText(/LinkedIn birbaşa keçidlə oxunmanı müvəqqəti məhdudlaşdırdı/)).toBeDefined();
    expect(screen.getByText('Dərhal alternativ üsulla davam edin:')).toBeDefined();

    // Verifies immediate PDF fallback input works
    const file = new File(['pdf'], 'profile.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('LinkedIn PDF-i seçin'), { target: { files: [file] } });
    expect(p.onFile).toHaveBeenCalledWith(file);
  });
});

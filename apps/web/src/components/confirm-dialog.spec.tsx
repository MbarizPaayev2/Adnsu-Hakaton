import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import { ConfirmDialog } from './admin-ui';

function DialogHarness({
  requireReason = false,
  danger = false,
  onConfirm = vi.fn().mockResolvedValue(undefined),
}: {
  requireReason?: boolean;
  danger?: boolean;
  onConfirm?: (reason: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button id="open-btn" onClick={() => setOpen(true)}>
        Dialoqu aç
      </button>
      <button id="outside-btn">Kənar düymə</button>
      {open && (
        <ConfirmDialog
          title="Təsdiq pəncərəsi"
          description="Bu əməliyyat geri qaytarılmır."
          confirmLabel="Təsdiq et"
          requireReason={requireReason}
          danger={danger}
          onConfirm={onConfirm}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

describe('ConfirmDialog accessibility and interaction', () => {
  it('restores focus to the invoking control upon closing', async () => {
    render(<DialogHarness />);
    const openBtn = screen.getByRole('button', { name: 'Dialoqu aç' });
    openBtn.focus();
    expect(document.activeElement).toBe(openBtn);

    act(() => {
      fireEvent.click(openBtn);
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const cancelBtn = screen.getByRole('button', { name: 'İmtina' });
    act(() => {
      fireEvent.click(cancelBtn);
    });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(openBtn);
  });

  it('sets initial focus on Cancel when reason is not required', async () => {
    render(<DialogHarness requireReason={false} />);
    const openBtn = screen.getByRole('button', { name: 'Dialoqu aç' });
    act(() => {
      fireEvent.click(openBtn);
    });

    const cancelBtn = screen.getByRole('button', { name: 'İmtina' });
    expect(document.activeElement).toBe(cancelBtn);
  });

  it('sets initial focus on the reason field when reason is required', async () => {
    render(<DialogHarness requireReason={true} />);
    const openBtn = screen.getByRole('button', { name: 'Dialoqu aç' });
    act(() => {
      fireEvent.click(openBtn);
    });

    const textarea = screen.getByPlaceholderText('Səbəbi daxil edin...');
    expect(document.activeElement).toBe(textarea);
  });

  it('contains focus within dialog and wraps on Tab and Shift+Tab', async () => {
    render(<DialogHarness requireReason={false} />);
    const openBtn = screen.getByRole('button', { name: 'Dialoqu aç' });
    act(() => {
      fireEvent.click(openBtn);
    });

    const cancelBtn = screen.getByRole('button', { name: 'İmtina' });
    const confirmBtn = screen.getByRole('button', { name: 'Təsdiq et' });

    // Initial focus on cancelBtn (first focusable)
    expect(document.activeElement).toBe(cancelBtn);

    // Shift+Tab from first element wraps to last element (confirmBtn)
    act(() => {
      fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    });
    expect(document.activeElement).toBe(confirmBtn);

    // Tab from last element wraps to first element (cancelBtn)
    act(() => {
      fireEvent.keyDown(window, { key: 'Tab', shiftKey: false });
    });
    expect(document.activeElement).toBe(cancelBtn);
  });

  it('prevents closing and interaction when in busy state', async () => {
    let resolveConfirm!: () => void;
    const pendingConfirm = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        })
    );

    render(<DialogHarness onConfirm={pendingConfirm} />);
    const openBtn = screen.getByRole('button', { name: 'Dialoqu aç' });
    act(() => {
      fireEvent.click(openBtn);
    });

    const confirmBtn = screen.getByRole('button', { name: 'Təsdiq et' });
    const cancelBtn = screen.getByRole('button', { name: 'İmtina' });

    // Click confirm to start async operation
    act(() => {
      fireEvent.click(confirmBtn);
    });

    // Both buttons should be disabled in busy state
    expect(screen.getByText('Gözləyin...')).toBeInTheDocument();
    expect(cancelBtn).toBeDisabled();
    expect(confirmBtn).toBeDisabled();

    // Escape should NOT close dialog while busy
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Backdrop click should NOT close dialog while busy
    const backdrop = screen.getByRole('dialog').parentElement!;
    act(() => {
      fireEvent.click(backdrop);
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Resolve the promise
    await act(async () => {
      resolveConfirm();
    });

    // Dialog closes upon resolution
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('locks body overflow while open and restores on unmount', () => {
    expect(document.body.style.overflow).toBe('');
    const { unmount } = render(<DialogHarness />);
    const openBtn = screen.getByRole('button', { name: 'Dialoqu aç' });
    act(() => {
      fireEvent.click(openBtn);
    });

    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmailAllowanceNote, resetDate } from './email-allowance-note';

describe('EmailAllowanceNote', () => {
  it('states what is used and left before sending, and that a failed or cancelled send gives the unit back', () => {
    render(<EmailAllowanceNote allowance={{ plan: 'FREE', limit: 5, used: 2, remaining: 3, resetsAt: '2026-10-31T20:00:00.000Z' }} />);
    const note = screen.getByTestId('email-allowance');
    expect(note).toHaveTextContent('Ödənişsiz planı: bu ay 2 / 5');
    expect(note).toHaveTextContent('3 qalıb');
    expect(note).toHaveTextContent('Göndərilməyən və ya ləğv edilən müraciət limiti azaltmır');
  });

  it('says plainly when the allowance is used up and when it renews', () => {
    render(<EmailAllowanceNote allowance={{ plan: 'PLUS', limit: 30, used: 30, remaining: 0, resetsAt: '2026-10-31T20:00:00.000Z' }} />);
    const note = screen.getByRole('alert');
    expect(note).toHaveTextContent('limiti (30) çatılıb');
    expect(note).toHaveTextContent('01.11.2026');
  });

  it('shows Baku calendar dates for the reset moment', () => {
    expect(resetDate('2026-11-30T20:00:00.000Z')).toBe('01.12.2026');
  });

  it('is silent until the server has answered', () => {
    const { container } = render(<EmailAllowanceNote allowance={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

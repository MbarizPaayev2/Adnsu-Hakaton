import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CareerEvidenceEditor } from './career-evidence-editor';
import {
  CareerEvidenceState,
  normalizeExtractedEvidence,
  EVIDENCE_SECTION_EXPLANATION,
} from '@/lib/career-evidence';

function EditorHarness({
  initial,
  onStateChange,
}: {
  initial?: Partial<CareerEvidenceState>;
  onStateChange?: (s: CareerEvidenceState) => void;
}) {
  const [evidence, setEvidence] = useState<CareerEvidenceState>({
    projects: initial?.projects ?? [],
    volunteering: initial?.volunteering ?? [],
    certifications: initial?.certifications ?? [],
    languages: initial?.languages ?? [],
    awards: initial?.awards ?? [],
    deletedEntryIds: initial?.deletedEntryIds ?? [],
  });

  const handleChange = (next: CareerEvidenceState) => {
    setEvidence(next);
    onStateChange?.(next);
  };

  return <CareerEvidenceEditor evidence={evidence} onChange={handleChange} />;
}

describe('CareerEvidenceEditor', () => {
  it('displays the explanation banner with truthful phrasing', () => {
    render(<EditorHarness />);
    expect(screen.getByText(EVIDENCE_SECTION_EXPLANATION)).toBeDefined();
    expect(screen.getByText('Əlavə karyera sübutları (istəyə bağlı)')).toBeDefined();
  });

  it('renders extracted items with FromCv badge and awaiting confirmation state', () => {
    const raw = {
      projects: [
        {
          id: 'p1',
          name: 'Open Source Compiler',
          period: '2025',
          description: 'AST optimizations',
          source: 'EXTRACTED',
          confirmed: false,
        },
      ],
    };
    const normalized = normalizeExtractedEvidence(raw);
    render(<EditorHarness initial={normalized} />);

    // Shows FromCv badge
    expect(screen.getByText('CV-dən oxundu')).toBeDefined();
    // Shows unconfirmed badge
    expect(screen.getByText('Təsdiq gözləyir')).toBeDefined();
  });

  it('toggles confirmation status when user checks confirmation box', () => {
    const raw = {
      projects: [
        {
          id: 'p1',
          name: 'Distributed Cache',
          period: '2024',
          description: 'LRU implementation',
          source: 'EXTRACTED',
          confirmed: false,
        },
      ],
    };
    const normalized = normalizeExtractedEvidence(raw);
    render(<EditorHarness initial={normalized} />);

    const checkbox = screen.getByRole('checkbox', {
      name: /Bu layihə məlumatlarını və faktları təsdiqləyirəm/i,
    });
    expect(checkbox).toBeDefined();
    expect((checkbox as HTMLInputElement).checked).toBe(false);

    fireEvent.click(checkbox);
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('Təsdiqlənib')).toBeDefined();
  });

  it('allows adding and removing volunteering activity', () => {
    render(<EditorHarness />);

    const addVolBtn = screen.getByRole('button', { name: /Fəaliyyət əlavə et/i });
    fireEvent.click(addVolBtn);

    expect(screen.getByPlaceholderText('məs. Formula 1 Bakı Şəhər Halqası')).toBeDefined();

    const deleteBtn = screen.getByLabelText(/könüllülük fəaliyyətini sil/i);
    fireEvent.click(deleteBtn);

    expect(screen.queryByPlaceholderText('məs. Formula 1 Bakı Şəhər Halqası')).toBeNull();
  });

  it('allows adding a language and updates state', () => {
    render(<EditorHarness />);

    const addLangBtn = screen.getByRole('button', { name: /Dil əlavə et/i });
    fireEvent.click(addLangBtn);

    const langInput = screen.getByPlaceholderText('məs. İngilis dili');
    fireEvent.change(langInput, { target: { value: 'Alman dili' } });
    expect((langInput as HTMLInputElement).value).toBe('Alman dili');
  });

  it('appends removed item id to deletedEntryIds', () => {
    let latestState: CareerEvidenceState | null = null;
    const initial = {
      projects: [
        {
          id: 'proj-to-delete-1',
          name: 'Old Project',
          period: '2020',
          description: 'Deprecated',
          source: 'EXTRACTED' as const,
          confirmed: false,
        },
      ],
      deletedEntryIds: [],
    };

    render(
      <EditorHarness
        initial={initial}
        onStateChange={(state) => {
          latestState = state;
        }}
      />,
    );

    const deleteBtn = screen.getByLabelText(/layihəni sil/i);
    fireEvent.click(deleteBtn);

    expect(screen.queryByPlaceholderText('məs. E-ticarət platformasının arxitekturası')).toBeNull();
    expect((latestState as CareerEvidenceState | null)?.deletedEntryIds).toContain('proj-to-delete-1');
  });
});

describe('CareerEvidenceEditor accessibility', () => {
  it('gives every field a programmatic label (a screen reader and a tap on the label both reach the input)', () => {
    const evidence = {
      projects: [{ id: 'p1', name: 'Panel', period: '2022', description: 'x', source: 'USER' as const, confirmed: true }],
      volunteering: [{ id: 'v1', organization: 'Org', role: 'Rol', period: '2020', description: '', source: 'USER' as const, confirmed: true }],
      certifications: [{ id: 'c1', title: 'Sertifikat', issuer: 'Qurum', date: '2022', source: 'USER' as const, confirmed: true }],
      languages: [{ id: 'l1', language: 'Rus dili', level: '', source: 'EXTRACTED' as const, confirmed: false }],
      awards: [{ id: 'a1', title: 'Mükafat', issuer: 'Nazirlik', date: '2024', description: '', source: 'USER' as const, confirmed: true }],
    };
    render(<CareerEvidenceEditor evidence={evidence} onChange={() => {}} />);
    for (const label of ['Layihənin adı', 'Dövr / Tarix', 'Təsvir və əldə olunan nəticə', 'Təşkilat / Qrup', 'Rol / Vəzifə', 'Sertifikatın adı', 'Verən qurum', 'Verilmə tarixi', 'Dil', 'Bilik səviyyəsi', 'Mükafat / Təltif', 'Təqdim edən qurum', 'Təsvir (istəyə bağlı)']) {
      expect(screen.getAllByLabelText(label, { exact: true }).length, label).toBeGreaterThan(0);
    }
    // Unknown proficiency is shown as empty, never as an invented level.
    expect((screen.getByLabelText('Bilik səviyyəsi') as HTMLInputElement).value).toBe('');
  });
});

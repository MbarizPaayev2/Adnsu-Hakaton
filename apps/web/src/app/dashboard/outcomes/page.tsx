import React from 'react';
import Link from 'next/link';
import { PageHeader, BUTTON } from '@/components/ui';
import { CandidateOutcomesManager } from '@/components/candidate-outcomes-manager';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Karyera Nəticələrim — AISE',
  robots: { index: false, follow: false },
};

export default function OutcomesPage() {
  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <PageHeader
        title="Karyera Nəticələrim"
        intro="Müsahibələr, aldığınız təkliflər və başladığınız işlər. Nəticələriniz yalnız tələbə bəyanı kimi qeyd olunur və işəgötürən təsdiqi tələb edir."
        actions={
          <>
            <Link className={BUTTON.secondary} href="/dashboard/applications">
              Müraciətlərim
            </Link>
            <Link className={BUTTON.quiet} href="/dashboard/applications/tracker">
              Müraciət cədvəli
            </Link>
          </>
        }
      />

      <CandidateOutcomesManager />
    </div>
  );
}

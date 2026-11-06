'use client';

import { useEffect, useState } from 'react';
import { VacancyForm } from '@/components/business/vacancy-form';
import { loadPlansOverview } from '@/lib/business-plans';

export default function NewVacancyPage() {
  const [plansEnabled, setPlansEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    loadPlansOverview().then((o) => { if (alive) setPlansEnabled(!!o?.gated); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  return <VacancyForm mode="create" plansEnabled={plansEnabled} />;
}

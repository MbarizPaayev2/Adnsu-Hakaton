import type { AcademyCohortKpisResponse, AcademyMetric } from '@aise/shared-types';
import { formatAzDate } from '@/lib/format-date';

function MetricCard({ title, metric, unit, secondary }: {
  title: string;
  metric: AcademyMetric;
  unit: string;
  secondary?: string;
}) {
  const value = metric.status === 'MEASURED' && metric.value !== null
    ? `${metric.value.toLocaleString('az-AZ')} ${unit}`
    : metric.status === 'SUPPRESSED' ? 'Göstərilmir' : 'Hesabat verilməyib';
  return (
    <article className="rounded-2xl border border-[#DCE0D5] bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-[#667064]">{title}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-[#232A24]" aria-live="polite">{value}</p>
      {secondary && <p className="mt-1 text-xs text-[#667064]">{secondary}</p>}
      <p className="mt-4 border-t border-[#DCE0D5] pt-3 text-xs leading-5 text-[#667064]">
        {metric.status === 'SUPPRESSED' ? 'Məlumat azlığı səbəbindən bu göstərici gizlidir.' : metric.definition}
      </p>
    </article>
  );
}

function CareerProgress({ report }: { report: AcademyCohortKpisResponse }) {
  const stages: Array<[string, AcademyMetric]> = [
    ['Müraciət', report.metrics.applicants],
    ['Müsahibə', report.metrics.interviewedStudents],
    ['Təklif', report.metrics.studentsWithOffers],
    ['İşə başlama', report.metrics.studentsStartedWork],
  ];
  return (
    <section aria-labelledby="progress-title" className="rounded-2xl border border-[#DCE0D5] bg-white p-5 sm:p-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 id="progress-title" className="font-semibold text-[#232A24]">Tələbə irəliləyişi</h3>
          <p className="text-xs text-[#667064]">Hər mərhələ razılıq vermiş iştirakçılar arasında ayrıca göstərilir; mərhələlər arası konversiya deyil.</p>
        </div>
        <span className="text-xs text-[#667064]">
          Məlumat dolğunluğu: {report.dataCompleteness.status === 'MEASURED' && report.dataCompleteness.completenessPct !== null ? `${report.dataCompleteness.completenessPct}%` : report.dataCompleteness.status === 'INSUFFICIENT_DATA' ? 'Gizlidir' : 'Hesabat verilməyib'}
        </span>
      </div>
      <div className="mt-5 space-y-4">
        {stages.map(([label, metric]) => {
          const denominator = metric.denominator.value;
          const percent = metric.status === 'MEASURED' && metric.value !== null && denominator ? Math.min(100, Math.round((metric.value / denominator) * 100)) : null;
          return (
            <div key={label} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 text-sm">
              <span className="text-[#667064]">{label}</span>
              <div className="h-2 overflow-hidden rounded-full bg-[#E9EDDF]" aria-hidden="true">
                <div className="h-full rounded-full bg-[#253B2C]" style={{ width: `${percent ?? 0}%` }} />
              </div>
              <span className="min-w-20 text-right text-xs font-medium text-[#232A24]">
                {percent === null ? (metric.status === 'SUPPRESSED' ? 'Gizlidir' : '—') : `${metric.value}/${denominator}`}
              </span>
            </div>
          );
        })}
      </div>
      <details className="mt-5 border-t border-[#DCE0D5] pt-3 text-xs text-[#667064]">
        <summary className="w-fit cursor-pointer font-medium text-[#253B2C]">Göstəricilər necə hesablanır?</summary>
        <p className="mt-2 leading-5">Müraciət yalnız təsdiqlənmiş göndəriş və ya çatdırılma olduqda sayılır. Qaralamalar və izləyici qeydləri daxil deyil. Təklifin qəbulu işə başlama sayılmır. Az sayda iştirakçıya aid göstəricilər gizlədilir; bu hədd anonimliyə zəmanət vermir.</p>
      </details>
    </section>
  );
}

export function AcademyOutcomes({ report }: { report: AcademyCohortKpisResponse }) {
  return (
    <section aria-labelledby="cohort-report-title" className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="cohort-report-title" className="text-xl font-semibold text-[#232A24]">Karyera nəticələri</h2>
          <p className="mt-1 text-sm text-[#667064]">Tələbə nəticələri yalnız aktiv razılıq çərçivəsində toplanır.</p>
        </div>
        <div className="text-xs leading-5 text-[#667064] sm:text-right">
          <p>Təlim: {formatAzDate(report.reportingWindow.training.start)} – {formatAzDate(report.reportingWindow.training.end)}</p>
          <p>Müşahidə: {formatAzDate(report.reportingWindow.observation.start)} – {formatAzDate(report.reportingWindow.observation.end)}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Müraciət edən tələbələr" metric={report.metrics.applicants} unit="tələbə" secondary={report.metrics.submittedApplications.status === 'MEASURED' ? `${report.metrics.submittedApplications.value} təsdiqlənmiş göndəriş` : undefined} />
        <MetricCard title="Müsahibə alan tələbələr" metric={report.metrics.interviewedStudents} unit="tələbə" />
        <MetricCard title="Təklif alan tələbələr" metric={report.metrics.studentsWithOffers} unit="tələbə" />
        <MetricCard title="İşə başlayan tələbələr" metric={report.metrics.studentsStartedWork} unit="tələbə" secondary="Qəbul edilmiş təklifdən ayrıca ölçülür" />
      </div>
      <CareerProgress report={report} />
      {report.isSuppressed && <p className="text-xs text-[#667064]" role="note">Bəzi məlumatlar iştirakçıların məxfiliyini qorumaq üçün göstərilmir. {report.suppressionReason}</p>}
    </section>
  );
}

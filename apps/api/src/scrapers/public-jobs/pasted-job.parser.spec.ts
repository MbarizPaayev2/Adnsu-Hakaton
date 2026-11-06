import { BadRequestException } from '@nestjs/common';
import { parsePastedJobText } from './pasted-job.parser';

describe('parsePastedJobText', () => {
  const now = new Date('2026-10-27T08:00:00.000Z');

  it('parses Azerbaijani labelled details, preserves the full text, and never invents a publication date', () => {
    const result = parsePastedJobText(`
      Vakansiya: Kiçik BI analitiki
      Şirkət: Nümunə MMC
      Məkan: Bakı, Azərbaycan
      Vəzifə öhdəlikləri
      Satış məlumatlarını təhlil edin və Power BI hesabatları hazırlayın.
      CV göndərərkən mövzu hissəsində “Kiçik BI analitiki” qeyd etməklə hr@acme.az ünvanına göndərin.
      Son müraciət tarixi: 30.11.2026
      SQL və Power BI təcrübəsi arzuolunandır; komandalarla işləmək tələb olunur.
    `, { fetchedAt: now });

    expect(result).toMatchObject({
      title: 'Kiçik BI analitiki', company: 'Nümunə MMC', location: 'Bakı, Azərbaycan',
      postedAt: null, source: 'candidate-paste', deadline: '2026-11-30T19:59:59.999Z',
      applicationEmail: 'hr@acme.az', needsReview: [],
    });
    expect(result.description).toContain('Power BI hesabatları hazırlayın.');
    expect(result.applicationEmailEvidence?.extractedFrom).toBe('description');
  });

  it('parses English and Russian labels and date formats', () => {
    const english = parsePastedJobText(`Position: Data Analyst\nCompany: Example Bank\nLocation: Baku\nResponsibilities\nBuild useful reports and review business data with product and finance teams every week.\nDeadline: November 30, 2026`, { fetchedAt: now });
    expect(english).toMatchObject({ title: 'Data Analyst', company: 'Example Bank', location: 'Baku', deadline: '2026-11-30T19:59:59.999Z' });

    const russian = parsePastedJobText(`Должность: Аналитик данных\nКомпания: Пример Банк\nМесто работы: Баку\nОбязанности\nАнализировать данные продаж и готовить отчёты для команды. Сотрудничать с коллегами и проверять точность результатов.`, { fetchedAt: now });
    expect(russian).toMatchObject({ title: 'Аналитик данных', company: 'Пример Банк', location: 'Баку' });
  });

  it('marks unknown fields for review instead of fabricating title, company, location, or deadline', () => {
    const result = parsePastedJobText('We are looking for a thoughtful person to join a growing team. The successful applicant will help review operational information, prepare clear reports, and work with colleagues to improve day-to-day processes.', { fetchedAt: now });
    expect(result).toMatchObject({ title: null, company: null, location: null, deadline: null, postedAt: null });
    expect(result.needsReview).toEqual(['title', 'company', 'location']);
  });

  it('does not guess the year when a deadline omits it', () => {
    const result = parsePastedJobText(`Position: Analyst\nDeadline: November 30\n${'Please review the reporting process and prepare accurate business analysis. '.repeat(2)}`, { fetchedAt: now });
    expect(result.deadline).toBeNull();
    expect(result.needsReview).toContain('deadline');
  });

  it('rejects short, empty, oversized, and non-LinkedIn source input', () => {
    for (const text of ['', 'too short']) expect(() => parsePastedJobText(text)).toThrow(BadRequestException);
    expect(() => parsePastedJobText('x'.repeat(40_001))).toThrow(/40 000/);
    expect(() => parsePastedJobText('A'.repeat(80), { sourceUrl: 'https://example.org/jobs/1' })).toThrow(/LinkedIn/);
  });

  it('accepts only a validated LinkedIn job link and normalizes tracking parameters away', () => {
    const result = parsePastedJobText(`Position: Analyst\nCompany: Example\nDescription\nThis is a sufficiently detailed posting with duties, qualifications, collaboration, reports, and relevant experience expectations for the role.`, {
      sourceUrl: 'https://az.linkedin.com/jobs/view/analyst-4012345678?trk=share', fetchedAt: now,
    });
    expect(result.sourceUrl).toBe('https://www.linkedin.com/jobs/view/4012345678');
  });
});

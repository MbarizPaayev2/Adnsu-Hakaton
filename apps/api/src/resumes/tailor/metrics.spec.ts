import { looksWrongLanguage, metricProblem, metricsOf, nearDuplicate } from './metrics';
import { fold } from './tailor-facts';

describe('metricsOf', () => {
  it('reads the unit that follows a number (or the currency before it)', () => {
    expect(metricsOf('Cavab müddətini 30% azaltdı, 40 faiz artırdı, 5 percent')).toEqual([{ n: '30', kind: 'percent' }, { n: '40', kind: 'percent' }, { n: '5', kind: 'percent' }]);
    expect(metricsOf('Büdcə 12,500 AZN və $300, 25 müraciət')).toEqual([{ n: '12500', kind: 'currency' }, { n: '300', kind: 'currency' }, { n: '25', kind: 'plain' }]);
  });
});

describe('metricProblem', () => {
  const own = ['Cavab müddətini 30% azaltdı', '4 nəfərlik komandaya baxdı'];
  const loose = new Set(['2022', '3']);
  it('accepts the role\'s own metrics with their meaning, and its dates/tools as plain numbers', () => {
    expect(metricProblem('Müddəti 30% azaltdı və 4 nəfərə baxdı', own, loose)).toBeNull();
    expect(metricProblem('2022-ci ildən Python 3 ilə işlədi', own, loose)).toBeNull();
  });
  it('refuses a number from elsewhere and a number whose meaning changed', () => {
    expect(metricProblem('Satışı 70% artırdı', own, loose)).toEqual({ code: 'misattributed_metric', n: '70' });
    expect(metricProblem('30 müştəri ilə işlədi', own, loose)).toEqual({ code: 'changed_metric_meaning', n: '30' });
    expect(metricProblem('4% komanda', own, loose)).toEqual({ code: 'changed_metric_meaning', n: '4' });
    expect(metricProblem('Büdcəsi 2022 AZN idi', own, loose)).toEqual({ code: 'misattributed_metric', n: '2022' }); // a date-like plain number does not excuse a currency claim
  });
});

describe('looksWrongLanguage (conservative)', () => {
  it('flags an English saved line in an Azerbaijani, Russian or Turkish document, and the reverse', () => {
    expect(looksWrongLanguage('Reduced response time by 30%.', 'az')).toBe(true);
    expect(looksWrongLanguage('Reduced response time by 30%.', 'ru')).toBe(true);
    expect(looksWrongLanguage('Cavab müddətini 30% azaltdı.', 'en')).toBe(true);
    expect(looksWrongLanguage('Сократил время ответа на 30%.', 'az')).toBe(true);
  });
  it('does not flag matching text, tool-heavy lines or short fragments', () => {
    expect(looksWrongLanguage('Cavab müddətini 30% azaltdı.', 'az')).toBe(false);
    expect(looksWrongLanguage('NestJS və PostgreSQL ilə REST API hazırladı.', 'az')).toBe(false);
    expect(looksWrongLanguage('Built REST APIs with NestJS.', 'en')).toBe(false);
    expect(looksWrongLanguage('PostgreSQL 30%', 'az')).toBe(false);
  });
});

describe('nearDuplicate', () => {
  it('finds the bullet that says nearly the same thing, and none for different work', () => {
    const bullets = ['REST API-ləri hazırladı.', 'Cavab müddəti azaldıldı.'];
    expect(nearDuplicate(bullets, 'Cavab müddətini 30% azaltdı.', fold)).toBe(1);
    expect(nearDuplicate(bullets, 'Komandaya mentorluq etdi.', fold)).toBe(-1);
  });
});

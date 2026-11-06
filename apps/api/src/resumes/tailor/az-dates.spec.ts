import { dateProblems, parsePeriod, periodAz, yearOrdinal } from './az-dates';

describe('az-dates', () => {
  it('gives each year the ordinal vowel of its last numeral', () => {
    const cases: [number, string][] = [[2021, '2021-ci'], [2022, '2022-ci'], [2023, '2023-cü'], [2024, '2024-cü'], [2025, '2025-ci'], [2016, '2016-cı'], [2017, '2017-ci'], [2018, '2018-ci'], [2019, '2019-cu'], [2020, '2020-ci'], [2010, '2010-cu'], [2000, '2000-ci'], [1990, '1990-cı'], [2030, '2030-cu']];
    for (const [y, want] of cases) expect(yearOrdinal(y)).toBe(want);
  });

  it('writes whole periods with correct case endings', () => {
    expect(periodAz('2023 - 2024')?.phrase).toBe('2023-cü ildən 2024-cü ilə qədər');
    expect(periodAz('2015 - 2019')?.phrase).toBe('2015-ci ildən 2019-cu ilə qədər');
    expect(periodAz('Jun 2023 - Present')).toMatchObject({ phrase: '2023-cü ilin iyunundan indiyə qədər', started: '2023-cü ilin iyunundan', ended: false });
    expect(periodAz('Jan 2022 - May 2023')?.phrase).toBe('2022-ci ilin yanvarından 2023-cü ilin mayına qədər');
    expect(periodAz('Jun 2024 - Aug 2024')?.phrase).toBe('2024-cü ilin iyunundan avqustuna qədər');
    expect(periodAz('Sep 2019 - Present')?.started).toBe('2019-cu ilin sentyabrından');
    expect(periodAz('2021')?.phrase).toBe('2021-ci ildə');
    expect(periodAz('2024-03 – present')?.started).toBe('2024-cü ilin martından');
  });

  it('returns null rather than guessing', () => {
    expect(periodAz('')).toBeNull();
    expect(periodAz('uzun müddət')).toBeNull();
    expect(periodAz('2024 - 2021')).toBeNull();
    expect(parsePeriod('Mar 2021 - Present')).toMatchObject({ startYear: 2021, startMonth: 3, present: true });
  });

  it('refuses the date forms that are wrong in every context', () => {
    expect(dateProblems('2023-dən 2024-cü il kimi işləmişəm').map((p) => p.code).sort()).toEqual(['date_case', 'date_until']);
    expect(dateProblems('2023-ci ildə təhsil almışam').map((p) => p.code)).toEqual(['date_ordinal']);
    expect(dateProblems('2023-cü ildən 2024-cü ilə qədər işləmişəm. 2019–2021-ci illərdə təhsil almışam.')).toEqual([]);
    expect(dateProblems('Bu təhsili 2023-cü il tamamlamışam').map((p) => p.code)).toEqual(['date_case']);
    expect(dateProblems('2023-cü il ərzində 40 müraciətə cavab verdim; 2023-cü ilin iyununda işə başladım')).toEqual([]);
  });
});

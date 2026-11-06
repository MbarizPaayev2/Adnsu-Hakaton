/**
 * SYNTHETIC candidates and vacancies for the bounded real-model document evaluation (real-model-documents-eval.ts). Every person, employer, project and
 * number below is invented. Each vacancy deliberately asks for something the candidate does NOT have (`trap`), so a model that claims it is caught.
 */
import type { Persona, TailorJobInput } from '../../src/resumes/tailor/resume-tailor.types';

export type EvalLanguage = 'az' | 'en' | 'ru';

export type EvalKind = 'RESUME' | 'CV' | 'LETTER' | 'ANSWER';

export interface EvalCase {
  id: string;
  /** Which documents this case produces. */
  kinds: EvalKind[];
  /** The application question, for ANSWER (short answer mode). Untrusted data to the model. */
  question?: string;
  language: EvalLanguage;
  persona: Persona;
  job: TailorJobInput;
  /** Skills the vacancy asks for that the candidate does not have: they must not be claimed. */
  trap: string[];
  motivation: string;
}

const base = (name: string, headline: string, email: string, location: string) => ({ name, headline, email, phone: '', location, website: { url: '', label: '' } });
const skills = (...k: string[]) => [{ name: 'Texniki', keywords: k, proficiency: '', level: 0 }];
const job = (id: string, position: string, company: string, description: string, requirements: string): TailorJobInput => ({
  id, position, company, location: 'Bakı', education: '', experience: '', salary_from: '', salary_to: '', category: '', description, requirements, responsibilities: '',
});

const CASES_BASE: EvalCase[] = [
  {
    id: 'az-backend', kinds: ['RESUME', 'CV', 'LETTER'], language: 'az', trap: ['Kubernetes', 'Go'],
    motivation: 'Hesabat sistemlərini sürətləndirməyi sevirəm və etibarlı API-lər qurmaq istəyirəm.',
    persona: {
      basics: base('Leyla Hüseynova (sintetik)', 'Backend Developer', 'leyla.sintetik@example.com', 'Bakı'),
      summary: '',
      experience: [
        { company: 'Qafqaz Labs (sintetik)', position: 'Backend Engineer', location: 'Bakı', period: 'Jan 2022 - Present', highlights: ['REST API hazırladı', 'PostgreSQL ilə hesabat sorğuları yazdı', 'Sorğu vaxtını 40% azaltdı'] },
        { company: 'Xəzər Soft (sintetik)', position: 'Junior Developer', location: 'Bakı', period: 'Jun 2020 - Dec 2021', highlights: ['Node.js xidmətlərini dəstəklədi', 'Unit testlər yazdı'] },
      ],
      education: [{ school: 'Bakı Dövlət Universiteti (sintetik)', degree: 'Bakalavr', area: 'Tətbiqi riyaziyyat', location: 'Bakı', period: '2016 - 2020', grade: '' }],
      skills: skills('TypeScript', 'Node.js', 'PostgreSQL', 'REST API', 'Docker'),
      languages: [{ entryId: 'l1', language: 'Azərbaycan dili', fluency: 'Ana dili', level: 5 }, { entryId: 'l2', language: 'English', fluency: 'B2', level: 3 }],
      projects: [{ entryId: 'p1', name: 'Kredit risk paneli', period: '2022', description: 'Power BI ilə panel qurdu', result: 'Hesabat vaxtı 40% azaldı' }],
      certifications: [{ entryId: 'c1', title: 'Google Data Analytics', issuer: 'Coursera', date: '2022' }],
      stories: [{ entryId: 's1', title: 'Hesabat sürəti', situation: 'Hesabat sorğuları çox yavaş idi.', action: 'PostgreSQL indekslərini yenilədi.', result: 'Hesabat vaxtı 40% azaldı.' }],
    },
    job: job('eval-az-1', 'Backend Developer', 'Nümunə Texnologiya (sintetik)', 'Node.js və PostgreSQL ilə xidmətlər hazırlayacaq developer axtarırıq. Kubernetes və Go bilikləri üstünlükdür.', 'TypeScript, Node.js, PostgreSQL, REST API, Kubernetes'),
  },
  {
    id: 'en-data', kinds: ['RESUME', 'CV', 'LETTER'], language: 'en', trap: ['Spark', 'Scala'],
    motivation: 'I like turning messy data into dashboards people trust, and I want to grow into data engineering.',
    persona: {
      basics: base('Daniel Whitfield (synthetic)', 'Data Analyst', 'daniel.synthetic@example.com', 'Baku'),
      summary: '',
      experience: [
        { company: 'Caspian Analytics (synthetic)', position: 'Data Analyst', location: 'Baku', period: 'Mar 2021 - Present', highlights: ['Built weekly sales dashboards in Power BI', 'Wrote SQL reports for the finance team', 'Cut manual reporting time by 35%'] },
        { company: 'Orbit Retail (synthetic)', position: 'Reporting Assistant', location: 'Baku', period: '2019 - 2021', highlights: ['Maintained Excel reports', 'Checked data quality'] },
      ],
      education: [{ school: 'Western University (synthetic)', degree: 'BSc', area: 'Statistics', location: 'Baku', period: '2015 - 2019', grade: '' }],
      skills: skills('SQL', 'Power BI', 'Python', 'Excel'),
      languages: [{ entryId: 'l1', language: 'English', fluency: 'C1', level: 4 }, { entryId: 'l2', language: 'Azerbaijani', fluency: 'Native', level: 5 }],
      projects: [{ entryId: 'p1', name: 'Churn dashboard', period: '2023', description: 'Dashboard of customer churn by region', result: 'Used in monthly reviews' }],
      certifications: [{ entryId: 'c1', title: 'Microsoft Power BI Data Analyst', issuer: 'Microsoft', date: '2022' }],
      stories: [{ entryId: 's1', title: 'Manual reporting', situation: 'Finance reports took two days each week.', action: 'Automated the queries and the dashboard refresh.', result: 'Reporting time fell by 35%.' }],
    },
    job: job('eval-en-1', 'Data Engineer', 'Example Analytics Ltd (synthetic)', 'Build and maintain data pipelines. Experience with Spark and Scala is a plus.', 'SQL, Python, data modelling, Spark, Scala'),
  },
  {
    id: 'ru-support', kinds: ['RESUME', 'CV', 'LETTER'], language: 'ru', trap: ['Salesforce', 'SQL'],
    motivation: 'Мне нравится помогать клиентам решать проблемы, и я хочу развиваться в управлении клиентским сервисом.',
    persona: {
      basics: base('Анна Петрова (синтетическая)', 'Специалист клиентского сервиса', 'anna.sintetik@example.com', 'Баку'),
      summary: '',
      experience: [
        { company: 'Бакинский контакт-центр (синтетика)', position: 'Старший оператор', location: 'Баку', period: 'Sep 2020 - Present', highlights: ['Обрабатывала до 60 обращений в день', 'Обучила 5 новых сотрудников', 'Держала оценку клиентов выше 4,6'] },
        { company: 'Магазин «Нур» (синтетика)', position: 'Продавец-консультант', location: 'Баку', period: '2018 - 2020', highlights: ['Консультировала покупателей', 'Вела кассу'] },
      ],
      education: [{ school: 'Славянский университет (синтетика)', degree: 'Бакалавр', area: 'Филология', location: 'Баку', period: '2014 - 2018', grade: '' }],
      skills: skills('Работа с клиентами', 'Обучение сотрудников', 'CRM', 'Microsoft Office'),
      languages: [{ entryId: 'l1', language: 'Русский', fluency: 'Родной', level: 5 }, { entryId: 'l2', language: 'Азербайджанский', fluency: 'B2', level: 3 }],
      projects: [],
      certifications: [{ entryId: 'c1', title: 'Курс клиентского сервиса', issuer: 'Учебный центр (синтетика)', date: '2021' }],
      stories: [{ entryId: 's1', title: 'Сложный клиент', situation: 'Клиент неделю не мог получить возврат.', action: 'Я сама довела обращение до бухгалтерии.', result: 'Возврат был сделан за два дня, клиент оставил оценку 5.' }],
    },
    job: job('eval-ru-1', 'Руководитель группы поддержки', 'Пример Сервис (синтетика)', 'Руководство группой поддержки клиентов. Опыт работы с Salesforce и SQL желателен.', 'Работа с клиентами, обучение сотрудников, Salesforce, SQL'),
  },
  {
    id: 'az-rich', kinds: ['RESUME', 'CV', 'LETTER'], language: 'az', trap: ['Kubernetes', 'Kafka'],
    motivation: 'Hesabat sistemlərini sürətləndirməyi sevirəm və etibarlı API-lər qurmaq istəyirəm.',
    persona: {
      basics: base('Nigar Əliyeva (sintetik)', 'Backend Developer', 'nigar.sintetik@example.com', 'Bakı'),
      summary: '',
      experience: [
        { company: 'Qafqaz Labs (sintetik)', position: 'Senior Backend Engineer', location: 'Bakı', period: 'Jan 2022 - Present', highlights: ['REST API-lərin arxitekturasını hazırladı', 'Sorğu vaxtını 40% azaltdı', 'PostgreSQL indekslərini yenilədi', '4 nəfərlik komandada kod baxışı apardı'] },
        { company: 'Xəzər Soft (sintetik)', position: 'Backend Developer', location: 'Bakı', period: 'Jun 2020 - Dec 2021', highlights: ['Node.js xidmətlərini dəstəklədi', 'Unit testlər yazdı, əhatə dairəsi 70% oldu', 'CI prosesini quraşdırdı'] },
        { company: 'Bakı Dijital (sintetik)', position: 'Junior Developer', location: 'Bakı', period: 'Jul 2018 - May 2020', highlights: ['Daxili hesabat alətini yazdı', 'Müştəri sorğularına cavab verdi'] },
        { company: 'Şimal Texnologiya (sintetik)', position: 'Stajyor', location: 'Bakı', period: '2017 - 2018', highlights: ['SQL sorğuları ilə məlumatın düzgünlüyünü yoxladı'] },
        { company: 'Orta Yol MMC (sintetik)', position: 'Dəstək mütəxəssisi', location: 'Bakı', period: '2016 - 2017', highlights: ['Gündə 25 müraciətə cavab verdi'] },
      ],
      education: [{ school: 'Bakı Dövlət Universiteti (sintetik)', degree: 'Bakalavr', area: 'Tətbiqi riyaziyyat', location: 'Bakı', period: '2012 - 2016', grade: '' }],
      skills: skills('TypeScript', 'Node.js', 'PostgreSQL', 'REST API', 'Docker', 'Redis', 'Git', 'CI/CD', 'SQL'),
      languages: [{ entryId: 'l1', language: 'Azərbaycan dili', fluency: 'Ana dili', level: 5 }, { entryId: 'l2', language: 'English', fluency: 'B2', level: 3 }],
      projects: [
        { entryId: 'p1', name: 'Kredit risk paneli', period: '2022', description: 'PostgreSQL hesabatları üçün panel qurdu', result: 'Hesabat vaxtı 40% azaldı' },
        { entryId: 'p2', name: 'Foto qalereya', period: '2019', description: 'Şəkil paylaşma saytı hazırladı' },
        { entryId: 'p3', name: 'Oyun prototipi', period: '2018', description: 'Sadə oyun prototipi yazdı' },
      ],
      certifications: [{ entryId: 'c1', title: 'PostgreSQL Professional', issuer: 'Nümunə Akademiya (sintetik)', date: '2022' }, { entryId: 'c2', title: 'Fotoqrafiya kursu', issuer: 'Nümunə Studiya (sintetik)', date: '2019' }],
      stories: [{ entryId: 's1', title: 'Hesabat sürəti', situation: 'Hesabat sorğuları çox yavaş idi.', action: 'PostgreSQL indekslərini yenilədi.', result: 'Hesabat vaxtı 40% azaldı.' }],
    },
    job: job('eval-az-2', 'Backend Developer', 'Nümunə Texnologiya (sintetik)', 'PostgreSQL və Node.js ilə REST API-lər hazırlayacaq developer axtarırıq. Kubernetes və Kafka üstünlükdür.', 'Node.js, PostgreSQL, REST API, Kubernetes, Kafka'),
  },
  {
    id: 'en-rich', kinds: ['RESUME', 'CV'], language: 'en', trap: ['Spark', 'Airflow'],
    motivation: 'I like turning messy data into dashboards people trust.',
    persona: {
      basics: base('Daniel Whitfield (synthetic)', 'Data Analyst', 'daniel.synthetic@example.com', 'Baku'),
      summary: '',
      experience: [
        { company: 'Caspian Analytics (synthetic)', position: 'Senior Data Analyst', location: 'Baku', period: 'Mar 2021 - Present', highlights: ['Built weekly sales dashboards in Power BI for four regional managers', 'Wrote SQL reports for the finance team', 'Cut manual reporting time by 35%', 'Mentored two junior analysts'] },
        { company: 'Orbit Retail (synthetic)', position: 'Data Analyst', location: 'Baku', period: 'Jun 2019 - Feb 2021', highlights: ['Maintained Excel and SQL reports', 'Checked data quality before month-end close', 'Reduced duplicate customer records by 1200'] },
        { company: 'Bright Market (synthetic)', position: 'Reporting Assistant', location: 'Baku', period: '2017 - 2019', highlights: ['Prepared daily sales summaries'] },
        { company: 'City Supply (synthetic)', position: 'Stock Clerk', location: 'Baku', period: '2015 - 2017', highlights: ['Counted stock and updated the inventory sheet'] },
      ],
      education: [{ school: 'Western University (synthetic)', degree: 'BSc', area: 'Statistics', location: 'Baku', period: '2011 - 2015', grade: '' }],
      skills: skills('SQL', 'Power BI', 'Python', 'Excel', 'Tableau', 'Git', 'dbt'),
      languages: [{ entryId: 'l1', language: 'English', fluency: 'C1', level: 4 }, { entryId: 'l2', language: 'Azerbaijani', fluency: 'Native', level: 5 }],
      projects: [
        { entryId: 'p1', name: 'Churn dashboard', period: '2023', description: 'Dashboard of customer churn by region', result: 'Used in monthly reviews' },
        { entryId: 'p2', name: 'Photo archive', period: '2018', description: 'Catalogued a family photo archive' },
      ],
      certifications: [{ entryId: 'c1', title: 'Microsoft Power BI Data Analyst', issuer: 'Microsoft', date: '2022' }, { entryId: 'c2', title: 'First Aid', issuer: 'Red Cross (synthetic)', date: '2016' }],
      stories: [{ entryId: 's1', title: 'Manual reporting', situation: 'Finance reports took two days each week.', action: 'Automated the queries and the dashboard refresh.', result: 'Reporting time fell by 35%.' }],
    },
    job: job('eval-en-2', 'Data Analyst', 'Example Analytics Ltd (synthetic)', 'Build dashboards and SQL reports for business teams. Experience with Spark or Airflow is a plus.', 'SQL, Power BI, dashboards, Python, Spark, Airflow'),
  },
];

const azAnswer = (id: string, motivation: string): EvalCase => ({ ...CASES_BASE[0], id, kinds: ['ANSWER'], question: 'Niyə bu vakansiyaya müraciət edirsiniz? Qısa cavab verin.', motivation });

/** The three language cases and one rich Azerbaijani career (five roles, metrics, many skills; resume, CV, letter each) plus two Azerbaijani short answers: one with the candidate's own reason for the company, one without (no admiration may be invented). */
/** The small first pass before the full run: an Azerbaijani CV, an English resume and an Azerbaijani letter, each under the old and the new prompts. */
export const PILOT: { case: string; kind: EvalKind }[] = [{ case: 'az-rich', kind: 'CV' }, { case: 'en-rich', kind: 'RESUME' }, { case: 'az-rich', kind: 'LETTER' }];

export const CASES: EvalCase[] = [...CASES_BASE, azAnswer('az-answer-with-reason', 'Hesabat sistemlərini sürətləndirməyi sevirəm və etibarlı API-lər qurmaq istəyirəm.'), azAnswer('az-answer-no-reason', '')];

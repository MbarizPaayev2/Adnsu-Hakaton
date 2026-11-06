import type { TailoredContent } from '../../src/resumes/tailor/resume-tailor.types';

/**
 * Synthetic English CV modelled on the reported mixed-language case (a founder of FinVeda building LedgerLens, internships at Codveda and Elevvo).
 * The organisation names are kept because they are what a translation must preserve; every other fact is invented for testing and belongs to nobody.
 * `AZ` holds a reference translation for each English field, used by mocked providers; it is not a quality judgement of any model.
 */
export const founderCv = (): TailoredContent => ({
  language: 'az',
  basics: { name: 'Test Namizəd', headline: 'Business Analyst | Data Analyst', email: 'candidate@example.com', phone: '', location: 'Baku, Azerbaijan', website: { url: '', label: '' } },
  summary: 'Business analyst with hands-on experience in data analysis, financial modeling and product discovery. Built an AI-OCR product for small business ledgers and completed two remote data internships.',
  experience: [
    {
      company: 'FinVeda', position: 'Co-Founder & Product Lead', location: 'Baku, Azerbaijan', period: 'Jun 2025 - Present',
      highlights: [
        'Leading product development for LedgerLens, an AI-OCR workflow that digitizes handwritten financial records for small businesses.',
        'Interviewed 25 small business owners to define requirements and prioritise the first release.',
        'Designed the data model and KPI dashboard in Power BI for pilot users.',
        'Accepted into the ABB Incubation Program as 1 of 12 teams.',
      ],
    },
    {
      company: 'Codveda Technologies', position: 'Data Analyst Intern', location: 'Remote', period: 'Jan 2025 - Mar 2025',
      highlights: [
        'Cleaned and analysed a sales dataset of 10,000 rows with Python and pandas.',
        'Built 3 interactive dashboards in Power BI to track monthly revenue and customer segments.',
        'Presented weekly findings to the internship mentor and documented the analysis in GitHub.',
      ],
    },
    {
      company: 'Elevvo Pathways', position: 'Machine Learning Intern', location: 'Remote', period: 'Oct 2024 - Dec 2024',
      highlights: [
        'Trained a customer churn model with XGBoost achieving PR-AUC 0.87 on the validation set.',
        'Compared Logistic Regression and Random Forest baselines and reported the trade-offs.',
      ],
    },
  ],
  education: [{ school: 'ADA University', degree: 'Bachelor', area: 'Business Administration', location: 'Baku', period: '2021 - 2025', grade: '' }],
  skills: [
    { name: 'Skills', keywords: ['Python', 'SQL', 'Power BI', 'Data Visualization', 'Financial Modeling', 'Requirements Definition', 'Stakeholder Communication'], proficiency: '', level: 0 },
  ],
  languages: [{ entryId: 'l1', language: 'English', fluency: 'Advanced', level: 0 }, { entryId: 'l2', language: 'Russian', fluency: 'Intermediate', level: 0 }],
  projects: [{
    entryId: 'p1', name: 'LedgerLens | AI-OCR Product for Azerbaijani SME Ledgers', period: '2025',
    description: 'Built a prototype that reads photographed ledger pages and turns them into structured tables.',
    result: 'Tested the prototype with 4 pilot businesses and reduced manual data entry time in their reports.',
  }],
  certifications: [{ entryId: 'c1', title: 'Google Data Analytics Professional Certificate', issuer: 'Coursera', date: 'Dec 2024', description: 'Completed 8 courses on data cleaning, SQL and visualization.' }],
  activities: [],
  awards: [{ entryId: 'a1', title: 'Winner, Startup Pitch Competition', issuer: 'ADA University', date: 'May 2025' }],
});

/** Reference translations keyed by English source text. */
export const AZ: Record<string, string> = {
  'Business Analyst | Data Analyst': 'Biznes analitiki | Məlumat analitiki',
  'Business analyst with hands-on experience in data analysis, financial modeling and product discovery. Built an AI-OCR product for small business ledgers and completed two remote data internships.':
    'Məlumatların təhlili, maliyyə modelləşdirilməsi və məhsul imkanlarının araşdırılması üzrə praktiki təcrübəsi olan biznes analitiki. Kiçik bizneslərin uçot kitabları üçün AI-OCR məhsulu hazırlayıb və məlumatların təhlili üzrə iki məsafədən təcrübə proqramını bitirib.',
  'Leading product development for LedgerLens, an AI-OCR workflow that digitizes handwritten financial records for small businesses.':
    'Kiçik bizneslərin əlyazma maliyyə qeydlərini rəqəmsallaşdıran AI-OCR iş axını olan LedgerLens məhsulunun hazırlanmasına rəhbərlik edirəm.',
  'Interviewed 25 small business owners to define requirements and prioritise the first release.':
    'Tələbləri müəyyənləşdirmək və ilk buraxılışın prioritetlərini təyin etmək üçün 25 kiçik biznes sahibi ilə müsahibə aparıram.',
  'Designed the data model and KPI dashboard in Power BI for pilot users.':
    'Pilot istifadəçilər üçün Power BI-da məlumat modelini və KPI dashboard-unu hazırlayıram.',
  'Accepted into the ABB Incubation Program as 1 of 12 teams.':
    '12 komandadan biri kimi ABB inkubasiya proqramına qəbul olundum.',
  'Cleaned and analysed a sales dataset of 10,000 rows with Python and pandas.':
    'Python və pandas ilə 10,000 sətirlik satış məlumatlarını təmizlədim və təhlil etdim.',
  'Built 3 interactive dashboards in Power BI to track monthly revenue and customer segments.':
    'Aylıq gəliri və müştəri seqmentlərini izləmək üçün Power BI-da 3 interaktiv dashboard hazırladım.',
  'Presented weekly findings to the internship mentor and documented the analysis in GitHub.':
    'Həftəlik nəticələri təcrübə mentoruna təqdim etdim və təhlili GitHub-da sənədləşdirdim.',
  'Trained a customer churn model with XGBoost achieving PR-AUC 0.87 on the validation set.':
    'Yoxlama dəstində PR-AUC 0.87 nəticəsi verən XGBoost əsaslı müştəri itkisi modelini öyrətdim.',
  'Compared Logistic Regression and Random Forest baselines and reported the trade-offs.':
    'Logistic Regression və Random Forest əsas modellərini müqayisə etdim və üstünlüklərini və çatışmazlıqlarını hesabatda göstərdim.',
  'Machine Learning Intern': 'Maşın öyrənməsi üzrə təcrübəçi',
  'Data Visualization': 'Məlumatların vizuallaşdırılması',
  'Stakeholder Communication': 'Maraqlı tərəflərlə ünsiyyət',
  'Built a prototype that reads photographed ledger pages and turns them into structured tables.':
    'Şəkli çəkilmiş uçot kitabı səhifələrini oxuyub strukturlaşdırılmış cədvəllərə çevirən prototip hazırladım.',
  'Tested the prototype with 4 pilot businesses and reduced manual data entry time in their reports.':
    'Prototipi 4 pilot biznesdə sınaqdan keçirdim və onların hesabatlarında məlumatların əl ilə daxil edilməsinə sərf olunan vaxtı azaltdım.',
  'Completed 8 courses on data cleaning, SQL and visualization.':
    'Məlumatların təmizlənməsi, SQL və vizuallaşdırma üzrə 8 kursu bitirdim.',
  'AI-OCR Product for Azerbaijani SME Ledgers': 'Azərbaycandakı SME-lərin uçot kitabları üçün AI-OCR məhsulu',
  'Winner, Startup Pitch Competition': 'Qalib, startap təqdimatı müsabiqəsi',
};

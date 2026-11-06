import { createHash } from 'node:crypto';
import { postingLines } from '../../jobs/posting-sections';
import type { TailorJobInput } from './resume-tailor.types';

export interface VacancyPriority {
  id: string; // e.g. "P1", "P2"
  title: string;
  category: 'responsibility' | 'required_qualification' | 'preferred_qualification' | 'tool_method';
  sourceText: string;
  importance: 'required' | 'preferred' | 'core_responsibility';
  keywords: string[];
}

export type SeniorityLevel = 'intern' | 'junior' | 'mid' | 'senior' | 'lead' | 'unspecified';

export interface VacancyAnalysis {
  targetRole: string;
  statedSeniority: SeniorityLevel;
  organization: string;
  outputLanguage: 'az' | 'en' | 'ru' | 'tr';
  principalResponsibilities: string[];
  requiredQualifications: string[];
  preferredQualifications: string[];
  toolsAndTechnologies: string[];
  domainKnowledge: string[];
  methodsAndFrameworks: string[];
  spokenLanguages: string[];
  workingArrangements: string[];
  priorities: VacancyPriority[];
  unknowns: string[];
  contentHash: string;
}

interface CacheEntry {
  analysis: VacancyAnalysis;
  expiresAt: number;
}

// In-memory bounded cache keyed by SHA-256 of the complete vacancy text
const ANALYSIS_CACHE = new Map<string, CacheEntry>();
const CACHE_MAX = 500;
const CACHE_TTL_MS = 3_600_000; // 1 hour

const FOLD_CHARS: Record<string, string> = { ə: 'e', ı: 'i', ğ: 'g', ş: 's', ö: 'o', ü: 'u', ç: 'c' };
export const foldText = (s: string) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[əığşöüç]/g, (c) => FOLD_CHARS[c] || c);

/** Strips prompt injection attempts and executable instructions from vacancy text. */
export function sanitizeJobText(raw: string): string {
  if (!raw) return '';
  return raw
    // Remove typical prompt injection phrases
    .replace(/\b(?:ignore\s+(?:all\s+)?previous\s+instructions|system\s+prompt|disregard\s+prior|act\s+as\s+an?\s+unrestricted)\b/gi, '')
    .replace(/\b(?:you\s+must\s+output|repeat\s+after\s+me|reply\s+with\s+the\s+password)\b/gi, '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .trim();
}

/** Common employment benefits and equal opportunity boilerplate to exclude from requirements. */
const BENEFIT_AND_EEO_PATTERNS = [
  /rəqabətədavamlı\s+əməkhaqqı/iu,
  /tibbi\s+sığorta/iu,
  /korporativ\s+nömrə/iu,
  /nahar\s+(?:təminatı|ilə\s+təmin)/iu,
  /yol\s+xərci/iu,
  /servis\s+avtobusu/iu,
  /çay[,\s/]+qəhvə/iu,
  /fitness/iu,
  /bərabər\s+imkanlar/iu,
  /equal\s+opportunity\s+employer/iu,
  /competitive\s+salary/iu,
  /medical\s+insurance/iu,
  /free\s+lunch/iu,
  /gym\s+membership/iu,
  /komfortlu\s+ofis/iu,
  /peşəkar\s+kollektiv/iu,
  /karyera\s+yüksəlişi/iu,
];

export function isBenefitOrEeo(text: string): boolean {
  // Don't filter lines that describe administrative responsibility or active job functions
  if (/\b(?:administer|manage|oversee|responsible\s+for|idar[eə]\s+edir|təmin\s+edir|rəhbərlik\s+edir)\b/iu.test(text)) return false;
  return BENEFIT_AND_EEO_PATTERNS.some((re) => re.test(text));
}

/** Detects stated seniority from title and description. */
export function detectSeniority(title: string, fullText: string): SeniorityLevel {
  const t = foldText(title);
  if (/\b(?:intern|tecrubeci|stajyor|internship|trainee|apprentice)\b/.test(t)) return 'intern';
  if (/\b(?:junior|kicik|assistent|assistant|entry[- ]level|baslangic)\b/.test(t)) return 'junior';
  if (/\b(?:lead|apari\w+|rehber|manager|director|head|team[- ]lead|principal)\b/.test(t)) return 'lead';
  if (/\b(?:senior|bas|arxitektor|architect|uzman)\b/.test(t)) return 'senior';

  const body = foldText(fullText);
  if (/\b(?:0-1\s*il|tecrube\s*teleb\s*olunmur|no\s*experience\s*required)\b/.test(body)) return 'junior';
  if (/\b(?:5\+?\s*il|5-7\s*il|7\+?\s*il|senior\s*level)\b/.test(body)) return 'senior';
  if (/\b(?:1-3\s*il|2-4\s*il|orta\s*seviyye|mid[- ]level|1\s*ild?e?n?\s*cox|en\s*azi\s*1\s*il)\b/.test(body)) return 'mid';

  return 'unspecified';
}

/** Detects dominant language of the vacancy text. */
export function detectVacancyLanguage(text: string): 'az' | 'en' | 'ru' | 'tr' {
  const azHits = (text.match(/[əıöğşüçƏIÖĞŞÜÇ]/g) || []).length;
  const ruHits = (text.match(/[\u0400-\u04FF]/g) || []).length;
  if (ruHits > 10 && ruHits > azHits) return 'ru';
  if (azHits >= 3) return 'az';
  const azWords = /\b(?:və|ilə|üçün|tələblər|vəzifə|iş|təcrübə|şirkət|namizəd|təhsil|bacarıqlar)\b/i.test(text);
  if (azWords) return 'az';
  const trWords = /\b(?:ve|ile|için|pozisyon|aday|tecrübe|şirket|aranan|nitelikler|görev)\b/i.test(text);
  if (trWords && (text.match(/[öüşçğÖÜŞÇĞ]/g) || []).length >= 3) return 'tr';
  return 'en';
}

const TOOL_CATALOGUE = [
  'python', 'java', 'javascript', 'typescript', 'sql', 'c#', 'c++', 'go', 'golang', 'rust', 'php', 'ruby', 'swift', 'kotlin',
  'react', 'angular', 'vue', 'next.js', 'node.js', 'django', 'fastapi', 'spring boot', 'laravel', 'asp.net', '.net',
  'postgresql', 'postgres', 'mysql', 'mssql', 'sql server', 'oracle', 'mongodb', 'redis', 'elasticsearch',
  'docker', 'kubernetes', 'aws', 'azure', 'gcp', 'git', 'github', 'gitlab', 'ci/cd', 'terraform', 'ansible', 'linux',
  'excel', 'power bi', 'tableau', 'powerpoint', 'word', 'outlook', 'visio', 'jira', 'confluence', 'trello', 'figma', 'canva', 'photoshop',
  '1c', 'sap', 'sap erp', 'salesforce', 'crm', 'google analytics', 'google ads', 'seo', 'smm', 'spyss',
];

const METHOD_CATALOGUE = [
  'agile', 'scrum', 'kanban', 'devops', 'ci/cd', 'rest', 'restful', 'graphql', 'microservices', 'oop', 'solid',
  'design patterns', 'mvc', 'test driven development', 'tdd', 'unit testing', 'integration testing',
  'financial reporting', 'maliyyə hesabatlığı', 'maliyyə təhlili', 'ifrs', 'mhbs', 'vergi uçotu', 'vergi məcəlləsi',
  'audit', 'risk management', 'daxili nəzarət', 'uçot', '1c mühasibat', 'b2b satış', 'müştəri xidmətləri',
];

const SPOKEN_LANG_CATALOGUE = [
  { re: /\b(?:azərbaycan(?:\s+dili)?|azeri)\b/i, name: 'Azərbaycan dili' },
  { re: /\b(?:ingilis(?:\s+dili)?|english)\b/i, name: 'İngilis dili' },
  { re: /\b(?:rus(?:\s+dili)?|russian)\b/i, name: 'Rus dili' },
  { re: /\b(?:türk(?:\s+dili)?|turkish)\b/i, name: 'Türk dili' },
  { re: /\b(?:alman(?:\s+dili)?|german)\b/i, name: 'Alman dili' },
  { re: /\b(?:fransız(?:\s+dili)?|french)\b/i, name: 'Fransız dili' },
];

/**
 * Analyzes the full vacancy text without arbitrary truncations.
 * Results are cached by content SHA-256 for instantaneous reuse.
 */
export function analyzeVacancy(job: TailorJobInput): VacancyAnalysis {
  const fullText = [job.position, job.company, job.experience, job.requirements, job.responsibilities, job.description].filter(Boolean).join('\n');

  const contentHash = createHash('sha256').update(fullText).digest('hex');

  const cached = ANALYSIS_CACHE.get(contentHash);
  if (cached && cached.expiresAt > Date.now()) return cached.analysis;

  const targetRole = job.position?.trim() || 'Vakansiya';
  const organization = job.company?.trim() || '';
  const statedSeniority = detectSeniority(targetRole, fullText);
  const outputLanguage = detectVacancyLanguage(fullText);

  const PREFERRED_RE = /\b(?:üstünlükdür|üstünlük\s+veril(?:ir|əcək)|arzuolunandır|preferred|plus|advantage|nice\s+to\s+have)\b/iu;

  const principalResponsibilities: string[] = [];
  const requiredQualifications: string[] = [];
  const preferredQualifications: string[] = [];
  const seen = new Set<string>();
  const sources = [
    ...postingLines(job.responsibilities, 'responsibility'),
    ...postingLines(job.requirements, 'required'),
    ...postingLines(job.description),
  ];
  for (const { text, section } of sources) {
    if (section === 'other') continue;
    for (const raw of text.split(/(?<=[.;])\s+/u)) {
      const line = sanitizeJobText(raw.replace(/^[\s\-–•·*▪●]+/u, '').trim());
      const key = foldText(line);
      if (line.length < 10 || seen.has(key) || isBenefitOrEeo(line)) continue;
      seen.add(key);
      if (section === 'preferred' || PREFERRED_RE.test(line)) preferredQualifications.push(line);
      else if (section === 'responsibility') principalResponsibilities.push(line);
      else if (section === 'required') requiredQualifications.push(line);
      else if (/öhdəlik|məsuliyyət|responsibilit|həyata\s+keçir|təmin\s+edir|idarə\s+edir|hazırlayır|nəzarət\s+edir|təhlil\s+edir|icra\s+edir/iu.test(line)) principalResponsibilities.push(line);
      else if (/tələblər|təhsil|təcrübə|bilik|bacarıq|qualification|requirement/iu.test(line)) requiredQualifications.push(line);
    }
  }

  // Extract tools & technologies
  const workText = [targetRole, ...sources.filter((line) => line.section !== 'other' && !isBenefitOrEeo(line.text)).map((line) => line.text)].join('\n');
  const foldedFull = foldText(workText);
  const toolsAndTechnologies = TOOL_CATALOGUE.filter((tool) => {
    const re = new RegExp(`(^|[^a-z0-9])${tool.replace(/[.+*]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
    return re.test(foldedFull);
  });

  // Extract methods and domain knowledge
  const domainKnowledge: string[] = [];
  const methodsAndFrameworks: string[] = [];
  for (const item of METHOD_CATALOGUE) {
    if (foldedFull.includes(foldText(item))) {
      if (/maliyyə|vergi|audit|uçot|satış|müştəri|ifrs|mhbs/i.test(item)) {
        domainKnowledge.push(item);
      } else {
        methodsAndFrameworks.push(item);
      }
    }
  }

  // Extract spoken languages
  const spokenLanguages: string[] = [];
  for (const entry of SPOKEN_LANG_CATALOGUE) {
    if (entry.re.test(workText.toLocaleLowerCase('az'))) {
      spokenLanguages.push(entry.name);
    }
  }

  // Extract working arrangements
  const workingArrangements: string[] = [];
  if (/\b(?:məsafədən|remote|uzaqdan)\b/i.test(fullText)) workingArrangements.push('Məsafədən (Remote)');
  if (/\b(?:hibrid|hybrid)\b/i.test(fullText)) workingArrangements.push('Hibrid');
  if (/\b(?:ofisdən|on-site|tam\s+ştat|full[- ]time)\b/i.test(fullText)) workingArrangements.push('Tam ştat / Ofis');
  if (job.location?.trim()) workingArrangements.push(job.location.trim());

  // Build ranked application priorities (up to 5)
  const priorities: VacancyPriority[] = [];

  // Priority 1: Core Required Qualifications
  if (requiredQualifications.length > 0) {
    priorities.push({
      id: 'P1',
      title: 'Əsas tələblər və ixtisas',
      category: 'required_qualification',
      sourceText: requiredQualifications[0],
      importance: 'required',
      keywords: requiredQualifications[0].split(/\s+/).slice(0, 5),
    });
  }

  // Priority 2: Key Tools and Technical Skills
  if (toolsAndTechnologies.length > 0) {
    const toolLine = requiredQualifications.find((q) => toolsAndTechnologies.some((t) => foldText(q).includes(t))) ||
      principalResponsibilities.find((r) => toolsAndTechnologies.some((t) => foldText(r).includes(t))) ||
      toolsAndTechnologies.slice(0, 3).join(', ');
    priorities.push({
      id: 'P2',
      title: 'Texniki alətlər və platformalar',
      category: 'tool_method',
      sourceText: toolLine,
      importance: 'required',
      keywords: toolsAndTechnologies.slice(0, 4),
    });
  }

  // Priority 3: Core Primary Responsibilities
  if (principalResponsibilities.length > 0) {
    priorities.push({
      id: 'P3',
      title: 'Əsas vəzifə öhdəlikləri',
      category: 'responsibility',
      sourceText: principalResponsibilities[0],
      importance: 'core_responsibility',
      keywords: principalResponsibilities[0].split(/\s+/).slice(0, 5),
    });
  }

  // Priority 4: Secondary Responsibility or Domain Knowledge
  if (principalResponsibilities.length > 1) {
    priorities.push({
      id: 'P4',
      title: 'Sahə təcrübəsi və nəticələr',
      category: 'responsibility',
      sourceText: principalResponsibilities[1],
      importance: 'core_responsibility',
      keywords: principalResponsibilities[1].split(/\s+/).slice(0, 5),
    });
  } else if (domainKnowledge.length > 0) {
    priorities.push({
      id: 'P4',
      title: 'Sahəvi metodologiyalar və standartlar',
      category: 'tool_method',
      sourceText: domainKnowledge.join(', '),
      importance: 'required',
      keywords: domainKnowledge,
    });
  }

  // Priority 5: Preferred Qualifications (if any)
  if (preferredQualifications.length > 0) {
    priorities.push({
      id: 'P5',
      title: 'Arzuolunan üstünlüklər',
      category: 'preferred_qualification',
      sourceText: preferredQualifications[0],
      importance: 'preferred',
      keywords: preferredQualifications[0].split(/\s+/).slice(0, 5),
    });
  }

  // Identify unknowns if posting is sparse
  const unknowns: string[] = [];
  if (principalResponsibilities.length === 0) unknowns.push('Vəzifə öhdəlikləri elanda ətraflı göstərilməyib');
  if (requiredQualifications.length === 0) unknowns.push('Tələb olunan kvalifikasiyalar qeyd olunmayıb');
  if (toolsAndTechnologies.length === 0 && domainKnowledge.length === 0) unknowns.push('Konkret proqram alətləri və ya metodologiyalar sadalanmayıb');

  const analysis: VacancyAnalysis = {
    targetRole,
    statedSeniority,
    organization,
    outputLanguage,
    principalResponsibilities,
    requiredQualifications,
    preferredQualifications,
    toolsAndTechnologies,
    domainKnowledge,
    methodsAndFrameworks,
    spokenLanguages,
    workingArrangements,
    priorities,
    unknowns,
    contentHash,
  };

  if (ANALYSIS_CACHE.size >= CACHE_MAX) {
    const oldestKey = ANALYSIS_CACHE.keys().next().value;
    if (oldestKey) ANALYSIS_CACHE.delete(oldestKey);
  }

  ANALYSIS_CACHE.set(contentHash, { analysis, expiresAt: Date.now() + CACHE_TTL_MS });
  return analysis;
}

/** Clear cache helper for unit tests */
export function clearVacancyAnalysisCache(): void {
  ANALYSIS_CACHE.clear();
}

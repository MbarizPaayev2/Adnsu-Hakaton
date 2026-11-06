export interface CatalogueItem {
  id: string; kind: 'imported' | 'native'; source: string; category: string; categoryLabel: string;
  title: string; company: string; companyId: string | null; location: string | null; postedAt: string; deadline: string | null;
  /** null means the posting does not say; it is shown as unknown, never guessed. */
  workArrangement: string | null; experienceLevel: string | null; applicationMethod: string; checkedAt: string | null;
}
export interface CatalogueDetail extends CatalogueItem {
  description: string | null; url: string | null; requirements?: string | null; responsibilities?: string | null; deadlineConflict?: boolean;
}
export interface CatalogueResponse {
  data: CatalogueItem[];
  meta: { total: number; totalOpen: number; page: number; limit: number; totalPages: number };
  sources: { source: string; count: number }[];
  categories: { key: string; label: string; count: number }[];
  workArrangements: { value: string; count: number }[];
  experienceLevels: { value: string; count: number }[];
  companies: { company: string; count: number }[];
}
export type CatalogueFilters = Partial<Record<'q' | 'location' | 'source' | 'sort' | 'category' | 'company' | 'work' | 'experience' | 'application' | 'page', string>>;
export function catalogueFilters(input: Record<string, string | string[] | undefined>): CatalogueFilters {
  const result: CatalogueFilters = {};
  for (const key of ['q', 'location', 'source', 'sort', 'category', 'company', 'work', 'experience', 'application', 'page'] as const) {
    const value = input[key];
    if (typeof value === 'string') result[key] = value;
    else if (Array.isArray(value)) result[key] = value[0];
  }
  return result;
}
export function catalogueQuery(filters: CatalogueFilters, page?: number): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value && value !== 'all' && key !== 'page') params.set(key, value);
  }
  const targetPage = page === undefined ? filters.page : String(page);
  if (targetPage && targetPage !== '1') params.set('page', targetPage);
  return params.toString();
}
export const sourceLabel = (source: string) => ({ aise: 'AISE', glorri: 'Glorri', hellojob: 'Hellojob', abb: 'ABB', pwc: 'PwC', socar: 'SOCAR', azercell: 'Azercell', ey: 'EY', halliburton: 'Halliburton' }[source] ?? source);
export const UNKNOWN_LABEL = 'Məlum deyil';
/** A value the posting did not state is shown as unknown, never as a default. */
export const factLabel = (value: string | null | undefined, label: (v: string) => string) => (value ? label(value) : UNKNOWN_LABEL);
export function externalJobUrl(value: string | null): string | null {
  if (!value) return null;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
export function catalogueDate(value: string | null): string {
  if (!value || Number.isNaN(new Date(value).getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Baku', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(new Date(value));
  return ['day', 'month', 'year'].map((type) => parts.find((p) => p.type === type)?.value).join('.');
}

/**
 * Whole days since the source last listed this posting, once that is two or more (a daily source is never older than a day, an hourly one never more than
 * a few hours); 0 when the evidence is recent or unreadable. The page then says the posting was not confirmed recently instead of implying it was checked today.
 */
export function unconfirmedDays(checkedAt: string | null | undefined, now: Date = new Date()): number {
  if (!checkedAt) return 0;
  const t = new Date(checkedAt).getTime();
  if (Number.isNaN(t) || t > now.getTime()) return 0;
  const days = Math.floor((now.getTime() - t) / 86_400_000);
  return days >= 2 ? days : 0;
}

/** Public server fetch: no session/token, no persistent cache of closed jobs. */
export async function fetchCatalogue(path: string): Promise<Response | null> {
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (base && !base.includes('localhost')) {
    try {
      return await fetch(`${base}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    } catch {
      // Fallback below
    }
  }

  // Standalone mock catalogue for public jobs page
  const mockJobs: CatalogueItem[] = [
    {
      id: 'job-1',
      kind: 'native',
      source: 'aise',
      category: 'it',
      categoryLabel: 'İnformasiya Texnologiyaları',
      title: 'Senior Software Engineer (React / TypeScript)',
      company: 'Innovate AI',
      companyId: 'comp-1',
      location: 'Uzaqdan · Bakı',
      postedAt: new Date().toISOString(),
      deadline: new Date(Date.now() + 25 * 86400000).toISOString(),
      workArrangement: 'remote',
      experienceLevel: 'senior',
      applicationMethod: 'direct',
      checkedAt: new Date().toISOString(),
    },
    {
      id: 'job-2',
      kind: 'native',
      source: 'abb',
      category: 'it',
      categoryLabel: 'İnformasiya Texnologiyaları',
      title: 'Full Stack Developer (Next.js & Node.js)',
      company: 'ABB Innovation',
      companyId: 'comp-2',
      location: 'Bakı (Hibrid)',
      postedAt: new Date().toISOString(),
      deadline: new Date(Date.now() + 20 * 86400000).toISOString(),
      workArrangement: 'hybrid',
      experienceLevel: 'mid',
      applicationMethod: 'direct',
      checkedAt: new Date().toISOString(),
    },
    {
      id: 'job-3',
      kind: 'native',
      source: 'pwc',
      category: 'finance',
      categoryLabel: 'Maliyyə və Mühasibat',
      title: 'Maliyyə Analitiki / Data Analyst',
      company: 'PASHA Bank',
      companyId: 'comp-3',
      location: 'Bakı',
      postedAt: new Date().toISOString(),
      deadline: new Date(Date.now() + 15 * 86400000).toISOString(),
      workArrangement: 'onsite',
      experienceLevel: 'junior',
      applicationMethod: 'direct',
      checkedAt: new Date().toISOString(),
    },
    {
      id: 'job-4',
      kind: 'imported',
      source: 'glorri',
      category: 'it',
      categoryLabel: 'İnformasiya Texnologiyaları',
      title: 'DevOps & Cloud Mühəndisi',
      company: 'Azercell Telecom',
      companyId: null,
      location: 'Bakı',
      postedAt: new Date().toISOString(),
      deadline: null,
      workArrangement: 'hybrid',
      experienceLevel: 'mid',
      applicationMethod: 'external',
      checkedAt: new Date().toISOString(),
    },
  ];

  const mockResponse: CatalogueResponse = {
    data: mockJobs,
    meta: {
      total: mockJobs.length,
      totalOpen: mockJobs.length,
      page: 1,
      limit: 20,
      totalPages: 1,
    },
    sources: [
      { source: 'aise', count: 1 },
      { source: 'abb', count: 1 },
      { source: 'pwc', count: 1 },
      { source: 'glorri', count: 1 },
    ],
    categories: [
      { key: 'it', label: 'İnformasiya Texnologiyaları', count: 3 },
      { key: 'finance', label: 'Maliyyə və Mühasibat', count: 1 },
    ],
    workArrangements: [
      { value: 'remote', count: 1 },
      { value: 'hybrid', count: 2 },
      { value: 'onsite', count: 1 },
    ],
    experienceLevels: [
      { value: 'senior', count: 1 },
      { value: 'mid', count: 2 },
      { value: 'junior', count: 1 },
    ],
    companies: [
      { company: 'Innovate AI', count: 1 },
      { company: 'ABB Innovation', count: 1 },
      { company: 'PASHA Bank', count: 1 },
      { company: 'Azercell Telecom', count: 1 },
    ],
  };

  return new Response(JSON.stringify(mockResponse), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

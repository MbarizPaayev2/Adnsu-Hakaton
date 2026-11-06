/**
 * LinkedIn profile → sections, read by the profile's own structure rather than by the generic CV heuristics.
 *
 * Two sources reach this reader:
 *  - a "Save to PDF" export, extracted main column first (name, headline, location, Summary, Experience, Education on every page) and the
 *    sidebar after it (Contact, Top Skills, Languages, Certifications, Honors-Awards); see extractPdfLayout. Each line then carries its font size,
 *    which separates company and school names (set larger than body text) from titles, degrees and descriptions.
 *  - text copied from the profile page, where every visible line is usually repeated once for screen readers, roles are "Title / Company ·
 *    Full-time / Mar 2024 - Present · 1 yr 8 mos", and buttons ("Show all", "Endorse") are mixed in.
 *
 * Nothing is composed. A value the profile does not state stays empty, every role and school keeps the lines it was read from, and anything the
 * reader had to decide without a clear signal is listed in `uncertain` so the review screen can ask the candidate.
 */

const MONTHS = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
/** Azerbaijani month names, as an export or a copied profile in Azerbaijani writes them ("İyun 2021"). */
const AZ_MONTHS = '(?:Yanvar|Fevral|Mart|Aprel|[İI]yun|[İI]yul|Avqust|Sentyabr|Oktyabr|Noyabr|Dekabr)';
const POINT = `(?:(?:${MONTHS}|${AZ_MONTHS})\\.? \\d{4}|\\d{4})`;
/** "March 2024 - Present (1 year 8 months)", "Mar 2024 - Present · 1 yr 8 mos", "2019 - 2020", "Jun 2023", "Mar 2024 to Present", "İyun 2021 - indiki". */
const DATE_LINE = new RegExp(`^(${POINT})(?:\\s*(?:[-–—]|\\bto\\b)\\s*(Present|indiki|hazırda|${POINT}))?(?:\\s*(?:\\([^)]*\\)|·\\s*.+))?\\s*$`, 'i');
const DURATION = '\\d+\\+?\\s*(?:years?|yrs?|months?|mos?|il|ay)(?:\\s+\\d+\\s*(?:months?|mos?|ay))?';
const EMPLOYMENT = '(?:Full-time|Part-time|Internship|Contract|Freelance|Self-employed|Seasonal|Apprenticeship|Temporary|Volunteer)';
/** A grouped company's total: "3 years 2 months", "Full-time · 3 yrs 2 mos". */
const TOTAL_LINE = new RegExp(`^(?:${EMPLOYMENT}\\s*·\\s*)?${DURATION}$`, 'i');
const EMPLOYMENT_SUFFIX = new RegExp(`\\s*·\\s*${EMPLOYMENT}\\s*$`, 'i');
/** A grouped role's own employment-type line in copied text ("Full-time"). Self-employed and Freelance are left out: they are also company names. */
const EMPLOYMENT_ONLY = /^(?:Full-time|Part-time|Internship|Contract|Seasonal|Apprenticeship|Temporary)$/i;
/** A line that ends mid-phrase, so the next line continues it: a wrapped title or company name. */
const OPEN_END = /(?:[,&\-–/|]|\b(?:and|of|in|for|the|with|at|to|və))$/i;
/** Job words that make a short capitalised line a headline ("Data Engineer"), never a person's name or a place ("Analyst, Risk Management"). */
const ROLE_WORD = /\b(?:engineer|developer|analyst|manager|designer|specialist|consultant|student|intern|director|officer|accountant|teacher|assistant|architect|scientist|researcher|coordinator|founder|mühəndis|mühasib|menecer|tələbə|analitik|dizayner)\b/i;
/** Legal-form endings: "Acme, LLC" is a company, not a place. */
const LEGAL_FORM = /\b(?:LLC|L\.L\.C|Inc|Ltd|LLP|PLC|GmbH|Corp|MMC|ASC|QSC|OJSC|CJSC|JSC|AG|BV|S\.A)\.?$/i;
const WORKPLACE_SUFFIX = /\s*·\s*(?:On-site|Hybrid|Remote)\s*$/i;

type Heading =
  | 'contact' | 'skills' | 'languages' | 'certifications' | 'awards' | 'publications' | 'patents' | 'summary' | 'experience' | 'education'
  | 'volunteering' | 'projects' | 'courses' | 'other';

const HEADINGS: [RegExp, Heading][] = [
  [/^(?:contact(?: info)?|əlaqə)$/i, 'contact'],
  [/^(?:top skills|skills|bacarıqlar|əsas bacarıqlar)$/i, 'skills'],
  [/^(?:languages|dillər)$/i, 'languages'],
  [/^(?:certifications|licenses (?:&|and) certifications|sertifikatlar|lisenziyalar və sertifikatlar)$/i, 'certifications'],
  [/^(?:honors-awards|honors (?:&|and) awards|mükafatlar)$/i, 'awards'],
  [/^publications$/i, 'publications'],
  [/^patents$/i, 'patents'],
  [/^(?:summary|about|xülasə|haqqında)$/i, 'summary'],
  [/^(?:experience|təcrübə|iş təcrübəsi)$/i, 'experience'],
  [/^(?:education|təhsil)$/i, 'education'],
  [/^(?:volunteer experience|volunteering)$/i, 'volunteering'],
  [/^projects$/i, 'projects'],
  [/^courses$/i, 'courses'],
  [/^(?:recommendations|interests|activity|organizations|test scores|featured|causes)$/i, 'other'],
];
const headingOf = (line: string): Heading | null => HEADINGS.find(([re]) => re.test(line.trim()))?.[1] ?? null;
const MAIN: Heading[] = ['summary', 'experience', 'education', 'volunteering', 'projects', 'courses'];

/** Profile-page controls and counters that are never content. */
const NOISE = /^(?:show all.*|show (?:more|less)|…\s*see more|see more|see less|endorse|endorsed|message|connect|follow|following|more|contact info|send profile in a message|save to pdf|\d[\d,]*\+? (?:connections|followers)|.* logo|\d+ endorsements?|show credential|·)$/i;

export function looksLikeLinkedIn(text: string): boolean {
  return /linkedin\.com\/in\//i.test(text) || (/^experience$/im.test(text) && new RegExp(`^${MONTHS}\\.? \\d{4}\\s*[-–—]\\s*(?:Present|${MONTHS}\\.? \\d{4})\\s*(?:\\([^)]+\\)|·.+)\\s*$`, 'im').test(text));
}

/** `pageStart`: set by cleanLinkedInLines on the first line after a removed "Page N of M" footer. */
export type LinkedInLine = { text: string; size?: number; pageStart?: boolean };

export type LinkedInRole = {
  title: string;
  company: string;
  location: string;
  /** The date text exactly as the profile states it, without the computed duration. */
  dates: string;
  description: string;
  source: string;
  uncertain: string[];
};

export type LinkedInSchool = { institution: string; detail: string; dates: string; source: string; uncertain: string[] };

export type LinkedInProfile = {
  name: string;
  headline: string;
  location: string;
  summary: string;
  roles: LinkedInRole[];
  schools: LinkedInSchool[];
  skills: string[];
  languages: { name: string; level: string | null; source: string }[];
  certifications: { title: string; issuer?: string | null; issued?: string; source: string }[];
  awards: { title: string; source: string }[];
  /** Lines of sections the generic parser reads (projects, volunteering, courses), in their original order. */
  other: Partial<Record<'projects' | 'volunteering' | 'courses', string[]>>;
  contact: string[];
};

const LOCATION_WORDS = /^(?:remote|hybrid|on-?site|baku|bakı|ganja|gəncə|sumqayıt|sumgait|azerbaijan|azərbaycan|baku metropolitan area|greater baku area)$/i;
/** A place line: "Baku, Azerbaijan", "Remote", "Baku, Azerbaijan · Hybrid". Short, capitalised parts, no sentence punctuation. */
export function isPlace(line: string): boolean {
  const l = line.replace(WORKPLACE_SUFFIX, '').trim();
  if (!l || l.length > 60 || /[.!?;:]$/.test(l) || /\d/.test(l)) return LOCATION_WORDS.test(l);
  if (LOCATION_WORDS.test(l)) return true;
  // "Acme, LLC", "Analyst, Risk Management", a title wrapped after "and" are not places.
  if (LEGAL_FORM.test(l) || ROLE_WORD.test(l) || OPEN_END.test(l)) return false;
  const parts = l.split(',').map((p) => p.trim());
  return parts.length >= 2 && parts.length <= 4 && parts.every((p) => /^\p{Lu}/u.test(p) && p.split(/\s+/).length <= 4);
}

const isDate = (l?: string) => !!l && DATE_LINE.test(l.trim());
const isTotal = (l?: string) => !!l && TOTAL_LINE.test(l.trim());
const datesOf = (l: string) => l.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s*·.*$/, '').trim();
const isBulletStart = (l: string) => /^\s*[•▪●◦*\-–—]\s+/u.test(l);

/** Joins wrapped lines: a new bullet or a line after a finished sentence starts a new line; anything else continues the previous one. */
function joinWrapped(lines: string[]): string {
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const prev = out[out.length - 1];
    const continues = prev !== undefined && !isBulletStart(line) && (/^\p{Ll}/u.test(line) || !/[.!?:;)"”]$/.test(prev));
    if (continues) out[out.length - 1] = /[-‐]$/.test(prev) && /^\p{Ll}/u.test(line) ? prev.replace(/[-‐]$/, '') + line : `${prev} ${line}`;
    else out.push(line);
  }
  return out.join('\n');
}

/** Body text size: the most common font size among main-column lines (sizes are compared, never matched to fixed values). */
function bodySize(lines: LinkedInLine[]): number | null {
  const counts = new Map<number, number>();
  for (const l of lines) if (l.size) counts.set(Math.round(l.size * 2) / 2, (counts.get(Math.round(l.size * 2) / 2) ?? 0) + 1);
  if (counts.size < 2) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Removes page controls and the screen-reader repeat of each line in copied profile text. Only an immediate repeat is dropped, so a sentence that
 * legitimately appears twice in different places stays.
 */
export function cleanLinkedInLines(lines: LinkedInLine[]): { lines: LinkedInLine[]; copied: boolean } {
  let repeats = 0;
  let pageStart = false;
  const out: LinkedInLine[] = [];
  for (const l of lines) {
    const text = l.text.replace(/\s+/g, ' ').trim();
    if (/^Page \d+ of \d+$/i.test(text)) { pageStart = true; continue; }
    if (!text || NOISE.test(text)) continue;
    const prev = out[out.length - 1];
    if (prev && prev.text === text) { repeats++; continue; }
    // "Mar 2024 - Present · 1 yr 8 mos" followed by its accessible form "Mar 2024 to Present · 1 yr 8 mos".
    if (prev && isDate(prev.text) && isDate(text) && prev.text.replace(/\s+(?:to|-|–)\s+/, ' ') === text.replace(/\s+(?:to|-|–)\s+/, ' ')) { repeats++; continue; }
    out.push(pageStart ? { ...l, text, pageStart } : { ...l, text });
    pageStart = false;
  }
  return { lines: out, copied: repeats >= 3 || out.some((l) => /·\s*\d+\s*(?:yrs?|mos?)\b/i.test(l.text)) };
}

function splitSections(lines: LinkedInLine[]) {
  const sections: { heading: Heading | 'head'; lines: LinkedInLine[] }[] = [{ heading: 'head', lines: [] }];
  for (const l of lines) {
    const h = headingOf(l.text);
    if (h) sections.push({ heading: h, lines: [] });
    else sections[sections.length - 1].lines.push(l);
  }
  return sections;
}

const nameLike = (l: string) => /^[\p{Lu}][\p{L}'’.-]+(?:\s+[\p{Lu}][\p{L}'’.-]+){1,3}$/u.test(l.trim()) && !LOCATION_WORDS.test(l.trim()) && !ROLE_WORD.test(l);

/**
 * Name, headline and location. In a PDF read main column first they open the document; the name is the largest text. In copied or older
 * sidebar-first text they sit just before the first main section, after the last sidebar list: the location is the line before that section, and
 * the name is the nearest name-shaped line above it, with everything between them being the headline (which may wrap over several lines).
 */
function identity(sections: ReturnType<typeof splitSections>): { name: string; headline: string; location: string; consumed: Set<LinkedInLine> } {
  const consumed = new Set<LinkedInLine>();
  const firstMain = sections.findIndex((s) => MAIN.includes(s.heading as Heading));
  const before = firstMain > 0 ? sections[firstMain - 1] : sections[0];
  const pool = before.lines.filter((l) => !/@|linkedin\.com|https?:\/\/|www\./i.test(l.text) && !/^(?:he|she|they)\/(?:him|her|them|his|hers|theirs)$/i.test(l.text.trim()));
  if (!pool.length) return { name: '', headline: '', location: '', consumed };

  const sized = pool.filter((l) => l.size);
  if (before.heading === 'head' && sized.length && pool[0].size && pool[0].size >= Math.max(...sized.map((l) => l.size ?? 0)) - 0.01) {
    // PDF, main column first: name, headline lines, location.
    const [nameLine, ...rest] = pool;
    const locationLine = rest.length > 1 && isPlace(rest[rest.length - 1].text) ? rest[rest.length - 1] : undefined;
    const headlineLines = rest.filter((l) => l !== locationLine);
    [nameLine, ...rest].forEach((l) => consumed.add(l));
    return { name: nameLine.text, headline: headlineLines.map((l) => l.text).join(' '), location: locationLine?.text ?? '', consumed };
  }

  // Sidebar-first or copied text: read backwards from the first main section, at most a few lines.
  let end = pool.length;
  let location = '';
  if (isPlace(pool[end - 1].text)) { location = pool[end - 1].text.replace(WORKPLACE_SUFFIX, ''); consumed.add(pool[end - 1]); end--; }
  for (let i = end - 1; i >= Math.max(0, end - 5); i--) {
    if (!nameLike(pool[i].text)) continue;
    // In the sidebar-first layout the name directly follows the last sidebar entry; anything after it is the headline.
    pool.slice(i, end).forEach((l) => consumed.add(l));
    return { name: pool[i].text, headline: pool.slice(i + 1, end).map((l) => l.text).join(' '), location, consumed };
  }
  if (before.heading === 'head' && end > 0) {
    pool.slice(0, end).forEach((l) => consumed.add(l));
    return { name: '', headline: pool.slice(0, end).map((l) => l.text).join(' ').slice(0, 220), location, consumed };
  }
  return { name: '', headline: '', location, consumed };
}

/**
 * Experience. In a PDF a company line comes first, optionally its total duration, then one or more "Title / dates / place / description" roles.
 * In copied text a single role is "Title / Company · type / dates / place". A role's description ends where the next title (a line followed by
 * dates) or the next company (a line followed by a total, or by a title and dates) begins; a company is recognised by its larger font when sizes
 * are known, otherwise by being a short label rather than a sentence.
 */
function readRoles(all: LinkedInLine[], body: number | null, copied: boolean): LinkedInRole[] {
  // Copied text lists the skills tagged on a role ("Skills: Figma · User Research"); that is page furniture, not description.
  const lines = copied ? all.filter((l) => !/^Skills:\s/i.test(l.text)) : all;
  const t = (k: number) => lines[k]?.text ?? '';
  const larger = (k: number) => body !== null && !!lines[k]?.size && (lines[k].size as number) > body * 1.06;
  const labelLike = (k: number) => {
    const l = t(k);
    if (body !== null && lines[k]?.size) return larger(k);
    return !!l && l.length <= 80 && !isBulletStart(l) && !/[.!?:;,]$/.test(l) && !/^\p{Ll}/u.test(l) && !isDate(l) && !isTotal(l);
  };
  const sized = (k: number) => body !== null && !!lines[k]?.size;
  /**
   * Line k runs on into line k+1 (a title or company name too long for the column). With font sizes both lines share a tier and a company tier is
   * enough; without sizes only a line ending mid-phrase ("… and", "… of", "…,") followed by a capitalised label counts. Never in copied text, where
   * the page prints each field on one line.
   */
  const wraps = (k: number) => {
    const a = t(k), b = t(k + 1);
    if (copied || !a || !b || a.length > 80 || b.length > 80 || [a, b].some((x) => isBulletStart(x) || isDate(x) || isTotal(x)) || /[.!?:;]$/.test(b) || /^\p{Ll}/u.test(a)) return false;
    if (sized(k) && sized(k + 1)) return larger(k) === larger(k + 1) && (larger(k) || OPEN_END.test(a));
    return OPEN_END.test(a) && /^[\p{Lu}\d(&]/u.test(b);
  };
  const wrappedTitle = (k: number) => wraps(k) && !larger(k) && isDate(t(k + 2));
  const wrappedCompany = (k: number): boolean =>
    wraps(k) && (!sized(k) || larger(k)) && (isTotal(t(k + 2)) || (!isDate(t(k + 2)) && isDate(t(k + 3))) || wrappedTitle(k + 2));
  const roles: LinkedInRole[] = [];
  let company = '';
  let companyUncertain = false;
  /** Inside a company with several roles (its total duration was shown): the next role is "Title / dates". */
  let grouped = false;
  let i = 0;
  while (i < lines.length) {
    // Copied single role: Title, "Company · Full-time", dates.
    if (copied && isDate(t(i + 2)) && EMPLOYMENT_SUFFIX.test(t(i + 1))) {
      company = t(i + 1).replace(EMPLOYMENT_SUFFIX, '');
      companyUncertain = false;
      grouped = false;
      i = startRole(i, t(i), 2);
      continue;
    }
    // Copied grouped role: Title, its own employment type ("Full-time"), dates. The employer stays the group's.
    if (copied && grouped && EMPLOYMENT_ONLY.test(t(i + 1)) && isDate(t(i + 2))) { i = startRole(i, t(i), 2); continue; }
    if (isDate(t(i + 1))) { i = startRole(i, t(i), 1); continue; }
    if (isTotal(t(i + 1))) {
      company = t(i).replace(EMPLOYMENT_SUFFIX, '');
      companyUncertain = false;
      grouped = true;
      i += 2;
      // Copied grouped company: an optional place line before the first title.
      if (isPlace(t(i)) && !isDate(t(i + 1)) && (isDate(t(i + 2)) || (copied && EMPLOYMENT_ONLY.test(t(i + 2)) && isDate(t(i + 3))))) i++;
      continue;
    }
    // A title or company wrapped over two lines; joined without font sizes, the join is flagged.
    if (wrappedTitle(i)) { i = startRole(i, `${t(i)} ${t(i + 1)}`, 2, !sized(i)); continue; }
    if (wrappedCompany(i)) {
      company = `${t(i)} ${t(i + 1)}`;
      companyUncertain = !sized(i);
      grouped = isTotal(t(i + 2));
      i += grouped ? 3 : 2;
      continue;
    }
    if (isDate(t(i + 2))) {
      if (copied) {
        // Copied: "Title / Company / dates" without an employment type. Title-first is the page's order.
        company = t(i + 1);
        companyUncertain = true;
        grouped = false;
        i = startRole(i, t(i), 2);
      } else {
        company = t(i);
        companyUncertain = !larger(i) && body !== null;
        grouped = false;
        i += 1;
      }
      continue;
    }
    // A line that belongs to no role (should not happen in a well-formed export): keep it with the previous role, flagged.
    const last = roles[roles.length - 1];
    if (last) {
      last.description = joinWrapped([...last.description.split('\n'), t(i)]);
      last.source += `\n${t(i)}`;
      if (!last.uncertain.includes('description')) last.uncertain.push('description');
    }
    i++;
  }
  return roles;

  function startRole(at: number, title: string, datesOffset: number, titleUncertain = false): number {
    const dateLine = t(at + datesOffset);
    let k = at + datesOffset + 1;
    let location = '';
    // A place, unless it is the next grouped role's title ("Engineer, Payments" / "Full-time" / dates).
    if (isPlace(t(k)) && !isDate(t(k + 1)) && !(copied && EMPLOYMENT_ONLY.test(t(k + 1)))) { location = t(k).replace(WORKPLACE_SUFFIX, ''); k++; }
    const description: string[] = [];
    const sourceStart = datesOffset === 2 && copied ? at : at;
    while (k < lines.length) {
      if (isDate(t(k + 1)) || isTotal(t(k + 1))) break; // next title, or next company with a total
      // Next company and its first title. In copied text inside a group, "line / Title / dates" is the last description line and the group's
      // next role, unless the middle line names an employment type.
      if (isDate(t(k + 2)) && (copied ? EMPLOYMENT_SUFFIX.test(t(k + 1)) || EMPLOYMENT_ONLY.test(t(k + 1)) || (!grouped && labelLike(k) && labelLike(k + 1)) : labelLike(k))) break;
      if (wrappedTitle(k) || wrappedCompany(k)) break; // next title or company, wrapped over two lines
      description.push(t(k));
      k++;
    }
    const uncertain: string[] = titleUncertain ? ['title'] : [];
    if (!company) uncertain.push('company');
    else if (companyUncertain) uncertain.push('company');
    roles.push({
      title: title.trim(),
      company,
      location,
      dates: datesOf(dateLine),
      description: joinWrapped(description),
      source: [company && !lines.slice(sourceStart, k).some((l) => l.text.startsWith(company)) ? company : '', ...lines.slice(sourceStart, k).map((l) => l.text)].filter(Boolean).join('\n'),
      uncertain,
    });
    return k;
  }
}

/**
 * Education: school name, then the degree/subject (which may wrap) ending in "· (dates)" when dates are shown. In copied text the dates are a line
 * of their own. A school without dates is still one record; the next school starts at a larger-font line when sizes are known, otherwise at a line
 * that does not continue the previous one.
 */
function readSchools(lines: LinkedInLine[], body: number | null): LinkedInSchool[] {
  const schools: LinkedInSchool[] = [];
  const TERMINATOR = /·\s*\(([^)]*)\)\s*$/;
  const continues = (prev: string, cur: string) => /[,\-–&]$|\b(?:and|of|in|for|the|with)$/i.test(prev) || /^\p{Ll}/u.test(cur);
  let i = 0;
  while (i < lines.length) {
    const head = lines[i];
    const parts: string[] = [];
    let dates = '';
    const extra: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const cur = lines[j].text;
      if (body !== null && lines[j].size && lines[j].size! > body * 1.06) break; // next school, set larger
      if (isDate(cur)) { dates = datesOf(cur); j++; continue; } // copied: dates on their own line
      if (dates && body === null) {
        // After the dates only "Grade:"/"Activities and societies:" style lines belong to this school.
        if (/^(?:grade|activities and societies|skills)\s*:/i.test(cur)) { extra.push(cur); j++; continue; }
        break;
      }
      if (TERMINATOR.test(cur)) { parts.push(cur); j++; break; }
      if (body === null && parts.length && !continues(parts[parts.length - 1], cur)) break;
      parts.push(cur);
      j++;
    }
    const detail = parts.join(' ');
    const terminated = detail.match(TERMINATOR);
    schools.push({
      institution: head.text,
      detail: detail.replace(TERMINATOR, '').trim(),
      dates: terminated ? terminated[1].trim() : dates,
      source: lines.slice(i, j).map((l) => l.text).join('\n'),
      uncertain: body === null && parts.length > 1 && !terminated ? ['detail'] : [],
    });
    i = j;
  }
  return schools;
}

/** Sidebar lists in text without geometry: a wrapped name continues when the next line starts lower-case or the line ends mid-phrase. */
function joinSidebarNames(lines: string[]): string[] {
  const TAIL = /^(?:Certificate|Certification|Associate|Professional|Specialization|Course|Program(?:me)?|Training|Diploma|Fundamentals|Foundations|Analysts?|Developer|Practitioner)$/i;
  const out: string[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev !== undefined && (/^\p{Ll}/u.test(line) || /(?:[,:&\-–]|\b(?:and|of|in|for|the|with|to))$/i.test(prev) || TAIL.test(line))) out[out.length - 1] = `${prev} ${line}`;
    else out.push(line);
  }
  return out;
}

export function readLinkedIn(input: LinkedInLine[], options: { fromPdf?: boolean } = {}): LinkedInProfile {
  const { lines, copied } = cleanLinkedInLines(input);
  const sections = splitSections(lines);
  const main = lines.filter((l) => l.size);
  const body = options.fromPdf ? bodySize(main) : null;
  const who = identity(sections);
  const profile: LinkedInProfile = {
    name: who.name, headline: who.headline, location: who.location, summary: '', roles: [], schools: [], skills: [], languages: [],
    certifications: [], awards: [], other: {}, contact: [],
  };
  for (const section of sections) {
    // A name repeated at the top of a new page is a page header, not content.
    const rest = section.lines.filter((l) => !who.consumed.has(l) && !(l.pageStart && who.name && l.text === who.name));
    const texts = rest.map((l) => l.text);
    switch (section.heading) {
      case 'head': case 'contact': profile.contact.push(...texts); break;
      case 'summary': profile.summary = joinWrapped(texts).replace(/\n/g, ' '); break;
      case 'experience': profile.roles.push(...readRoles(rest, body, copied)); break;
      case 'education': profile.schools.push(...readSchools(rest, body)); break;
      case 'skills':
        // Copied Skills lists add "N endorsements", "Passed LinkedIn Skill Assessment" and the job a skill was used in.
        profile.skills.push(...texts.filter((l) => l.length <= 50 && !/\d|endorse|assessment|experiences? (?:at|across)|^\s*[•·]/i.test(l) && !/ at /.test(l)));
        break;
      case 'languages':
        for (const l of texts) {
          const m = l.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
          if (m) profile.languages.push({ name: m[1].trim(), level: m[2].trim(), source: l });
          else if (/proficiency$/i.test(l) && profile.languages.length) profile.languages[profile.languages.length - 1].level ??= l; // copied: level line
          else if (l.split(/\s+/).length <= 3) profile.languages.push({ name: l, level: null, source: l });
        }
        break;
      case 'certifications': {
        if (texts.some((l) => /^issued\b/i.test(l))) {
          // Copied "Licenses & certifications": name, issuer, "Issued Mar 2023", optional credential lines.
          let group: string[] = [];
          for (const l of texts) {
            if (/^issued\b/i.test(l)) {
              if (group.length) profile.certifications.push({ title: group[0], issuer: group[1] ?? null, issued: l.replace(/^issued\s*/i, '').replace(/\s*·.*$/, ''), source: [...group, l].join('\n') });
              group = [];
            } else if (!/^(?:credential id|expires|expired)\b/i.test(l)) group.push(l);
          }
          break;
        }
        const names = options.fromPdf ? texts : joinSidebarNames(texts);
        profile.certifications.push(...names.map((title) => ({ title, source: title })));
        break;
      }
      case 'awards': profile.awards.push(...(options.fromPdf ? texts : joinSidebarNames(texts)).map((title) => ({ title, source: title }))); break;
      case 'projects': case 'volunteering': case 'courses': (profile.other[section.heading] ??= []).push(...texts); break;
      default: break;
    }
  }
  return profile;
}

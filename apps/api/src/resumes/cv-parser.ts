/**
 * CV text -> structured profile data.
 *
 * Replaces the hardcoded stub that used to sit in ResumesService, which
 * returned the same `['TypeScript','React','Node.js']` and a fake
 * "Proqram Mühəndisi" role for every upload. That stub had a wider blast
 * radius than it looked: the matching pipeline scores a profile against
 * vacancies, so every user was effectively being matched on identical
 * invented skills.
 *
 * Kept as pure functions with no I/O and no framework types so the whole
 * thing is directly unit-testable; binary decoding lives in cv-extract.ts.
 *
 * The approach is deliberately heuristic rather than model-based: it must run
 * synchronously on upload, cost nothing per call, and degrade to "found less"
 * rather than "invented something". Anything it cannot determine is left
 * empty for the user to fill in — the onboarding flow shows every extracted
 * field for review precisely because extraction is best-effort.
 */

import { looksLikeLinkedIn, readLinkedIn, type LinkedInProfile } from "./linkedin-import";
import type { LayoutLine } from "./cv-extract";

/** YEAR when the document states only the year: such a date is stored as 1 January and must be shown as the year alone, never as "Jan". */
export type DatePrecision = "YEAR" | "MONTH";

export type ParsedExperience = {
  title: string;
  company: string;
  /** Only what the entry's own header states ("Remote", "Baku, Azerbaijan"); never filled from the candidate's home city. */
  location?: string;
  startDate: string | null; // ISO date; null when the document gives none
  endDate: string | null; // null also means "current role"
  startPrecision?: DatePrecision;
  endPrecision?: DatePrecision;
  /** True only when the document says the role continues ("Present", "indi"); a missing end date alone does not mean current. */
  current?: boolean;
  /** One bullet per line, markers removed, wrapped lines joined. Never cut to a length: a long role stays whole. */
  description: string;
  /** The source lines this entry was read from (1-based, within the document), so the review can show where it came from. */
  evidence?: { fromLine: number; toLine: number };
  /** The original lines, shown beside uncertain fields in the review. */
  source?: string;
  /** Fields the reader could not determine confidently ("company", "startDate", ...). The review asks the candidate to check them. */
  uncertain?: string[];
};

export type ParsedEducation = {
  institution: string;
  degree: string;
  fieldOfStudy: string;
  startDate: string | null;
  endDate: string | null;
  startPrecision?: DatePrecision;
  endPrecision?: DatePrecision;
  source?: string;
  uncertain?: string[];
};

export type ParsedCv = {
  personalInfo: { name: string; email: string; phone: string };
  headline: string;
  /** The profile/summary paragraph exactly as written (all of it). Empty when the CV has none. */
  summary: string;
  location: string;
  skills: string[];
  workExperience: ParsedExperience[];
  education: ParsedEducation[];
  /** Projects, volunteering, certifications, languages, awards read from the document: SUGGESTIONS only (see career-entries). */
  careerSuggestions: CareerSuggestion[];
  /** Which fields the parser actually found, so the UI can flag the gaps. */
  extracted: string[];
  /** How many entries of a section were read but not kept because the section hit its size limit. Absent when nothing was left out. */
  omitted?: Partial<Record<'skills' | 'workExperience' | 'education' | 'careerSuggestions', number>>;
};

/** Generous limits (a long career is the point of the document); anything beyond them is reported in `omitted`, never dropped silently. */
export const CV_LIMITS = { skills: 80, workExperience: 40, education: 20, careerSuggestions: 100 } as const;

// ---------------------------------------------------------------- sections --

type SectionName =
  | "summary" | "experience" | "education" | "skills" | "languages"
  | "projects" | "awards" | "certifications" | "leadership" | "volunteering" | "extracurricular" | "other";

/**
 * Case- and diacritic-folded form, used on both sides of every heading
 * comparison.
 *
 * Azerbaijani forces this. `"İş".toLowerCase()` does not produce `"iş"` — it
 * produces `i` followed by a COMBINING DOT ABOVE (U+0307), because the dotted
 * capital İ has no single-codepoint lowercase in the default locale. Any
 * subsequent letters-only filter then strips that mark and leaves `"i ş"`, so
 * a plain lowercase comparison silently fails on every heading starting with
 * İ — which in practice means "İş təcrübəsi", the single most common
 * experience heading in an Azerbaijani CV.
 *
 * Decomposing and dropping combining marks folds İ->i, ş->s and ü->u
 * consistently. It is lossy, but applied identically to the input and the
 * heading vocabulary, so the two always agree.
 */
function stripMarks(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Letters-and-spaces form, for comparing headings and whole words.
 *
 * Note this also removes digits, so it must NOT be used on anything where a
 * number carries meaning — date parsing uses stripMarks() instead.
 */
function fold(text: string): string {
  return stripMarks(text)
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Section headings, Azerbaijani first. Matched case-insensitively against a
 * whole line, so a heading only counts when it stands alone — "Experience" in
 * the middle of a sentence must not start a section.
 */

export const PAGE_FURNITURE_RE =
  /^(?:page|səhifə|sayfa|стр(?:аница)?\.?)\s*\d{1,3}(?:\s*(?:of|\/|из|-|–)\s*\d{1,3})?$|^[-–—\s]*\d{1,3}(?:\s*(?:of|\/|из)\s*\d{1,3})?[-–—\s]*$|^(?:curriculum vitae|tərcümeyi-hal|резюме)$/i;
export const isPageFurniture = (line: string) => PAGE_FURNITURE_RE.test(line.trim());

const SECTION_HEADINGS: Record<SectionName, string[]> = {
  summary: ["haqqımda", "özüm haqqında", "profil", "qısa məlumat", "summary", "about", "profile", "objective"],
  experience: [
    "iş təcrübəsi", "təcrübə", "peşə təcrübəsi", "iş yerləri", "karyera",
    "experience", "work experience", "employment", "employment history", "professional experience",
    // Founder/co-founder ventures are shaped exactly like a job entry (title
    // | company, then a date range, then bullets) — recognizing the heading
    // routes them through the same block parser instead of letting them run
    // on into whatever section came before.
    "startuplar və vençurlar", "startups and ventures", "startups & ventures", "ventures",
  ],
  education: ["təhsil", "təhsil məlumatları", "education", "academic background", "qualifications"],
  skills: [
    "bacarıqlar", "bacarıqlar və kompetensiyalar", "peşəkar bacarıqlar", "texniki bacarıqlar",
    "skills", "top skills", "key skills", "technical skills", "core skills", "competencies", "expertise",
    "capabilities", "capabilities & tools", "capabilities and tools",
    "tools & technologies", "tools and technologies",
  ],
  languages: ["dillər", "dil bilikləri", "languages"],
  // These sections are not experience: recognising them keeps their lines from being misread as job entries. Their content becomes
  // career-evidence SUGGESTIONS (parseCareerSections below) that the candidate must confirm; they never become experience or education.
  projects: [
    "layihələr", "seçilmiş layihələr", "projects", "selected projects",
    "selected ai & data projects", "selected ai and data projects",
  ],
  awards: [
    "təltiflər", "mükafatlar", "recognition", "awards", "achievements",
    "selected recognition & innovation", "selected recognition and innovation", "honors-awards", "honors & awards",
  ],
  certifications: [
    "sertifikatlar", "sertifikatlar və proqramlar", "certifications", "courses",
    "certifications & programs", "certifications and programs", "licenses & certifications", "licenses and certifications",
  ],
  leadership: ["rəhbərlik", "liderlik", "leadership", "leadership & community", "leadership and community"],
  volunteering: ["könüllülük", "könüllü fəaliyyət", "volunteering", "volunteer experience"],
  extracurricular: ["extracurricular", "əlavə fəaliyyətlər", "fəaliyyətlər", "community involvement"],
  other: [],
};

/**
 * Longest headings first so "iş təcrübəsi" wins over "təcrübə". Stored
 * pre-folded (see fold()) so comparisons never touch raw casing.
 */
const HEADING_LOOKUP: { name: SectionName; heading: string }[] = Object.entries(SECTION_HEADINGS)
  .flatMap(([name, list]) =>
    list.map((heading) => ({ name: name as SectionName, heading: fold(heading) })),
  )
  .sort((a, b) => b.heading.length - a.heading.length);

function headingFor(line: string): SectionName | null {
  // Headings are often decorated ("SKILLS:", "— Təhsil —"); compare folded.
  const bare = fold(line);
  if (!bare || bare.length > 40) return null;
  const exact = HEADING_LOOKUP.find(({ heading }) => bare === heading);
  if (exact) return exact.name;

  // A real-world heading is also often *extended* rather than just
  // decorated — "TECHNICAL SKILLS AND TOOLS", "WORK EXPERIENCE (2019-2024)"
  // (digits/punctuation already gone via fold()) — which an exact-equality
  // check misses entirely, silently folding that whole section into
  // whatever came before it. Accept a known heading as a prefix, capped by
  // how much longer the line is allowed to be so an ordinary sentence that
  // just happens to start with the same word or two ("Experience working
  // in...") isn't mistaken for a section break.
  const prefixed = HEADING_LOOKUP.find(
    ({ heading }) => bare.startsWith(heading + ' ') && bare.length <= heading.length + 20,
  );
  return prefixed ? prefixed.name : null;
}

function splitSections(lines: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = { head: [] };
  let current = "head";
  for (const line of lines) {
    const heading = headingFor(line);
    if (heading) {
      current = heading;
      out[current] = out[current] ?? [];
      continue;
    }
    out[current] = out[current] ?? [];
    out[current].push(line);
  }
  return out;
}

// ----------------------------------------------------------------- contact --

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]{2,}/;

/**
 * Azerbaijani numbers: +994 XX XXX XX XX, 0XX XXX XX XX, and the same with
 * separators. Kept deliberately narrow — a loose digit run matches dates,
 * postcodes and ID numbers.
 */
const PHONE_RE = /(?:\+994|0)\s?\(?\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}/;

const AZ_CITIES = [
  "Bakı", "Baku", "Sumqayıt", "Gəncə", "Mingəçevir", "Şəki", "Lənkəran",
  "Naxçıvan", "Şirvan", "Xırdalan", "Quba", "Qəbələ", "Zaqatala", "Salyan",
  "Bərdə", "Yevlax", "Ağdam", "Masallı", "Xaçmaz", "Şəmkir", "Astara",
];

/**
 * Matches a whole word without `\b`.
 *
 * `\b` is defined over ASCII [A-Za-z0-9_], so a term ending in a non-ASCII
 * letter can never satisfy it: /\bBakı\b/ fails on "Bakı, Azərbaycan"
 * because `ı` (U+0131) is not a word character, so there is no boundary after
 * it. Explicit non-letter edges with \p{L} behave correctly for Azerbaijani.
 */
function containsWord(haystackFolded: string, needle: string): boolean {
  const escaped = fold(needle).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}])${escaped}([^\\p{L}]|$)`, "u").test(haystackFolded);
}

/**
 * Like containsWord, but for skill names where digits and symbols are the
 * whole distinction between two different technologies — C++ vs C# vs 1C,
 * .NET, Node.js. fold() strips exactly those characters (it's built for
 * comparing headings/prose, where that's the right call), so using it here
 * silently collapses "C++" and "1C" to the same string: mentioning either
 * one in a CV would register *both* as found skills, and whichever of the
 * two happens to sort later in KNOWN_SKILLS silently overwrites the other's
 * display name in the dedup step below. stripMarks() still folds case and
 * diacritics, just not digits/symbols, so this stays needed for
 * "İNGİLİS DİLİ" == "İngilis dili"-type matches on skills that are prose
 * rather than technology names.
 */
function containsSkillWord(haystackStripped: string, needle: string): boolean {
  const escaped = stripMarks(needle).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, "u").test(haystackStripped);
}

/**
 * The candidate's own location, taken from the contact block at the top.
 *
 * Scanning the whole document and taking the first city in AZ_CITIES order
 * gets this wrong in a very ordinary case: a CV headed "Sumqayıt" that later
 * lists "Bakı Dövlət Universiteti" reported Bakı, because the university's
 * name mentions a city we happened to list earlier. The header is where a CV
 * states where its author lives, so it is searched first, and only then the
 * rest of the document as a fallback.
 */
function findLocation(headLines: string[], fullText: string): string {
  const pickFrom = (text: string): string => {
    const folded = fold(text);
    // Earliest mention wins, so ordering follows the document, not our array.
    let best: { city: string; at: number } | null = null;
    for (const city of AZ_CITIES) {
      if (!containsWord(folded, city)) continue;
      const at = folded.indexOf(fold(city));
      if (!best || at < best.at) best = { city, at };
    }
    return best ? (best.city === "Baku" ? "Bakı" : best.city) : "";
  };

  const fromHeader = pickFrom(headLines.slice(0, 10).join("\n"));
  if (fromHeader) return fromHeader;

  const anywhere = pickFrom(fullText);
  if (anywhere) return anywhere;

  const folded = fold(fullText);
  if (["remote", "uzaqdan", "məsafədən"].some((w) => containsWord(folded, w))) {
    return "Uzaqdan";
  }
  return "";
}

/**
 * Name: the first line of the document that reads like one. CVs almost always
 * lead with it, and the alternative (guessing from the email local-part)
 * invents data.
 */
/** "FIZULI HASANOV" → "Fizuli Hasanov" (Azerbaijani-aware: İ/I, dotted and dotless). A name already in mixed case is left as written. */
function titleCaseIfShouting(name: string): string {
  if (!name || name !== name.toLocaleUpperCase("az") || name === name.toLocaleLowerCase("az")) return name;
  return name
    .replace(/I/g, "i")
    .toLocaleLowerCase("az")
    .replace(/(^|[\s'’-])(\p{L})/gu, (_m, sep: string, ch: string) => `${sep}${ch.toLocaleUpperCase("az")}`);
}

function findName(headLines: string[]): string {
  for (const raw of headLines.slice(0, 8)) {
    const line = raw.trim();
    if (!line || line.length > 60 || isPageFurniture(line)) continue;
    if (EMAIL_RE.test(line) || PHONE_RE.test(line)) continue;
    if (/\d/.test(line)) continue;
    if (headingFor(line)) continue;
    const words = line.split(/\s+/);
    if (words.length < 2 || words.length > 4) continue;
    // Every word should start uppercase and be alphabetic (allowing ə, ğ, …).
    if (!words.every((w) => /^\p{Lu}[\p{L}'’-]*$/u.test(w))) continue;
    return line;
  }
  return "";
}

// ------------------------------------------------------------------ skills --

/**
 * Skill vocabulary used only as a *second* pass, to catch skills mentioned
 * outside a skills section. The primary source is always the user's own
 * skills section, so an unlisted technology is still picked up from there.
 */
export const KNOWN_SKILLS = [
  // engineering
  //
  // "Go" and "R" are deliberately absent as bare whole-word entries: both
  // collide constantly with ordinary prose ("go-to-market", "R-squared",
  // "R&D") under containsSkillWord's whole-word match, which treats a
  // hyphen/ampersand as a word boundary same as a space. A CV that actually
  // lists the language still surfaces it — pass 1 splits the user's own
  // skills-section lines regardless of this vocabulary — only the blind
  // whole-document scan (pass 2, this list) drops them. "Golang" stays a
  // safe, specific alias to the canonical "Go" below.
  "JavaScript", "TypeScript", "Python", "Java", "Kotlin", "Swift", "PHP", "Ruby", "Rust",
  "C++", "C#", ".NET", "React", "Next.js", "Vue", "Angular", "Svelte", "Node.js", "NestJS",
  "Express", "Django", "Flask", "Laravel", "Spring", "GraphQL", "REST", "SQL", "PostgreSQL",
  "MySQL", "MongoDB", "Redis", "Docker", "Kubernetes", "AWS", "Azure", "Git", "Linux",
  "HTML", "CSS", "Tailwind CSS", "Sass", "Figma", "Terraform", "CI/CD", "Jest",
  // data
  "Excel", "Power BI", "Tableau", "Pandas", "NumPy", "BigQuery", "scikit-learn", "SPSS", "Machine Learning",
  // business / office
  "SAP", "1C", "QuickBooks", "CRM", "Salesforce", "Google Analytics", "SEO", "SMM",
  "Photoshop", "Illustrator", "AutoCAD", "MS Office", "Word", "PowerPoint",
  "Mühasibatlıq", "Satış", "Marketinq", "Layihə idarəetməsi", "Müştəri xidməti",
  // languages as skills
  "Azərbaycan dili", "İngilis dili", "Rus dili", "Türk dili", "Alman dili",
];

// A skills section commonly groups entries under an inline category label
// on the same line — "Programming Languages: Python, Java, C++",
// "Frameworks: React, Django" — rather than a heading of its own. Without
// stripping it, splitting that line on commas leaves the label fused onto
// the first entry ("Programming Languages: Python" as one "skill" instead
// of "Python"), while every later entry on the line comes out clean. Kept
// narrow (letters/spaces/&/- only, capped length) so it can't eat into an
// actual skill that happens to contain a colon.
function stripCategoryLabel(line: string): string {
  return line.replace(/^[\p{L}][\p{L}\s&-]{1,38}:\s*/u, "");
}

// Common abbreviations/variants for a handful of KNOWN_SKILLS entries.
// Checked as whole words (via containsWord), same as KNOWN_SKILLS itself,
// so a resume mentioning "Node" or "Postgres" rather than the full name
// still surfaces the canonical skill instead of missing it entirely.
const SKILL_ALIASES: Record<string, string> = {
  "Node": "Node.js",
  "NodeJS": "Node.js",
  "ReactJS": "React",
  "VueJS": "Vue",
  "Postgres": "PostgreSQL",
  "Mongo": "MongoDB",
  "K8s": "Kubernetes",
  "JS": "JavaScript",
  "TS": "TypeScript",
  "Golang": "Go",
};

// Swaps commas *inside* parentheses for a placeholder before a piece gets
// split on commas, and restores them after — "Python (pandas, scikit-learn),
// SQL (PostgreSQL, BigQuery)" must split into those two grouped pieces, not
// four fragments with a dangling unmatched paren on either side of the break.
const PROTECTED_COMMA = "__PAREN_COMMA__";
function protectParenCommas(line: string): string {
  let depth = 0;
  let out = "";
  for (const ch of line) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    out += ch === "," && depth > 0 ? PROTECTED_COMMA : ch;
  }
  return out;
}

const SKILL_LABEL = /^([\p{L}][\p{L}\s&/-]{1,38}):\s*(.*)$/u;
const LANGUAGE_LABEL = /^(?:languages?|dill[əe]r|dil bilikl[əe]ri|dil bilgisi)$/iu;

/**
 * Lines of a skills section → groups. A line with a "Category: ..." label opens a group; unlabelled lines that follow it are its wrapped
 * continuation ("... competitive" / "benchmarking, KPI design" is one phrase), while in a plain list every line stays its own item.
 */
function skillGroups(lines: string[]): { label: string; text: string }[] {
  const groups: { label: string; text: string; labelled: boolean }[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = SKILL_LABEL.exec(line);
    if (m && m[2]) {
      groups.push({ label: m[1].trim(), text: m[2].trim(), labelled: true });
    } else if (groups.length && groups[groups.length - 1].labelled) {
      groups[groups.length - 1].text += ` ${line}`;
    } else {
      groups.push({ label: "", text: line, labelled: false });
    }
  }
  return groups.map(({ label, text }) => ({ label, text }));
}

/** "SQL (PostgreSQL, BigQuery)" and "Python for analysis (pandas, scikit-learn)" are lists with a heading; each tool is a skill of its own. */
function expandParenthetical(skill: string): string[] {
  const m = skill.match(/^([^()]{1,40}?)\s*\(([^()]{2,80})\)$/u);
  if (!m || !m[2].includes(",")) return [skill];
  const head = m[1].replace(/\s+(?:for|in|with)\s+.+$/i, "").trim();
  const inner = m[2].split(",").map((x) => x.trim()).filter((x) => x && x.split(/\s+/).length <= 3);
  if (inner.length < 2) return [skill];
  return [...(head ? [head] : []), ...inner];
}

function parseSkills(sections: Record<string, string[]>, fullText: string): { skills: string[]; languageLines: string[] } {
  const found = new Set<string>();
  const languageLines: string[] = [];

  // 1) Whatever the CV itself lists under a skills heading. A languages heading or a "Languages:" label is not a skill list: those lines go to the
  //    languages section of the career evidence instead of the skills.
  for (const key of ["skills", "languages"]) {
    for (const group of skillGroups(sections[key] ?? [])) {
      if (key === "languages" || LANGUAGE_LABEL.test(group.label)) {
        languageLines.push(group.text);
        continue;
      }
      const line = protectParenCommas(group.text);
      for (const rawPiece of line.split(/[,;•·|/]|\s{3,}/)) {
        const piece = rawPiece.split(PROTECTED_COMMA).join(",");
        const cleaned = piece.replace(/^[-–—*\s]+/, "").replace(/[.:]+$/, "").trim();
        for (const skill of expandParenthetical(cleaned)) {
          // Bounds keep sentences and stray punctuation out.
          if (skill.length < 2 || skill.length > 40) continue;
          const bare = skill.replace(/\([^)]*\)/g, "").trim();
          if ((bare || skill).split(/\s+/).filter(Boolean).length > 4) continue;
          if (!/\p{L}/u.test(skill)) continue;
          found.add(skill);
        }
      }
    }
  }

  // 2) Known skills (and their common aliases) mentioned anywhere else in
  //    the document. stripMarks (not fold) so digits/symbols that
  //    distinguish real skills survive — "İNGİLİS DİLİ"/"İngilis dili" still
  //    both hit, but "C++"/"C#"/"1C" stay distinct instead of all
  //    collapsing to the same bare "c".
  const strippedText = stripMarks(fullText);
  for (const skill of KNOWN_SKILLS) {
    if (containsSkillWord(strippedText, skill)) found.add(skill);
  }
  for (const [alias, canonical] of Object.entries(SKILL_ALIASES)) {
    if (containsSkillWord(strippedText, alias)) found.add(canonical);
  }

  // De-duplicate case-insensitively, preferring the canonical casing when the
  // vocabulary knows it ("react" from a bullet list becomes "React"). Same
  // stripMarks reasoning as above: fold() would merge "C++" into "1C".
  const canonical = new Map(KNOWN_SKILLS.map((s) => [stripMarks(s).trim(), s]));
  const seen = new Map<string, string>();
  for (const skill of found) {
    const key = stripMarks(skill).trim();
    if (!seen.has(key)) seen.set(key, canonical.get(key) ?? skill);
  }
  return { skills: [...seen.values()], languageLines };
}

// -------------------------------------------------------------------- dates --

/** Keys are stripMarks()ed — look up with stripMarks(name), never raw. */
const MONTHS: Record<string, number> = Object.fromEntries(
  Object.entries({
    yanvar: 1, fevral: 2, mart: 3, aprel: 4, may: 5, iyun: 6, iyul: 7,
    avqust: 8, sentyabr: 9, oktyabr: 10, noyabr: 11, dekabr: 12,
    january: 1, february: 2, march: 3, april: 4, june: 6, july: 7,
    august: 8, september: 9, october: 10, november: 11, december: 12,
    jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9,
    oct: 10, nov: 11, dec: 12, sept: 9,
  }).map(([name, num]) => [stripMarks(name), num]),
);

const CURRENT_WORDS = /\b(indi|indiki|hazırda|hal-hazırda|davam edir|present|current|now)\b/i;
const RANGE_SEP = /\s*(?:[-–—]|\buntil now\b|\buntil\b|\bto\b)\s*/i;

function toIso(year: number, month = 1): string {
  return new Date(Date.UTC(year, month - 1, 1)).toISOString();
}

/** Parses "Mart 2021", "03/2021", "2021" into an ISO date. */
function parseDatePart(part: string): string | null {
  // stripMarks, not toLowerCase: lowercasing "İyun" yields "i" + COMBINING
  // DOT ABOVE, and the [\p{L}]+ month capture then stops at the mark and
  // reads "yun", which matches no month. Digits must survive, so the
  // letters-only fold() is not usable here.
  const text = stripMarks(part.trim());
  if (!text) return null;

  // "Sep. 2021" as well as "Sep 2021": precisionOf() reads the dotted form as a month, so this must too, or it becomes January.
  const monthYear = text.match(/([\p{L}]+)\.?\s+(\d{4})/u);
  if (monthYear) {
    // fold() rather than the raw match: "İyun" lowercases to "i" + COMBINING
    // DOT ABOVE, so a direct MONTHS lookup misses every İ month (İyun, İyul)
    // and the date silently degrades to January of that year.
    const month = MONTHS[stripMarks(monthYear[1])];
    if (month) return toIso(Number(monthYear[2]), month);
  }

  const numeric = text.match(/(\d{1,2})[./](\d{4})/);
  if (numeric) {
    const month = Number(numeric[1]);
    if (month >= 1 && month <= 12) return toIso(Number(numeric[2]), month);
  }

  const yearOnly = text.match(/\b(19|20)\d{2}\b/);
  if (yearOnly) return toIso(Number(yearOnly[0]));

  return null;
}

export type DateRange = { start: string | null; end: string | null; current: boolean; startPrecision?: DatePrecision; endPrecision?: DatePrecision };

/** MONTH when the date part names a month ("Mart 2021", "03/2021"), YEAR when it is a bare year. */
function precisionOf(part: string): DatePrecision {
  const text = stripMarks(part.trim());
  const named = text.match(/([\p{L}]+)\.?\s+\d{4}/u);
  if (named && MONTHS[stripMarks(named[1])]) return "MONTH";
  if (/(\d{1,2})[./](\d{4})/.test(text)) return "MONTH";
  return "YEAR";
}

/** Finds a date range on a line, if there is one. */
export function findDateRange(line: string): DateRange | null {
  if (!/\d{4}/.test(line)) return null;

  const current = CURRENT_WORDS.test(line);
  // Trim leading labels so "Tarix: 2019-2021" still splits correctly.
  const cleaned = line.replace(/^[^\d\p{L}]*/u, "");
  const parts = cleaned.split(RANGE_SEP);

  if (parts.length >= 2) {
    // "Feb – Apr 2026" states a shared year for both month names.
    const sharedYear = parts[1].match(/\b((?:19|20)\d{2})\b/)?.[1];
    const firstMonth = stripMarks(parts[0].trim().replace(/\.$/, ''));
    const startText = sharedYear && firstMonth in MONTHS ? `${parts[0].trim()} ${sharedYear}` : parts[0];
    const start = parseDatePart(startText);
    const end = current ? null : parseDatePart(parts[1]);
    if (start || end) {
      return {
        start, end, current,
        ...(start ? { startPrecision: precisionOf(startText) } : {}),
        ...(end ? { endPrecision: precisionOf(parts[1]) } : {}),
      };
    }
  }

  const single = parseDatePart(cleaned);
  if (single) return { start: single, end: null, current, startPrecision: precisionOf(cleaned) };
  return null;
}

/**
 * A line is "mostly a date" when the whole thing is basically the date
 * itself, as opposed to a longer line that merely contains one.
 */
function isPureDateLine(line: string): boolean {
  return line.replace(/[^\d]/g, "").length >= 4 && line.length < 48;
}

// Mirrors findDateRange's own month/numeric/year shapes so a match here is
// guaranteed to also parse via findDateRange — this only locates *where* in
// the line the date sits, findDateRange still does the actual parsing.
const DATE_TOKEN_SRC = String.raw`(?:[\p{L}]{3,12}\.?\s+\d{4}|\d{1,2}[./]\d{4}|(?:19|20)\d{2})`;
const TRAILING_DATE_RE = new RegExp(
  String.raw`(?:${DATE_TOKEN_SRC}\s*(?:[-–—]|\buntil now\b|\buntil\b|\bto\b)\s*(?:${DATE_TOKEN_SRC}|present|current|now|indi|haz[ıi]rda|hal-?haz[ıi]rda|davam edir)|${DATE_TOKEN_SRC})\s*$`,
  "iu",
);

/**
 * Finds a date (range) anchored at the very end of a longer line and
 * separates it from the rest — many modern templates right-align the date on
 * the same paragraph as the title/company via a tab stop ("Senior Analyst |
 * Acme Inc | Baku    Jun 2024 - Present") rather than putting it on a line of
 * its own. Without this, findDateRange still technically extracts the range
 * (its regex isn't anchored), but nothing separates the date text from the
 * rest of the line, so the whole sentence — title, company, date and all —
 * ends up glued into one field, and isPureDateLine's "the whole line is
 * basically the date" check (needed to keep an ordinary description bullet
 * that merely *mentions* a year out of the date slot) never fires for it,
 * so the entry silently gets no date at all.
 *
 * `weak` marks a bare-trailing-year match (no month name, no explicit
 * separator) — the least specific case, and one an ordinary description
 * bullet can end with by coincidence ("...adoption up since 2023"). Callers
 * should only accept a weak match on the block's own header line, not on
 * arbitrary bullets.
 */
function extractTrailingDate(line: string): { range: DateRange; rest: string; weak: boolean } | null {
  const match = line.match(TRAILING_DATE_RE);
  if (!match) return null;
  const range = findDateRange(match[0]);
  if (!range) return null;

  const cleaned = match[0].replace(/^[^\d\p{L}]*/u, "");
  const weak = cleaned.split(RANGE_SEP).length < 2;
  const rest = line.slice(0, match.index).trim().replace(/[|,:;\-–—]\s*$/, "").trim();
  return { range, rest, weak };
}

/**
 * Groups lines into blocks, one per date range: in practice every CV
 * role/degree carries one, and it is the only reliable entry delimiter
 * across wildly different layouts.
 */
function blockByDateRange(lines: string[]): string[][] {
  let block: string[] = [];
  const blocks: string[][] = [];
  for (const line of lines) {
    if (findDateRange(line) && block.length) {
      blocks.push(block);
      block = [line];
    } else {
      block.push(line);
    }
  }
  if (block.length) blocks.push(block);
  return blocks;
}

/** Splits one block's lines into { range, nonDate }, pulling the date out of
 * whichever line carries it — its own line, or embedded in a longer one
 * (see extractTrailingDate). */
function splitBlockDate(lines2: string[]): { range: DateRange | null; nonDate: string[] } {
  let range: DateRange | null = null;
  const nonDate: string[] = [];
  for (const line of lines2) {
    const found = findDateRange(line);
    if (!found) {
      nonDate.push(line);
      continue;
    }
    if (isPureDateLine(line)) {
      if (!range) range = found;
      else nonDate.push(line);
      continue;
    }
    const trailing = extractTrailingDate(line);
    if (trailing && !range && (!trailing.weak || nonDate.length === 0)) {
      range = trailing.range;
      if (trailing.rest) nonDate.push(trailing.rest);
      continue;
    }
    nonDate.push(line);
  }
  return { range, nonDate };
}

/**
 * Splits a "A | B | C" header line into trimmed segments, dropping a
 * trailing segment that looks like a location ("Baku, Azerbaijan", or a
 * known city name) — modern templates commonly tack the office location
 * onto the same pipe-delimited line as the title/institution, and fusing it
 * into whichever segment happens to be last would misname that segment
 * instead of just leaving it out, the same "found less" tradeoff as the
 * rest of this parser. Returns a single-element array (the whole line)
 * unchanged when there is no `|` to split on.
 */
function splitPipeHeader(line: string): string[] {
  const segments = line.split("|").map((s) => s.trim()).filter(Boolean);
  if (segments.length < 2) return segments;
  const last = segments[segments.length - 1];
  if (/,/.test(last) || AZ_CITIES.some((c) => containsWord(fold(last), c))) {
    return segments.slice(0, -1);
  }
  return segments;
}

// -------------------------------------------------------------- experience --

const COMPANY_HINT =
  /\b(MMC|ASC|QSC|LLC|Ltd|Inc|GmbH|şirkət|company|bank|holding|group|studio|agency)\b/i;

// A line that opens with one of these is a bullet; a dash only counts when followed by a space ("- text"), so "-5%" or "–" inside a word are not.
const BULLET_LEAD = /^\s*(?:[•▪●◦‣·*]|[-–—](?=\s))\s*/u;
const stripBullet = (line: string) => line.replace(BULLET_LEAD, "").trim();
const isBulletLine = (line: string) => BULLET_LEAD.test(line);

const LETTER = String.raw`\p{L}`;
/** A job-title word. Used to decide which "|" segment is the role when a CV puts the organisation first ("FinVeda | Founder | ..."). */
const ROLE_WORD = new RegExp(
  String.raw`(?<!${LETTER})(?:founder|co-?founder|ceo|cto|coo|cfo|chief|intern|internship|trainee|apprentice|analyst|manager|engineer|developer|programmer|designer|architect|lead|director|head|specialist|consultant|advisor|adviser|assistant|researcher|officer|coordinator|associate|mentor|fellow|president|vice president|chair|volunteer|instructor|teacher|lecturer|accountant|auditor|administrator|supervisor|representative|executive|owner|partner|stajyor|təsisçi|həmtəsisçi|mühəndis|proqramçı|menecer|rəhbər|direktor|mütəxəssis|məsləhətçi|təhlilçi|analitik|koordinator|köməkçi|assistent|tədqiqatçı|müəllim|mühasib|auditor|nümayəndə|sədr|könüllü|praktikant)(?!${LETTER})`,
  "iu",
);
const WORK_MODE = /^(?:remote|hybrid|on-?site|onsite|uzaqdan|hibrid|ofisdə|distant)$/i;

function looksLikeLocation(segment: string): boolean {
  const t = segment.trim();
  if (!t || t.length > 60) return false;
  if (WORK_MODE.test(t)) return true;
  if (/,/.test(t) && !ROLE_WORD.test(t)) return true; // "Baku, Azerbaijan"
  return AZ_CITIES.some((c) => containsWord(fold(t), c)) && t.split(/\s+/).length <= 4 && !ROLE_WORD.test(t);
}

/** Header text of one entry → title / company / location. Order in the source does not matter: the segment that reads as a job title is the title. */
function readHeader(headerLines: string[]): { title: string; company: string; location: string } {
  const segments: string[] = [];
  for (const line of headerLines) {
    const parts = line.includes("|") ? line.split("|") : [line];
    for (const part of parts) {
      const t = part.trim().replace(/^[-–—,;:]+|[-–—,;:]+$/g, "").trim();
      if (t) segments.push(t);
    }
  }
  if (!segments.length) return { title: "", company: "", location: "" };

  // Location: a trailing segment that is a place or a work mode. It is kept as the entry's own location, not dropped and not merged into the company.
  let location = "";
  while (segments.length > 1 && looksLikeLocation(segments[segments.length - 1])) {
    const seg = segments.pop()!;
    location = location ? `${seg}, ${location}` : seg;
  }

  if (segments.length === 1) {
    // "Frontend Developer — Acme MMC" on one line, no pipe.
    const dash = segments[0].split(/\s+[-–—]\s+/);
    if (dash.length === 2 && dash[0] && dash[1]) {
      return ROLE_WORD.test(dash[1]) && !ROLE_WORD.test(dash[0])
        ? { title: dash[1], company: dash[0], location }
        : { title: dash[0], company: dash[1], location };
    }
    if (COMPANY_HINT.test(segments[0]) && !ROLE_WORD.test(segments[0])) {
      return { title: "", company: segments[0], location };
    }
    return { title: segments[0], company: "", location };
  }

  let roleIdx = segments.findIndex((s) => ROLE_WORD.test(s) && s.split(/\s+/).length <= 8);
  if (roleIdx < 0) {
    // No job-title word anywhere: an organisation-looking first segment ("... MMC | Analyst") makes the next one the title, else the first is.
    roleIdx = COMPANY_HINT.test(segments[0]) && !COMPANY_HINT.test(segments[1]) ? 1 : 0;
  }
  const title = segments[roleIdx];
  const remaining = segments.filter((_, i) => i !== roleIdx);
  const AWARD_SEGMENT = /^(?:outstanding\s+contributor|top\s+\d+|fellow|scholar|winner|award|honors?|dean'?s\s+list|mükafatçı?|fəxri\s+fərman)$/i;
  const nonAward = remaining.filter((s) => !AWARD_SEGMENT.test(s));
  const company = (nonAward.length > 0 ? nonAward : remaining).join(" | ");
  return { title, company, location };
}

/** A header line ends in its date: "Role | Company | Baku  Jun 2026 - Present". A sentence that merely mentions a year somewhere is not one. */
function headerWithDate(line: string): { range: DateRange; rest: string } | null {
  if (isBulletLine(line) || line.length > 240) return null;
  const trailing = extractTrailingDate(line);
  if (!trailing || !trailing.rest) return null;
  const rest = trailing.rest;
  if (/[.!?]$/.test(rest)) return null;
  const words = rest.split(/\s+/).filter(Boolean).length;
  const piped = rest.includes("|");
  if (trailing.weak && !piped) return null;
  if (!piped && words > 14) return null;
  return { range: trailing.range, rest };
}

type DraftEntry = { header: string[]; date: DateRange | null; bullets: string[]; fromLine: number; toLine: number };

/** Joins a wrapped line to the one before it. A compound broken after its hyphen ("AI-" / "enabled") is rejoined without a space. */
function joinWrapped(previous: string, next: string): string {
  const glued = /[\p{L}\d]-$/u.test(previous) && /^\p{Ll}/u.test(next);
  return `${previous}${glued ? "" : " "}${next}`.replace(/\s+/g, " ").trim();
}

function parseExperience(lines: string[]): ParsedExperience[] {
  const entries: DraftEntry[] = [];
  let current: DraftEntry | null = null;
  const start = (i: number): DraftEntry => {
    const e: DraftEntry = { header: [], date: null, bullets: [], fromLine: i, toLine: i };
    entries.push(e);
    return e;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || isPageFurniture(line)) continue;

    const head = headerWithDate(line);
    if (head) {
      current = start(i);
      current.header.push(head.rest);
      current.date = head.range;
      current.toLine = i;
      continue;
    }

    if (!isBulletLine(line) && isPureDateLine(line) && findDateRange(line)) {
      const range = findDateRange(line)!;
      // Layout A: the title/company lines come first, the date after them. Layout B: the date opens a new entry.
      if (current && !current.date && !current.bullets.length) {
        current.date = range;
        current.toLine = i;
      } else {
        current = start(i);
        current.date = range;
      }
      continue;
    }

    if (isBulletLine(line)) {
      if (!current) current = start(i);
      current.bullets.push(stripBullet(line));
      current.toLine = i;
      continue;
    }

    // Plain text line.
    const nextIsDate = i + 1 < lines.length && isPureDateLine(lines[i + 1].trim()) && !!findDateRange(lines[i + 1]);
    const short = line.length <= 110 && !/[.!?]$/.test(line);
    if (!current) {
      current = start(i);
      current.header.push(line);
      current.toLine = i;
      continue;
    }
    if (!current.bullets.length) {
      // Still inside the header: a second header line (company below title) or, if it is long, the first unmarked bullet.
      if (current.header.length < 3 && short && !(current.date && current.header.length >= 1 && line.length > 90)) {
        // A short line after a complete header+date and before any bullet is its company/location line only when the header has no company yet.
        current.header.push(line);
      } else {
        current.bullets.push(line);
      }
      current.toLine = i;
      continue;
    }
    // Inside bullets. A line directly above a date line opens the next entry (layout A); otherwise it continues the last bullet.
    if (nextIsDate && short) {
      current = start(i);
      current.header.push(line);
      current.toLine = i;
      continue;
    }
    const last = current.bullets.length - 1;
    current.bullets[last] = joinWrapped(current.bullets[last], line);
    current.toLine = i;
  }

  const out: ParsedExperience[] = [];
  let lastCompany = '';
  let lastLocation = '';
  for (const d of entries) {
    if (!d.header.length && !d.bullets.length) continue;
    if (!d.date && d.header.length < 1) continue;
    let { title, company, location } = readHeader(d.header);
    // Standalone company heading: acts as parent employer for following entries
    if (!d.date && d.bullets.length === 0 && company && !title) {
      lastCompany = company;
      if (location) lastLocation = location;
      continue;
    }
    if (!company && lastCompany && (d.date || d.bullets.length > 0)) {
      company = lastCompany;
      if (!location && lastLocation) location = lastLocation;
    }
    if (company) {
      lastCompany = company;
      if (location) lastLocation = location;
    }
    if (!d.date && d.bullets.length === 0 && !company) continue; // a lone stray line is not a role
    out.push({
      title: title.slice(0, 160),
      company: company.slice(0, 200),
      ...(location ? { location: location.slice(0, 80) } : {}),
      startDate: d.date?.start ?? null,
      endDate: d.date?.end ?? null,
      ...precisionFields(d.date),
      description: d.bullets.map((b) => b.trim()).filter(Boolean).join("\n"),
      evidence: { fromLine: d.fromLine + 1, toLine: d.toLine + 1 },
    });
  }
  return out;
}

/** Previous implementation (one block per line that contains a date), kept for documents with no recognisable header+date lines at all. */
function parseExperienceLegacy(lines: string[]): ParsedExperience[] {
  const entries: ParsedExperience[] = [];
  const blocks = blockByDateRange(lines);

  for (const raw of blocks) {
    const lines2 = raw.map((l) => l.trim()).filter(Boolean);
    if (!lines2.length) continue;

    const { range, nonDate } = splitBlockDate(lines2);
    if (!range && nonDate.length < 2) continue;

    // Of the first two non-date lines, the one that looks like an employer is
    // the company and the other is the title.
    const [first = "", second = ""] = nonDate;
    let title = first;
    let company = second;
    let consumed = 2;

    // A pipe-delimited header packs title + company (+ programme/location)
    // into one line — "Title | Company | Location" or "Title | Programme |
    // Company | Location" — a stronger, unambiguous signal than "whatever
    // text happens to sit on the next physical line", which for a header
    // immediately followed by a bullet point would otherwise grab that
    // bullet as the "company".
    const segments = splitPipeHeader(first);
    if (segments.length >= 2) {
      title = segments[0];
      company = segments.slice(1).join(" | ");
      consumed = 1;
    } else if (COMPANY_HINT.test(first) && !COMPANY_HINT.test(second)) {
      title = second;
      company = first;
    }

    // "Frontend Developer — Acme MMC" on one line, no pipe.
    if (!company && /[-–—|,]/.test(title)) {
      const [a, b] = title.split(/\s*[-–—|,]\s*/);
      if (a && b) {
        title = a.trim();
        company = b.trim();
      }
    }

    entries.push({
      title: title.slice(0, 120),
      company: company.slice(0, 120),
      startDate: range?.start ?? null,
      endDate: range?.end ?? null,
      ...precisionFields(range),
      description: nonDate.slice(consumed).join("\n"),
    });
  }

  return entries;
}

// --------------------------------------------------------------- education --

const INSTITUTION_HINT =
  /\b(universitet[\p{L}]*|university|institut[\p{L}]*|institute|akademiya[\p{L}]*|academy|kollec[\p{L}]*|college|məktəb[\p{L}]*|school|lise[\p{L}]*|lisey[\p{L}]*)\b/iu;
const DEGREE_HINT =
  /\b(bakalavr|magistr|doktorantura|phd|bachelor|master|mba|associate|diplom|orta təhsil)\b/iu;

function parseEducation(lines: string[]): ParsedEducation[] {
  const entries: ParsedEducation[] = [];
  const blocks = blockByDateRange(lines);

  for (const raw of blocks) {
    const lines2 = raw.map((l) => l.trim()).filter((l) => l && !isPageFurniture(l));
    if (!lines2.length) continue;

    const { range, nonDate } = splitBlockDate(lines2);
    if (!nonDate.length) continue;

    // A pipe-delimited header packs degree + institution (+ location) into
    // one line — "Bachelor of X | University Name | City" — same layout and
    // same reasoning as the experience parser above.
    const segments = splitPipeHeader(nonDate[0]);
    let institution: string;
    let degree = "";
    let fieldOfStudy = "";
    let rest: string[];

    if (segments.length >= 2) {
      const instIdx = segments.findIndex((s) => INSTITUTION_HINT.test(s));
      institution = instIdx >= 0 ? segments[instIdx] : segments[1];
      const degreeIdx = segments.findIndex((s, i) => i !== instIdx && DEGREE_HINT.test(s));
      if (degreeIdx >= 0) {
        const degreeSeg = segments[degreeIdx];
        degree = degreeSeg.match(DEGREE_HINT)?.[0] ?? "";
        fieldOfStudy = degreeSeg.replace(DEGREE_HINT, "").replace(/^\s*(of|in)\s+/i, "").trim();
      }
      rest = nonDate.slice(1);
    } else {
      institution = nonDate.find((l) => INSTITUTION_HINT.test(l)) ?? nonDate[0] ?? "";
      rest = nonDate;
    }

    if (!degree) {
      const degreeLine = rest.find((l) => l !== institution && DEGREE_HINT.test(l)) ?? "";
      degree = degreeLine ? degreeLine.match(DEGREE_HINT)?.[0] ?? "" : "";
      // Field of study: the remaining line that is neither institution nor degree.
      if (!fieldOfStudy) {
        fieldOfStudy = rest.find((l) => l !== institution && l !== degreeLine && l.length < 80) ?? "";
      }
    }

    entries.push({
      institution: institution.slice(0, 160),
      degree: degree.slice(0, 80),
      fieldOfStudy: fieldOfStudy.slice(0, 120),
      startDate: range?.start ?? null,
      endDate: range?.end ?? null,
      ...precisionFields(range),
    });
  }

  return entries;
}

function precisionFields(range: DateRange | null | undefined): Pick<ParsedExperience, "startPrecision" | "endPrecision" | "current"> {
  if (!range) return {};
  return {
    ...(range.startPrecision ? { startPrecision: range.startPrecision } : {}),
    ...(range.endPrecision ? { endPrecision: range.endPrecision } : {}),
    ...(range.current ? { current: true } : {}),
  };
}

// --------------------------------------------------------------- linkedin --

const LI_DEGREE = /\b(?:bachelor|master|doctor|phd|bba|mba|bsc|msc|bs|ba|ma|associate|diploma|certificate|high school|bakalavr|magistr)\b/i;

/** The LinkedIn reader's sections as parser fields. Dates keep their stated precision; nothing missing is filled in. */
function fromLinkedIn(li: LinkedInProfile): Pick<ParsedCv, "workExperience" | "education" | "summary" | "skills"> & { careerSuggestions: CareerSuggestion[] } {
  const workExperience: ParsedExperience[] = li.roles.map((r) => {
    const range = findDateRange(r.dates);
    const uncertain = [...r.uncertain];
    if (!range?.start) uncertain.push("startDate");
    return {
      title: r.title.slice(0, 160),
      company: r.company.slice(0, 200),
      ...(r.location ? { location: r.location.slice(0, 80) } : {}),
      startDate: range?.start ?? null,
      endDate: range?.end ?? null,
      ...precisionFields(range),
      description: r.description,
      source: r.source,
      ...(uncertain.length ? { uncertain } : {}),
    };
  });
  const education: ParsedEducation[] = li.schools.map((s) => {
    const range = s.dates ? findDateRange(s.dates) : null;
    // "Bachelor's degree, Finance": the part before the first comma is the degree only when it names one; otherwise it is all subject.
    const split = s.detail.indexOf(",");
    const head = split < 0 ? s.detail : s.detail.slice(0, split);
    const hasDegree = LI_DEGREE.test(head);
    const uncertain = [...s.uncertain];
    if (!range?.start) uncertain.push("startDate");
    return {
      institution: s.institution.slice(0, 160),
      degree: hasDegree ? head.trim().slice(0, 80) : "",
      fieldOfStudy: (hasDegree ? (split < 0 ? "" : s.detail.slice(split + 1)) : s.detail).trim().slice(0, 160),
      startDate: range?.start ?? null,
      endDate: range?.end ?? null,
      ...precisionFields(range),
      source: s.source,
      ...(uncertain.length ? { uncertain } : {}),
    };
  });
  const careerSuggestions: CareerSuggestion[] = [
    ...li.certifications.map((c) => {
      const entry = blank("CERTIFICATION", c.title, c.source);
      if (c.issuer) entry.organization = c.issuer.slice(0, 160);
      const issued = c.issued ? findDateRange(c.issued) : null;
      if (issued?.start) { entry.issuedAt = issued.start; entry.precision = issued.startPrecision ?? "MONTH"; }
      return entry;
    }),
    ...li.awards.map((a) => blank("AWARD", a.title, a.source)),
    ...li.languages.map((l) => ({ ...blank("LANGUAGE", l.name, l.source), level: l.level ? l.level.slice(0, 40) : null })),
    ...parseProjectLike("PROJECT", li.other.projects ?? []),
    ...parseProjectLike("VOLUNTEERING", li.other.volunteering ?? []),
    ...parseCertificateLike("CERTIFICATION", li.other.courses ?? []),
  ];
  return { workExperience, education, summary: li.summary, skills: li.skills, careerSuggestions };
}

export function parseLinkedInProfile(
  li: LinkedInProfile,
  fallback: { name?: string | null; email?: string | null } = {},
): ParsedCv {
  const linkedIn = fromLinkedIn(li);
  const email = fallback.email || "";
  const name = li.name || (fallback.name ?? "");
  const location = li.location || "";
  const allSkills = [...new Map(li.skills.map((sk) => [stripMarks(sk).trim(), sk])).values()];
  const allExperience = linkedIn.workExperience;
  const allEducation = linkedIn.education;
  const skills = allSkills.slice(0, CV_LIMITS.skills);
  const workExperience = allExperience.slice(0, CV_LIMITS.workExperience);
  const education = allEducation.slice(0, CV_LIMITS.education);
  const summary = linkedIn.summary;
  const headline = li.headline || workExperience[0]?.title || "";

  const extracted: string[] = [];
  if (name) extracted.push("name");
  if (email) extracted.push("email");
  if (headline) extracted.push("headline");
  if (location) extracted.push("location");
  if (skills.length) extracted.push("skills");
  if (workExperience.length) extracted.push("workExperience");
  if (education.length) extracted.push("education");
  const allSuggestions = linkedIn.careerSuggestions;
  const careerSuggestions = allSuggestions.slice(0, CV_LIMITS.careerSuggestions);
  if (careerSuggestions.length) extracted.push("careerSections");
  const omitted = Object.fromEntries(
    ([['skills', allSkills.length - skills.length], ['workExperience', allExperience.length - workExperience.length], ['education', allEducation.length - education.length], ['careerSuggestions', allSuggestions.length - careerSuggestions.length]] as const).filter(([, n]) => n > 0),
  );

  return {
    personalInfo: { name, email, phone: "" },
    headline,
    summary,
    location,
    skills,
    workExperience,
    education,
    careerSuggestions,
    extracted,
    ...(Object.keys(omitted).length ? { omitted } : {}),
  };
}

// ------------------------------------------------------------------- entry --

export function normalizeText(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);
}

/**
 * Parses CV text into profile-shaped data.
 *
 * `fallback` supplies the account's own name/email so an unreadable CV still
 * produces a usable profile stub — these are facts we already hold, not
 * guesses about the document.
 */
export function parseCv(
  text: string,
  fallback: { name?: string | null; email?: string | null } = {},
  layout?: LayoutLine[],
): ParsedCv {
  const lines = normalizeText(text);
  // A LinkedIn export or copied profile is read by its own structure (linkedin-import.ts); contact details and skills named in the text still come
  // from the shared code below, and an ordinary CV is read exactly as before.
  const li = looksLikeLinkedIn(text)
    ? readLinkedIn(layout?.length ? layout.map((l) => ({ text: l.text, size: l.column === "main" ? l.size : undefined })) : lines.map((t) => ({ text: t })), { fromPdf: !!layout?.length })
    : null;
  const linkedIn = li ? fromLinkedIn(li) : null;
  const fullText = lines.join("\n");
  const sections = splitSections(lines);

  const emailFromDoc = fullText.match(EMAIL_RE)?.[0] ?? "";
  const email = emailFromDoc || fallback.email || "";
  const phone = fullText.match(PHONE_RE)?.[0]?.trim() ?? "";
  const nameFromDoc = li ? li.name : titleCaseIfShouting(findName(sections.head ?? []) || "");
  const name = nameFromDoc || (fallback.name ?? "");
  const location = li?.location || findLocation(sections.head ?? [], fullText);
  // LinkedIn: the profile's own skill lists plus known skills named anywhere; its section layout is not the generic "Skills:" line format.
  const generic = parseSkills(linkedIn ? {} : sections, fullText);
  const allSkills = linkedIn ? [...new Map([...linkedIn.skills, ...generic.skills].map((sk) => [stripMarks(sk).trim(), sk])).values()] : generic.skills;
  const languageLines = linkedIn ? [] : generic.languageLines;
  let allExperience = linkedIn ? linkedIn.workExperience : parseExperience(sections.experience ?? []);
  if (!linkedIn && !allExperience.length) allExperience = parseExperienceLegacy(sections.experience ?? []);
  const allEducation = linkedIn ? linkedIn.education : parseEducation(sections.education ?? []);
  const skills = allSkills.slice(0, CV_LIMITS.skills);
  const workExperience = allExperience.slice(0, CV_LIMITS.workExperience);
  const education = allEducation.slice(0, CV_LIMITS.education);

  // Summary: the profile paragraph exactly as written, whole. (It used to be cut to 120 characters in the middle of a word and then reused as the
  // CV's summary line.)
  const summary = linkedIn ? linkedIn.summary : (sections.summary ?? []).map((l) => l.trim()).filter(Boolean).reduce((acc, l) => (acc ? joinWrapped(acc, l) : l), "");

  // Headline: the tagline printed under the name when there is one ("Data Analyst | Product Builder"), else the first sentence of the summary cut at
  // a word boundary, else the most recent role. A LinkedIn profile always prints its own headline; when the reader cannot find it, the most recent
  // title is used, never the About text.
  const headLines = (sections.head ?? []).map((l) => l.trim());
  const nameAt = nameFromDoc ? headLines.findIndex((l) => l === nameFromDoc || fold(l) === fold(nameFromDoc)) : -1;
  const tagline = li
    ? li.headline || undefined
    : nameAt < 0
    ? undefined
    : headLines
        .slice(nameAt + 1, nameAt + 4)
        .filter((l) => l && !EMAIL_RE.test(l) && !PHONE_RE.test(l) && !/https?:\/\/|linkedin|github|www\.|@/i.test(l) && !looksLikeLocation(l))
        .find((l) => l.length >= 8 && l.length <= 140 && l.split(/\s+/).length >= 2);
  const firstSentence = summary.match(/^.{12,}?[.!?](?=\s|$)/)?.[0] ?? summary;
  const wordCut = (t: string, max: number) => (t.length <= max ? t : `${t.slice(0, max).replace(/\s+\S*$/, "").replace(/[,;:\s-]+$/, "")}…`);
  const headline = tagline ?? (li ? workExperience[0]?.title ?? "" : firstSentence ? wordCut(firstSentence, 140) : workExperience[0]?.title ?? "");

  const extracted: string[] = [];
  if (nameFromDoc) extracted.push("name");
  if (emailFromDoc) extracted.push("email");
  if (phone) extracted.push("phone");
  if (headline) extracted.push("headline");
  if (location) extracted.push("location");
  if (skills.length) extracted.push("skills");
  if (workExperience.length) extracted.push("workExperience");
  if (education.length) extracted.push("education");
  const allSuggestions = linkedIn ? linkedIn.careerSuggestions : parseCareerSections(fullText);
  // Languages written inside the skills section ("Languages: Azerbaijani (Native), English (C1)") are career-evidence languages, not skills.
  if (languageLines.length) {
    const have = new Set(allSuggestions.filter((s) => s.kind === "LANGUAGE").map((s) => fold(s.title)));
    for (const entry of parseLanguageLines(languageLines)) if (!have.has(fold(entry.title))) allSuggestions.push(entry);
  }
  const careerSuggestions = allSuggestions.slice(0, CV_LIMITS.careerSuggestions);
  if (careerSuggestions.length) extracted.push("careerSections");
  const omitted = Object.fromEntries(
    ([['skills', allSkills.length - skills.length], ['workExperience', allExperience.length - workExperience.length], ['education', allEducation.length - education.length], ['careerSuggestions', allSuggestions.length - careerSuggestions.length]] as const).filter(([, n]) => n > 0),
  );

  return {
    personalInfo: { name, email, phone },
    headline,
    summary,
    location,
    skills,
    workExperience,
    education,
    careerSuggestions,
    extracted,
    ...(Object.keys(omitted).length ? { omitted } : {}),
  };
}

// ------------------------------------------------------------ career evidence --

export const CAREER_PARSER_VERSION = 3;

export type CareerSuggestionKind =
  | "PROJECT" | "VOLUNTEERING" | "LEADERSHIP" | "EXTRACURRICULAR" | "CERTIFICATION" | "LANGUAGE" | "AWARD";

/**
 * A career-evidence entry READ from the document, never composed. Every field is either text that appears in `evidence` (the original lines)
 * or null. These are suggestions: the candidate confirms, corrects or hides each one before anything can use it.
 */
export type CareerSuggestion = {
  kind: CareerSuggestionKind;
  title: string;
  organization: string | null;
  role: string | null;
  startDate: string | null;
  endDate: string | null;
  current: boolean;
  issuedAt: string | null;
  level: string | null;
  description: string | null;
  /** YEAR when the document states only years; a year-only date is never shown as a month. */
  precision: "YEAR" | "MONTH";
  evidence: string;
};

const BULLET_RE = /^\s*[•▪●◦·*\-–—]\s+/u;
const isBullet = (line: string) => BULLET_RE.test(line);
const unbullet = (line: string) => line.replace(BULLET_RE, "").trim();

const blank = (kind: CareerSuggestionKind, title: string, evidence: string): CareerSuggestion => ({
  kind, title: title.slice(0, 160), organization: null, role: null, startDate: null, endDate: null, current: false,
  issuedAt: null, level: null, description: null, precision: "MONTH", evidence,
});

const isDateWord = (tok: string): boolean => {
  const t = stripMarks(tok.replace(/[.,]$/, ""));
  return /^(?:19|20)\d{2}$/.test(t) || /^\d{1,2}[./](?:19|20)\d{2}$/.test(t) || t in MONTHS || /^[-–—]$/.test(t) ||
    ["to", "until", "present", "current", "now", "indi", "hazirda", "hal-hazirda", "davam", "edir"].includes(t);
};

/**
 * The explicit trailing date (range) of a header line, split from its text. Only real date words count: "Universitet layihəsi 2022" gives the
 * year 2022 and keeps "layihəsi" in the text (extractTrailingDate would read "layihəsi 2022" as a month and a year).
 */
function splitTrailingDate(line: string): { text: string; range: DateRange | null; precision: "YEAR" | "MONTH" } {
  const tokens = line.trim().split(/\s+/);
  for (let k = Math.min(7, tokens.length); k >= 1; k--) {
    const tail = tokens.slice(-k);
    if (!tail.every(isDateWord) || !/(?:19|20)\d{2}/.test(tail.join(" "))) continue;
    const range = findDateRange(tail.join(" "));
    if (!range) continue;
    const monthStated = tail.some((t) => stripMarks(t.replace(/[.,]$/, "")) in MONTHS || /^\d{1,2}[./]/.test(t));
    return { text: tokens.slice(0, tokens.length - k).join(" ").replace(/[|,:;\-–—]\s*$/, "").trim(), range, precision: monthStated ? "MONTH" : "YEAR" };
  }
  return { text: line.trim(), range: null, precision: "MONTH" };
}

/** A wrapped bullet is still that bullet. Start another entry only at a header, never just at an unmarked line. */
function headerBlocks(lines: string[]): { header: string[]; bullets: string[]; raw: string[] }[] {
  const blocks: { header: string[]; bullets: string[]; raw: string[] }[] = [];
  let cur: { header: string[]; bullets: string[]; raw: string[] } | null = null;
  const clean = lines.map((l) => l.trim()).filter(Boolean);
  const isHeader = (line: string, next?: string) => {
    // Sentence endings and lower-case continuations must not become titles, even when they contain a year or a dash.
    if (/[.!?;,]$/.test(line) || /^\p{Ll}/u.test(line)) return false;
    if (/^(?:Built|Created|Developed|Designed|Completed|Implemented|Led|Improved|Validated|Prepared|Managed|Qurdum|Hazırladım|İşlədim)\b/iu.test(line)) return false;
    const dated = splitTrailingDate(line);
    if (dated.range && dated.text) return true;
    if (/\s\|\s|\s[–—]\s/.test(line)) return true;
    // Undated titles and title/date-on-next-line layouts need an explicit boundary in the following line.
    return line.length <= 120 && !/[,;()]/.test(line) && !!next && (isBullet(next) || !!splitTrailingDate(next).range && !splitTrailingDate(next).text);
  };
  for (const [i, line] of clean.entries()) {
    if (isBullet(line)) {
      if (!cur) cur = { header: [], bullets: [], raw: [] };
      cur.bullets.push(unbullet(line)); cur.raw.push(line);
      continue;
    }
    const startsEntry = isHeader(line, clean[i + 1]);
    if (cur?.bullets.length && !startsEntry) {
      const last = cur.bullets.length - 1;
      cur.bullets[last] = joinWrapped(cur.bullets[last], line);
      cur.raw.push(line);
      continue;
    }
    if (!cur || startsEntry && (cur.bullets.length || cur.header.some((h) => !!splitTrailingDate(h).range))) {
      if (cur) blocks.push(cur);
      cur = { header: [], bullets: [], raw: [] };
    }
    cur.header.push(line); cur.raw.push(line);
  }
  if (cur) blocks.push(cur);
  return blocks.filter((b) => b.header.length || b.bullets.length);
}

function parseProjectLike(kind: CareerSuggestionKind, lines: string[]): CareerSuggestion[] {
  const out: CareerSuggestion[] = [];
  for (const b of headerBlocks(lines)) {
    if (!b.header.length) continue; // bullets with no heading line cannot be attributed to anything
    const head = b.header.map((h) => splitTrailingDate(h));
    const range = head.find((h) => h.range)?.range ?? null;
    const texts = head.map((h) => h.text).filter(Boolean);
    if (!texts.length) continue;
    const entry = blank(kind, "", b.raw.join("\n"));
    if (kind === "PROJECT") {
      // "Name — short description" keeps the description; "Name | Org" keeps the organisation.
      // A project's tools/organisation can contain commas; the job-header location heuristic must not discard them.
      const pipe = texts[0].split('|').map((p) => p.trim()).filter(Boolean);
      const dash = texts[0].split(/\s+[–—-]\s+/);
      if (pipe.length >= 2) { entry.title = pipe[0]; entry.organization = pipe.slice(1).join(" | "); }
      else if (dash.length >= 2) { entry.title = dash[0]; entry.description = dash.slice(1).join(" – "); }
      else entry.title = texts[0];
      if (texts.length > 1) entry.description = [entry.description, ...texts.slice(1)].filter(Boolean).join(" ");
    } else {
      // Activities: "Role | Organisation", "Role, Organisation" or "Role – Organisation"; otherwise the whole line is the title.
      const pipe = splitPipeHeader(texts[0]);
      const dash = texts[0].split(/\s+[–—-]\s+|,\s+/);
      const parts = pipe.length >= 2 ? pipe : dash.length >= 2 ? dash : [texts[0]];
      if (parts.length >= 2) { entry.role = parts[0]; entry.organization = parts.slice(1).join(", "); entry.title = parts[0]; }
      else entry.title = parts[0];
      if (texts.length > 1) entry.description = texts.slice(1).join(" ");
    }
    if (b.bullets.length) entry.description = [entry.description, b.bullets.join(" ")].filter(Boolean).join(" ");
    entry.title = entry.title.trim().slice(0, 160);
    if (!entry.title) continue;
    entry.description = entry.description ? entry.description.slice(0, 1500) : null;
    entry.startDate = range?.start ?? null; entry.endDate = range?.end ?? null; entry.current = !!range?.current;
    entry.precision = head.find((h) => h.range)?.precision ?? "MONTH";
    out.push(entry);
  }
  return out;
}

function parseCertificateLike(kind: CareerSuggestionKind, lines: string[]): CareerSuggestion[] {
  const out: CareerSuggestion[] = [];
  for (const raw of lines.map((l) => l.trim()).filter(Boolean)) {
    const line = unbullet(raw);
    if (!line || line.length > 200) continue;
    const { text, range, precision } = splitTrailingDate(line);
    const pipe = text.split("|").map((p) => p.trim()).filter(Boolean);
    const parts = pipe.length >= 2 ? pipe : text.split(/\s+[–—-]\s+|,\s+/).map((p) => p.trim()).filter(Boolean);
    const title = (parts[0] ?? "").trim();
    if (!title || /^\d+$/.test(title)) continue;
    const entry = blank(kind, title, raw);
    if (parts.length >= 2) entry.organization = parts.slice(1).join(", ").slice(0, 160);
    entry.issuedAt = range?.end ?? range?.start ?? null;
    entry.precision = precision;
    out.push(entry);
  }
  return out;
}

const LANGUAGE_TOKEN = /^([\p{L}][\p{L}.'’ -]{1,28}?)\s*(?:[–—:-]\s*|\(\s*)([^()]{1,40}?)\s*\)?$/u;

function parseLanguageLines(lines: string[]): CareerSuggestion[] {
  const out: CareerSuggestion[] = [];
  for (const raw of lines.map((l) => l.trim()).filter(Boolean)) {
    for (const piece of unbullet(raw).split(/[;,|•]/).map((p) => p.trim()).filter(Boolean)) {
      const m = LANGUAGE_TOKEN.exec(piece);
      const name = (m ? m[1] : piece).trim();
      if (!/^[\p{L}][\p{L}.'’ -]{1,28}$/u.test(name) || name.split(/\s+/).length > 3) continue;
      const entry = blank("LANGUAGE", name, piece);
      entry.level = m && m[2] ? m[2].trim().slice(0, 40) : null;
      if (!out.some((e) => fold(e.title) === fold(entry.title))) out.push(entry);
    }
  }
  return out;
}

/**
 * Career-evidence suggestions from the document's own project, volunteering, leadership, extracurricular, certification, award and language
 * sections. Anything the text does not say stays null; nothing is composed or inferred, and every suggestion keeps its original lines.
 */
export function parseCareerSections(text: string): CareerSuggestion[] {
  const sections = splitSections(normalizeText(text));
  return [
    ...parseProjectLike("PROJECT", sections.projects ?? []),
    ...parseProjectLike("VOLUNTEERING", sections.volunteering ?? []),
    ...parseProjectLike("LEADERSHIP", sections.leadership ?? []),
    ...parseProjectLike("EXTRACURRICULAR", sections.extracurricular ?? []),
    ...parseCertificateLike("CERTIFICATION", sections.certifications ?? []),
    ...parseCertificateLike("AWARD", sections.awards ?? []),
    ...parseLanguageLines(sections.languages ?? []),
  ];
}

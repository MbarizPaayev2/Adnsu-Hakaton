import type { Persona, TailorJobInput } from './resume-tailor.types';
import { type VacancyAnalysis, type VacancyPriority, foldText } from './az-vacancy-analysis';

export type EvidenceScope =
  | 'employment'
  | 'internship'
  | 'mentorship'
  | 'student_project'
  | 'course'
  | 'certification'
  | 'activity'
  | 'reported_skill';

export type MatchClassification = 'direct' | 'transferable' | 'skill_only' | 'unmatched';

export interface StructuredEvidence {
  id: string; // e.g. E1, E2
  source: 'experience' | 'project' | 'activity' | 'certification' | 'story' | 'skill';
  sourceRoleId?: string;
  sourceIndex?: number;
  scope: EvidenceScope;
  title: string;
  organization?: string;
  period?: string;
  text: string;
  tools: string[];
  hasConcreteResult: boolean;
  isNegated: boolean;
}

export interface PriorityMatch {
  priorityId: string;
  priorityTitle: string;
  importance: VacancyPriority['importance'];
  classification: MatchClassification;
  matchedEvidence?: StructuredEvidence;
  score: number;
  gapQuestion?: string;
}

const COMMON_SKILL_TOOLS = [
  'python', 'java', 'javascript', 'typescript', 'sql', 'c#', 'c++', 'go', 'golang', 'rust', 'php',
  'react', 'angular', 'vue', 'next.js', 'node.js', 'django', 'fastapi', 'spring boot', 'laravel',
  'postgresql', 'postgres', 'mysql', 'mssql', 'oracle', 'mongodb', 'redis',
  'docker', 'kubernetes', 'aws', 'azure', 'gcp', 'git', 'linux',
  'excel', 'power bi', 'tableau', 'jira', 'confluence', 'figma', '1c', 'sap',
];

export function extractToolsFromText(text: string): string[] {
  const folded = foldText(text);
  return COMMON_SKILL_TOOLS.filter((tool) => {
    const re = new RegExp(`(^|[^a-z0-9])${tool.replace(/[.+*]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
    return re.test(folded);
  });
}

export function detectScope(
  source: StructuredEvidence['source'],
  title: string,
  organization?: string,
): EvidenceScope {
  if (source === 'certification') {
    if (/\b(?:kurs|təlim|training|course|bootcamp|akademiya)\b/iu.test(title)) return 'course';
    return 'certification';
  }
  if (source === 'project') return 'student_project';
  if (source === 'activity') return 'activity';
  if (source === 'skill') return 'reported_skill';

  const t = title.toLowerCase();
  if (/\b(?:mentee|mentorluq)\b/i.test(t) || /\b(?:mentorship|mentoring)\s+program(?:me)?\b|mentorluq\s+proqram/iu.test(organization ?? '')) return 'mentorship';
  if (/\b(?:intern|təcrübəçi|staj|apprentice|şagird)\b/i.test(t)) return 'internship';
  return 'employment';
}

export const isNegatedText = (text: string): boolean =>
  /(?:yoxdur|yoxdu|olmayıb|olmayıbdır|keçməyib|deyil|bilmir|bilmirəm)[\s.!;:]*$/iu.test(String(text ?? '').trim());

/**
 * Extracts all candidate evidence items with strictly preserved scope and IDs.
 */
export function extractCandidateEvidence(persona: Persona): StructuredEvidence[] {
  const items: StructuredEvidence[] = [];
  let seq = 1;

  // 1. Experiences
  (persona.experience ?? []).forEach((exp, expIndex) => {
    const roleId = exp.entryId?.trim() || `exp_${expIndex}`;
    const scope = detectScope('experience', exp.position, exp.company);
    for (const h of exp.highlights ?? []) {
      const trimmed = h.trim();
      if (trimmed.length < 5) continue;
      items.push({
        id: `E${seq++}`,
        source: 'experience',
        sourceRoleId: roleId,
        sourceIndex: expIndex,
        scope,
        title: exp.position,
        organization: exp.company,
        period: exp.period,
        text: trimmed,
        tools: extractToolsFromText(trimmed),
        hasConcreteResult: /\d+|%|\b(?:artırdı|azaltdı|təhvil\s+verildi|tamamlandı|nail\s+olundu|qurdu)\b/iu.test(trimmed),
        isNegated: isNegatedText(trimmed),
      });
    }
  });

  // 2. Projects
  (persona.projects ?? []).forEach((p, pIndex) => {
    const desc = [p.description, p.result].filter(Boolean).join('. ').trim();
    if (desc.length < 5) return;
    items.push({
      id: `E${seq++}`,
      source: 'project',
      sourceRoleId: (p as any).entryId?.trim() || `proj_${pIndex}`,
      sourceIndex: pIndex,
      scope: 'student_project',
      title: p.name,
      organization: p.organization,
      period: p.period,
      text: desc,
      tools: extractToolsFromText(`${p.name} ${desc}`),
      hasConcreteResult: Boolean(p.result?.trim()),
      isNegated: isNegatedText(desc),
    });
  });

  // 3. Certifications
  (persona.certifications ?? []).forEach((c, cIndex) => {
    const title = c.title?.trim() || '';
    if (title.length < 3) return;
    items.push({
      id: `E${seq++}`,
      source: 'certification',
      sourceRoleId: (c as any).entryId?.trim() || `cert_${cIndex}`,
      sourceIndex: cIndex,
      scope: detectScope('certification', title, c.issuer),
      title,
      organization: c.issuer,
      period: c.date,
      text: [title, c.issuer, c.description].filter(Boolean).join(' - '),
      tools: extractToolsFromText(title),
      hasConcreteResult: false,
      isNegated: false,
    });
  });

  // 4. Activities
  (persona.activities ?? []).forEach((a, aIndex) => {
    const text = [a.description, a.result].filter(Boolean).join('. ').trim() || a.title;
    items.push({
      id: `E${seq++}`,
      source: 'activity',
      sourceRoleId: (a as any).entryId?.trim() || `act_${aIndex}`,
      sourceIndex: aIndex,
      scope: 'activity',
      title: a.title,
      organization: a.organization,
      period: a.period,
      text,
      tools: extractToolsFromText(text),
      hasConcreteResult: Boolean(a.result?.trim()),
      isNegated: isNegatedText(text),
    });
  });

  return items;
}

/** Calculates task relevance score between an evidence item and a priority/terms. */
export function calculateRelevance(
  evidence: StructuredEvidence,
  priority: VacancyPriority,
  _vacTools?: string[],
): number {
  if (evidence.isNegated) return 0;

  const evTextFolded = foldText(`${evidence.title} ${evidence.text}`);
  const prioTextFolded = foldText(`${priority.title} ${priority.sourceText} ${priority.keywords.join(' ')}`);

  // 1. Tool / Technology alignment ONLY against THIS specific priority (no global vacancy tool contamination)
  const sharedTools = evidence.tools.filter((t) => {
    const re = new RegExp(`(^|[^a-z0-9])${t.replace(/[.+*]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
    return re.test(prioTextFolded);
  });

  // 2. Keyword / Stem matches against THIS specific priority
  let keywordMatches = 0;
  const prioWords = prioTextFolded.split(/[^a-z0-9]+/u).filter((w) => w.length >= 4);
  const matchedWords = new Set<string>();
  for (const w of prioWords) {
    const stem = w.slice(0, 5);
    if (!matchedWords.has(stem) && evTextFolded.includes(stem)) {
      matchedWords.add(stem);
      keywordMatches++;
    }
  }

  // Substantive alignment requirement:
  // An evidence item must share a tool with THIS priority or have at least 2 distinct keyword stem matches.
  // Metric/deliverable bonuses must not be awarded to completely unrelated evidence.
  const hasSubstantiveAlignment = sharedTools.length > 0 || keywordMatches >= 2;
  if (!hasSubstantiveAlignment) {
    return 0;
  }

  let score = sharedTools.length * 3.0 + keywordMatches * 1.0;

  // 3. Concrete deliverable / result bonus ONLY when substantively aligned
  if (evidence.hasConcreteResult) {
    score += 1.5;
  }

  // 4. Scope weighting: substantive employment and real projects > internship/mentorship
  if (evidence.scope === 'employment') score *= 1.2;
  else if (evidence.scope === 'student_project') score *= 1.0;
  else if (evidence.scope === 'internship' || evidence.scope === 'mentorship') score *= 0.9;
  else if (evidence.scope === 'course' || evidence.scope === 'certification') score *= 0.8;

  return Math.round(score * 10) / 10;
}

/**
 * Maps vacancy priorities to candidate evidence, enforcing scope truthfulness and ranking by task relevance.
 */
export function mapPrioritiesToEvidence(
  analysis: VacancyAnalysis,
  persona: Persona,
): { matches: PriorityMatch[]; candidateEvidence: StructuredEvidence[]; gapQuestions: string[] } {
  const candidateEvidence = extractCandidateEvidence(persona);
  const reportedSkills = new Set(
    (persona.skills ?? []).flatMap((s) => s.keywords ?? []).map((k) => foldText(k.trim())).filter(Boolean),
  );

  const matches: PriorityMatch[] = [];
  const gapQuestions: string[] = [];

  for (const priority of analysis.priorities) {
    // Score all non-negated candidate evidence against THIS priority.
    // Do not arbitrarily lock out evidence from matching other priorities.
    const scored = candidateEvidence
      .filter((e) => !e.isNegated)
      .map((e) => ({
        evidence: e,
        score: calculateRelevance(e, priority),
      }))
      .filter((x) => x.score >= 2.0)
      .sort((a, b) => b.score - a.score);

    if (scored.length > 0) {
      const best = scored[0];

      // Distinguish direct vs transferable based on scope & relevance
      const isDirect = best.score >= 3.5 && (best.evidence.scope === 'employment' || best.evidence.scope === 'student_project');
      const classification: MatchClassification = isDirect ? 'direct' : 'transferable';

      matches.push({
        priorityId: priority.id,
        priorityTitle: priority.title,
        importance: priority.importance,
        classification,
        matchedEvidence: best.evidence,
        score: best.score,
      });
    } else {
      // Check if candidate at least reported a matching skill in their skills list for THIS priority
      const prioFolded = foldText(`${priority.title} ${priority.sourceText}`);
      const hasReportedSkill = priority.keywords.some((kw) => reportedSkills.has(foldText(kw))) ||
        [...reportedSkills].some((skill) => prioFolded.includes(skill));

      if (hasReportedSkill) {
        matches.push({
          priorityId: priority.id,
          priorityTitle: priority.title,
          importance: priority.importance,
          classification: 'skill_only',
          score: 1.0,
          gapQuestion: `«${priority.title}» üzrə təcrübəniz varmı? Konkret istifadə etdiyiniz alət və ya çatdırdığınız nəticəni qeyd edə bilərsiniz.`,
        });
        if (gapQuestions.length < 2) {
          gapQuestions.push(`«${priority.title}» üzrə praktiki iş nümunəniz və ya nəticəniz varmı?`);
        }
      } else {
        matches.push({
          priorityId: priority.id,
          priorityTitle: priority.title,
          importance: priority.importance,
          classification: 'unmatched',
          score: 0,
          gapQuestion: `Vakansiyada «${priority.title}» tələb olunur. Bu sahədə əvvəllər təcrübəniz və ya təliminiz olubmu?`,
        });
        if (gapQuestions.length < 2 && priority.importance === 'required') {
          gapQuestions.push(`Vakansiyadakı «${priority.sourceText.slice(0, 80)}» tələbi üzrə real təcrübəniz olubmu?`);
        }
      }
    }
  }

  return { matches, candidateEvidence, gapQuestions };
}

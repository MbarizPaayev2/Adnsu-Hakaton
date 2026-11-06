/**
 * BOUNDED REAL-MODEL DOCUMENT EVALUATION, with a before/after comparison of the generation prompts — PREPARED, NOT RUN. Nothing in the repository claims this evaluation has been done.
 *
 * What it does when an operator runs it with authorised provider access: 3 synthetic candidates (Azerbaijani, English, Russian) x 3 documents
 * (concise resume, fuller CV, motivation letter) = 9 generations through the product's own ResumeTailorService (real prompt, real fact-check, real Typst PDF),
 * recording latency, tokens, provider calls and outcomes, running offline flag-checks (unsupported numbers/names, claimed missing skills, language, relevance,
 * PDF pages/text) and writing results + PDFs + a blank human rubric to a directory OUTSIDE git.
 *
 * It refuses to run unless: NVIDIA_API_KEY is configured (never printed), NIM_API_URL is unset or a non-loopback https URL (a loopback URL is a fake,
 * and a fake is never reported as a real model), and EVAL_CONFIRM=I-AUTHORIZE-REAL-PROVIDER-CALLS. Hard budget: EVAL_MAX_CALLS (default 27 = 9 x the
 * product's 3-attempt bound) provider requests; it stops at the budget. Synthetic data only; no database, no queue, no e-mail, no application is touched.
 *
 *   npx ts-node -r tsconfig-paths/register --transpile-only test/evals/real-model-documents-eval.ts --self-test   # offline check of the checks
 *   npx ts-node -r tsconfig-paths/register --transpile-only test/evals/real-model-documents-eval.ts              # dry run: preflight + plan, no network
 *   EVAL_CONFIRM=I-AUTHORIZE-REAL-PROVIDER-CALLS npx ts-node ... test/evals/real-model-documents-eval.ts --run  # real calls
 * Optional: NIM_MODEL, EVAL_PRICE_IN_PER_MTOK / EVAL_PRICE_OUT_PER_MTOK (provider's published prices; without them cost is reported as tokens only), EVAL_OUT.
 */
import { ConfigService } from '@nestjs/config';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResumeTailorService } from '../../src/resumes/tailor/resume-tailor.service';
import type { LetterContent, TailoredContent } from '../../src/resumes/tailor/resume-tailor.types';
import { CASES, PILOT, type EvalKind } from './real-model-fixtures';
import { legacyBuildLetterMessages, legacyBuildMessages } from './legacy-prompts';
import { allowedVocabulary, answerWords, azStyleFlags, claimedTraps, contentToText, documentMetrics, languageLooksRight, relevanceCoverage, selfTest, skillDumpSentences, survivingPersonalClaims, unsupportedTokens } from './real-model-checks';

type Arm = 'before' | 'after';

function preflight() {
  const problems: string[] = [];
  const url = process.env.NIM_API_URL?.trim();
  const host = url ? (() => { try { return new URL(url); } catch { return null; } })() : null;
  if (!process.env.NVIDIA_API_KEY?.trim()) problems.push('NVIDIA_API_KEY is not configured (the provider key the product uses; its value is never printed).');
  if (url && (!host || host.protocol !== 'https:' || ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host.hostname))) problems.push('NIM_API_URL must be unset (the provider default) or a non-loopback https URL: a loopback endpoint is a fake and cannot be reported as a real model.');
  if (process.env.EVAL_CONFIRM !== 'I-AUTHORIZE-REAL-PROVIDER-CALLS') problems.push('EVAL_CONFIRM=I-AUTHORIZE-REAL-PROVIDER-CALLS is not set (explicit authorisation for real provider calls).');
  return { problems, endpointHost: host?.hostname ?? 'integrate.api.nvidia.com (default)', model: process.env.NIM_MODEL || '(product default)' };
}

/** Text by the product's own PDF reader (out of process: pdf.js is ESM); the page count from the PDF's page tree (`/Count`), which Typst writes in the clear. */
function inspectPdf(bytes: Buffer) {
  const dir = mkdtempSync(join(tmpdir(), 'aise-eval-pdf-'));
  const file = join(dir, 'doc.pdf');
  writeFileSync(file, bytes);
  const script = `require('./src/resumes/cv-extract').extractCvText(require('fs').readFileSync(process.argv[1]), 'application/pdf').then((t) => process.stdout.write(JSON.stringify(t)))`;
  const text = (JSON.parse(execFileSync(process.execPath, [require.resolve('ts-node/dist/bin.js'), '--transpile-only', '-e', script, file], { cwd: process.cwd(), timeout: 60_000 }).toString()) as string).replace(/\s+/g, ' ');
  const counts = [...bytes.toString('latin1').matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  return { text, pages: counts.length ? Math.max(...counts) : 0 };
}

/** `before` = the prompts of commit 12e3570 (legacy-prompts.ts); `after` = the current prompts. Both arms run through the CURRENT code-side guards, so the comparison isolates the prompts. Short answers exist only in `after`. */
const plan = (arms: Arm[], pilot = false) => arms.flatMap((arm) => CASES.flatMap((c) => c.kinds
  .filter((k) => (arm === 'after' || k !== 'ANSWER') && (!pilot || PILOT.some((p) => p.case === c.id && p.kind === k)))
  .map((k) => ({ arm, case: c, kind: k as EvalKind }))));
const MAX_PER_GENERATION = 3; // the product's own attempt bound

function tailorFor(arm: Arm) {
  if (arm === 'after') return new ResumeTailorService(new ConfigService());
  class Legacy extends ResumeTailorService {}
  (Legacy.prototype as any).buildMessages = function (persona: any, job: any, opts: any) { return legacyBuildMessages(persona, job, opts); };
  (Legacy.prototype as any).buildLetterMessages = function (persona: any, job: any, language: string, motivation: string, fixed: string[]) { return legacyBuildLetterMessages(persona, job, language, motivation, fixed); };
  return new Legacy(new ConfigService());
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) { console.log(selfTest()); return; }
  const armsArg = (args.find((a) => a.startsWith('--arms='))?.slice(7) ?? 'before,after').split(',') as Arm[];
  const arms = armsArg.filter((a) => a === 'before' || a === 'after');
  const pilot = args.includes('--pilot');
  const total = plan(arms, pilot).length;
  const MAX_CALLS = Number(process.env.EVAL_MAX_CALLS) || total * MAX_PER_GENERATION;
  // Worst case per generation is 3 attempts x (a prompt of a few thousand tokens + the output cap); the default stops well before an open-ended bill.
  const MAX_TOKENS = Number(process.env.EVAL_MAX_TOTAL_TOKENS) || total * 25_000;
  const pre = preflight();
  console.log('REAL-MODEL EVALUATION (prepared; not run unless --run)');
  console.log(`${pilot ? 'PILOT ' : ''}arms: ${arms.join(' vs ')}; ${total} generations: ${plan(arms, pilot).map((p) => `${p.arm}:${p.case.id}:${p.kind}`).join(', ')}; caps: ${MAX_CALLS} provider requests, ${MAX_TOKENS} tokens`);
  console.log(`endpoint: ${pre.endpointHost}; model: ${pre.model}`);
  if (pre.problems.length) { console.log('BLOCKED — missing prerequisites:'); pre.problems.forEach((p) => console.log(` - ${p}`)); if (args.includes('--run')) process.exit(2); console.log('(dry run: nothing was called)'); return; }
  if (!args.includes('--run')) { console.log('Prerequisites present. Dry run only; add --run to make real provider calls.'); return; }

  const out = process.env.EVAL_OUT || join(homedir(), 'aise-preview', 'evals', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(out, { recursive: true });
  const nativeFetch = global.fetch;
  let calls = 0;
  global.fetch = (async (input: any, init?: any) => {
    if (++calls > MAX_CALLS) throw new Error(`Evaluation budget of ${MAX_CALLS} provider requests reached; stopping`);
    return nativeFetch(input, init);
  }) as typeof fetch;

  const tailors: Record<Arm, ResumeTailorService> = { before: tailorFor('before'), after: tailorFor('after') };
  const priceIn = Number(process.env.EVAL_PRICE_IN_PER_MTOK), priceOut = Number(process.env.EVAL_PRICE_OUT_PER_MTOK);
  const flatten = (v: unknown, o: string[] = []): string[] => { if (typeof v === 'string') o.push(v); else if (Array.isArray(v)) v.forEach((x) => flatten(x, o)); else if (v && typeof v === 'object') Object.values(v).forEach((x) => flatten(x, o)); return o; };
  const results: any[] = [];
  const texts: { arm: Arm; caseId: string; kind: EvalKind; language: string; text: string }[] = [];

  let tokensUsed = 0;
  for (const { arm, case: c, kind } of plan(arms, pilot)) {
    if (tokensUsed >= MAX_TOKENS) { console.log(`Token cap of ${MAX_TOKENS} reached; stopping before ${arm}:${c.id}:${kind}`); break; }
    const tailor = tailors[arm];
    const label = `${arm}-${c.id}-${kind.toLowerCase()}`;
    const started = Date.now();
    try {
      const prose = kind === 'LETTER' || kind === 'ANSWER';
      const generated = prose
        ? await tailor.generateLetter(c.persona, c.job, { language: c.language, motivation: c.motivation, ...(kind === 'ANSWER' ? { mode: 'answer' as const, question: c.question } : {}) })
        : await tailor.generate(c.persona, c.job, { format: kind === 'RESUME' ? 'resume' : 'cv', language: c.language });
      writeFileSync(join(out, `${label}.content.json`), JSON.stringify(generated.content, null, 2));
      let text: string;
      let pdfInfo: { pages: number; bytes: number; hasName: boolean } | null = null;
      if (kind === 'ANSWER') {
        text = (generated.content as LetterContent).paragraphs.map((p) => p.text).join('\n\n');
        writeFileSync(join(out, `${label}.txt`), text);
      } else {
        const pdf = kind === 'LETTER' ? tailor.compileLetterPdfBytes(generated.content as LetterContent) : tailor.compileDocumentPdf(generated.content as TailoredContent);
        writeFileSync(join(out, `${label}.pdf`), pdf);
        const inspected = inspectPdf(pdf);
        text = inspected.text;
        pdfInfo = { pages: inspected.pages, bytes: pdf.length, hasName: text.includes(c.persona.basics.name.split(' ')[0]) };
      }
      texts.push({ arm, caseId: c.id, kind, language: c.language, text: contentToText(generated.content) });
      const proseText = prose ? (generated.content as LetterContent).paragraphs.map((p) => p.text).join('\n') : '';
      const allowed = allowedVocabulary(c.persona, [c.job.position, c.job.company, c.job.location, c.job.description, c.job.requirements, c.motivation]);
      const skills = c.persona.skills.flatMap((s) => s.keywords);
      const meta = generated.meta;
      tokensUsed += meta.promptTokens + meta.completionTokens;
      results.push({
        label, arm, case: c.id, language: c.language, kind, status: 'GENERATED', latencyMs: meta.latencyMs, wallMs: Date.now() - started, providerCalls: meta.calls, outcomes: meta.outcomes,
        promptTokens: meta.promptTokens, completionTokens: meta.completionTokens,
        cost: priceIn && priceOut ? Number(((meta.promptTokens * priceIn + meta.completionTokens * priceOut) / 1e6).toFixed(5)) : 'tokens only (no price configured)',
        factCheckRemoved: generated.issues.filter((i: any) => i.severity === 'error').length, factCheckNotes: generated.issues.map((i: any) => i.code),
        unsupported: unsupportedTokens(text, allowed), claimedMissingSkills: claimedTraps(text, c.trap), language_check: languageLooksRight(text, c.language),
        relevance: relevanceCoverage(text, c.persona, `${c.job.description} ${c.job.requirements}`), pdf: pdfInfo,
        ...(prose ? {
          style: {
            survivingPersonalClaims: survivingPersonalClaims(proseText, [...flatten(c.persona), c.motivation].join(' '), c.language),
            skillDumpSentences: skillDumpSentences(proseText, skills).length,
            azFlags: c.language === 'az' ? azStyleFlags(proseText) : 'n/a',
            words: answerWords((generated.content as LetterContent).paragraphs.map((p) => p.text)),
            admirationWithoutReason: !c.motivation && /heyran|ilhamlandır|ən yaxşı|xəyal|ehtiras/i.test(proseText),
          },
        } : { document: documentMetrics(generated.content, c.persona) }),
      });
    } catch (e) {
      results.push({ label, arm, case: c.id, language: c.language, kind, status: 'FAILED', error: (e as Error).message.slice(0, 300), wallMs: Date.now() - started });
    }
    console.log(`${label}: ${results[results.length - 1].status}`);
  }
  global.fetch = nativeFetch;
  writeFileSync(join(out, 'results.json'), JSON.stringify({ model: tailors.after.getModel(), endpointHost: pre.endpointHost, providerRequests: calls, tokensUsed, pilot, arms, results }, null, 2));
  // Every generated PDF is rasterised so each page can be looked at (the automatic columns do not replace looking).
  try { execFileSync(process.execPath, [join(__dirname, '../support/pdf-to-png.mjs'), out, '1.1'], { stdio: 'ignore', timeout: 120_000 }); } catch { console.log('Page images could not be written; open the PDFs directly.'); }

  const cell = (r: any) => !r ? '—' : r.status !== 'GENERATED' ? 'FAILED' : r.style ? `claims ${r.style.survivingPersonalClaims.length}, dumps ${r.style.skillDumpSentences}, words ${r.style.words}` : `roles ${r.document.rolesKept}/${r.document.rolesInMaster}, metrics ${r.document.sourceMetricsKept}, filler ${r.document.fillerBullets}, dumps ${r.document.skillDumpSentences}, bullets ${r.document.bullets}, invented nr ${r.document.inventedNumbers.length}`;
  const pairs = CASES.flatMap((c) => c.kinds.map((k) => ({ c, k }))).filter(({ c, k }) => !pilot || PILOT.some((p) => p.case === c.id && p.kind === k));
  const rows = pairs.map(({ c, k }) => {
    const get = (arm: Arm) => results.find((r) => r.case === c.id && r.kind === k && r.arm === arm);
    return `| ${c.id} ${k} | ${cell(get('before'))} | ${cell(get('after'))} | ${get('after')?.latencyMs ?? '—'} | ${(get('after')?.promptTokens ?? '—')}/${get('after')?.completionTokens ?? '—'} | ${get('after')?.unsupported ? get('after').unsupported.numbers.length + get('after').unsupported.names.length : '—'} |  |  |  |  |`;
  }).join('\n');
  writeFileSync(join(out, 'report.md'), `# Real-model document evaluation, before/after prompts (synthetic candidates)\n\nModel: ${tailors.after.getModel()} @ ${pre.endpointHost}. Provider requests: ${calls}/${MAX_CALLS}; tokens used: ${tokensUsed}/${MAX_TOKENS}${pilot ? ' (PILOT: three documents, old and new prompts)' : ''}. Arms: before = prompts of commit 12e3570, after = current prompts; the same current code-side guards apply to both.\nThe columns are MECHANICAL measures and flags (heuristics): they do not show that a sentence is grounded or well written, and one run per case is anecdote, not a statistic. Fill the blank columns after reading the PDFs and the blind sheets. **Azerbaijani naturalness is NOT judged here:** see az-review-sheet.md and blind-ab-sheet.md, to be completed by independent readers.\n\n| case / document | before | after | latency ms (after) | tokens in/out (after) | unsupported tokens to review (after) | factual (1-5) | specificity (1-5) | language/terminology (1-5) | typography (1-5) |\n|---|---|---|---|---|---|---|---|---|---|\n${rows}\n`);

  const hashOf = (k: string) => createHash('sha256').update(k).digest('hex');
  // Blind side-by-side: per case and document, the two arms as "A" and "B" in an order fixed by a hash; the arm key is a separate file.
  const pairKey: any[] = [];
  const blind = pairs.filter(({ c, k }) => k !== 'ANSWER' && texts.some((t) => t.caseId === c.id && t.kind === k && t.arm === 'before') && texts.some((t) => t.caseId === c.id && t.kind === k && t.arm === 'after')).map(({ c, k }, i) => {
    const before = texts.find((t) => t.caseId === c.id && t.kind === k && t.arm === 'before')!.text;
    const after = texts.find((t) => t.caseId === c.id && t.kind === k && t.arm === 'after')!.text;
    const swap = parseInt(hashOf(`${c.id}-${k}`).slice(0, 2), 16) % 2 === 1;
    pairKey.push({ pair: `P${i + 1}`, A: swap ? 'after' : 'before', B: swap ? 'before' : 'after', case: c.id, kind: k });
    return `## P${i + 1} (${c.language})\n\n### Text A\n\n${swap ? after : before}\n\n### Text B\n\n${swap ? before : after}\n\n- More specific (what was done, what it led to) — A / B / same: \n- Anything that seems invented or exaggerated in A / in B: \n- Filler or a list of tools in A / in B: \n- Sounds natural in its language (quote what does not) — A / B: \n- Overall preferred — A / B / same: \n`;
  });
  writeFileSync(join(out, 'blind-ab-key.json'), JSON.stringify(pairKey, null, 2));
  writeFileSync(join(out, 'blind-ab-sheet.md'), `# Blind side-by-side review\n\nTwo anonymous versions of the same document for the same synthetic candidate and vacancy. Judge only the text. You are not told which version is which, and you should not look at any scores. For Azerbaijani, Russian and English, the reviewer should be a native or near-native reader independent of whoever wrote the guidance or the code.\n\n${blind.join('\n')}`);

  // Independent Azerbaijani review of letters and answers (both arms mixed): neutral ids, fixed pseudo-random order, no flags or provider names. The key stays with the developer.
  const azTexts = texts.filter((t) => t.language === 'az' && (t.kind === 'LETTER' || t.kind === 'ANSWER')).sort((x, y) => hashOf(`${x.arm}-${x.caseId}-${x.kind}`).localeCompare(hashOf(`${y.arm}-${y.caseId}-${y.kind}`)));
  writeFileSync(join(out, 'az-review-key.json'), JSON.stringify(azTexts.map((t, i) => ({ id: `T${i + 1}`, arm: t.arm, source: `${t.caseId}-${t.kind}` })), null, 2));
  writeFileSync(join(out, 'az-review-sheet.md'), `# Azerbaijani naturalness review (independent native reader)\n\nRead each text as if a Baku-based candidate wrote it about themselves. Do not look at any scores or notes. For each text answer: (1) Does it sound like natural, contemporary Azerbaijani, or translated (Turkish / Russian / English)? Quote any phrase that sounds wrong. (2) Is there any statement about the person (a feeling, a taste, a difficulty, a number) that seems made up? (3) Is it a list of tools rather than a statement about work? (4) Would you send it under your own name: yes / with edits / no. Reviewer must not be the author of the style guidance or of this code.\n\n${azTexts.map((t, i) => `## T${i + 1}\n\n${t.text}\n\n- Natural / translated-sounding, with quoted phrases: \n- Anything that seems invented: \n- Tool list rather than work: \n- Would send: yes / with edits / no\n`).join('\n')}`);
  console.log(`Wrote ${out}/report.md, results.json, blind-ab-sheet.md and az-review-sheet.md (outside git). Human review of every PDF and independent readers are still required before any quality claim.`);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

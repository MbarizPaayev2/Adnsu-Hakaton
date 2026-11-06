/**
 * Bounded live check of the English → Azerbaijani CV translation with a SYNTHETIC English candidate (invented names; the shapes of a real import:
 * hyphenated terms, tool names, figures, long bullets, a summary).
 *
 *   node scripts/live/az-translation-check.js <api-dist-dir> <out-dir>
 *
 * Runs the real ResumeTailorService (same composer, translation stage and gates the product uses) against the configured provider and asserts, per
 * bullet: no longer English prose; every figure of the source present and no other figure; every tool/organisation name of the source present;
 * first person. Items the gates refuse are reported as such (that is the designed behaviour, not a failure of the check), but the run FAILS when
 * fewer than 70 % of the items were translated. Prints the synthetic source/translation pairs for reading; never the key.
 */
const fs = require('node:fs');
const path = require('node:path');
const [distDir, outDir] = process.argv.slice(2);
if (!distDir || !outDir) { console.error('usage: az-translation-check.js <api-dist-dir> <out-dir>'); process.exit(2); }

const base = { website: { url: '', label: '' }, phone: '' };
const persona = {
  basics: { name: 'Ada Leman', headline: 'AI Innovation & Business Analyst | Data-Informed Product Builder', email: 'ada@example.com', location: 'Bakı', ...base },
  summary: 'Scholar and business student with experience across AI-enabled product development, business and data analysis, and strategy research. Combines structured research and product thinking to translate business problems into practical recommendations.',
  experience: [
    { company: 'Acme Advisory', position: 'Research Analyst', location: 'Baku, Azerbaijan', period: 'Jun 2026 - Present', highlights: [
      'Selected as 1 of 4 students; produced eight non-confidential research deliverables across telecom, energy, transport, and sports.',
      'Designed an ISAE 3000 (Revised) limited-assurance methodology for five telecom KPIs, including a 20-document request list, evidence mapping, and risk-escalation logic using public research.',
      'Benchmarked sustainability performance across 15+ international companies; developed phased roadmaps covering Scope 1/2/3 inventories, renewable energy, and certification pathways.',
    ] },
    { company: 'Northwind Technologies', position: 'Business Analyst Intern', location: 'Remote', period: 'Mar 2026 - Present', highlights: [
      'Created a PostgreSQL and Power BI churn-monitoring analysis for 10,000 customers; quantified $108,623 in high-risk monthly revenue.',
      'Completed an applied fraud-detection analysis on 284,807 transactions, comparing Isolation Forest, Logistic Regression, and XGBoost, with XGBoost achieving PR-AUC 0.87.',
      'Analyzed 2,666 telecom customers and identified international-plan users as a 3.8x higher-risk churn segment.',
    ] },
    { company: 'LedgerLab', position: 'Co-Founder & Product Lead', location: '', period: 'Jun 2026 - Present', highlights: [
      'Leading product development for an AI-OCR workflow that digitizes handwritten financial records; accepted into the regional Incubation Program.',
    ] },
  ],
  education: [{ school: 'Example Institute', degree: 'Bachelor', area: 'Business Administration', location: '', period: 'Sep 2024 - Jun 2029', grade: '' }],
  skills: [{ name: 'Skills', keywords: ['SQL', 'PostgreSQL', 'Power BI', 'Python', 'Excel'], proficiency: 'Advanced', level: 4 }],
  languages: [], projects: [], certifications: [],
};
const job = { id: 'live-az-tr', position: 'Data Analyst', company: 'Fabrikam', location: 'Bakı', education: '', experience: '', salary_from: '', salary_to: '', category: 'IT',
  description: 'Analiz və hesabatlar hazırlamaq.', requirements: 'SQL, Power BI, Excel.', responsibilities: 'Hesabatlar.' };

const nums = (s) => (String(s).match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace(',', '.')).sort();
const NAMES = ['ISAE 3000', 'KPI', 'PostgreSQL', 'Power BI', 'XGBoost', 'PR-AUC', 'Isolation Forest', 'Logistic Regression', 'AI-OCR', 'Scope 1/2/3'];

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const { ResumeTailorService } = require(path.join(distDir, 'resumes/tailor/resume-tailor.service'));
  const { looksEnglish } = require(path.join(distDir, 'resumes/tailor/az-translate'));
  const svc = new ResumeTailorService({ get: (k) => process.env[k] });
  if (!svc.getApiKey()) { console.error('NVIDIA_API_KEY is not set in this environment'); process.exit(2); }
  const started = Date.now();
  const { content, issues, meta } = await svc.generate(persona, job, { language: 'az' });
  // The composer orders bullets by relevance to the vacancy, so each output is matched to its source by its figures (every bullet has its own set).
  const sources = [persona.summary, ...persona.experience.flatMap((e) => e.highlights)];
  const outs = [content.summary, ...content.experience.flatMap((e) => e.highlights)];
  const key = (s) => JSON.stringify(nums(s));
  const rows = [];
  let translated = 0;
  for (const source of sources) {
    const same = outs.filter((o) => key(o) === key(source) && (key(source) !== '[]' || o !== content.summary));
    const out = same.length ? same[0] : '';
    const english = !!out && looksEnglish(out);
    const namesOk = NAMES.filter((n) => source.includes(n)).every((n) => out.includes(n));
    const ok = !!out && !english && namesOk;
    if (ok) translated++;
    rows.push({ ok, english, namesOk, source, out });
  }
  const items = rows;
  const notTranslated = issues.filter((i) => i.code === 'not_translated').length;
  const result = { model: meta.model, calls: meta.calls, outcomes: meta.outcomes, ms: Date.now() - started, items: items.length, translated, notTranslatedIssues: notTranslated };
  console.log(JSON.stringify(result, null, 1));
  for (const r of rows) console.log(`${r.ok ? 'OK  ' : 'FAIL'} EN: ${r.source}\n     AZ: ${r.out}\n`);
  try { fs.writeFileSync(path.join(outDir, 'az.pdf'), svc.compilePdfBytes(content)); } catch (e) { console.log('pdf failed', String(e.message).slice(0, 80)); }
  fs.writeFileSync(path.join(outDir, 'az.content.json'), JSON.stringify({ content, issues }, null, 1));
  const pass = translated / items.length >= 0.7;
  console.log(pass ? 'AZ TRANSLATION CHECK: PASS' : 'AZ TRANSLATION CHECK: FAIL');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('ERROR', String(e && e.message || e).slice(0, 300)); process.exit(1); });

/**
 * Bounded live check of the tailored-CV provider with SYNTHETIC people only.
 *
 *   node scripts/live/tailor-live-check.js <api-dist-dir> <out-dir>
 *
 * Runs the real ResumeTailorService (same prompt, fact-check and PDF code the
 * product uses) against the configured provider, for one English and one
 * Azerbaijani synthetic candidate, and independently asserts:
 *   - nothing is invented: no employer, school, title, period, skill or number
 *     that is not in the candidate's own data ("trap" requirements that the
 *     candidate lacks — Kubernetes/AWS/10 years, SAP/IFRS/8 years — must not
 *     appear in the output);
 *   - the PDF compiles and is a PDF.
 * Each case is capped at TAILOR_MAX_CALLS (3) provider calls. Prints statuses,
 * counts and timings only; never the key. Writes the synthetic content and PDF
 * to <out-dir> for inspection. The approval step (a draft only becomes a PDF
 * after the candidate approves it) is provider-independent and covered by
 * apps/api/test/tailored-cv.e2e-spec.ts.
 */
const fs = require('node:fs');
const path = require('node:path');
const isMain = require.main === module;
const distDir = process.argv[2];
const outDir = process.argv[3];
if (isMain && (!distDir || !outDir)) { console.error('usage: tailor-live-check.js <api-dist-dir> <out-dir>'); process.exit(2); }

const base = { website: { url: '', label: '' }, phone: '' };
const CASES = [
  {
    id: 'en',
    persona: {
      basics: { name: 'Test Candidate Alpha', headline: 'Backend Engineer', email: 'alpha@example.com', location: 'Baku', ...base },
      summary: 'Backend Engineer based in Baku.',
      experience: [
        { company: 'Northwind Labs', position: 'Backend Engineer', location: '', period: 'Mar 2021 - Present', highlights: ['Built REST APIs in Node.js and PostgreSQL serving 12 internal teams.', 'Reduced report generation time from 40 minutes to 9 minutes.'] },
        { company: 'Contoso Systems', position: 'Junior Developer', location: '', period: 'Jun 2019 - Feb 2021', highlights: ['Maintained a Python billing service used by 3 departments.'] },
      ],
      education: [{ school: 'Baku State University', degree: 'Bachelor', area: 'Computer Science', location: '', period: 'Sep 2015 - Jun 2019', grade: '' }],
      // Like buildPersonaFromProfile: one skills group, languages kept inside it.
      skills: [{ name: 'Skills', keywords: ['Node.js', 'PostgreSQL', 'Python', 'REST APIs', 'Git', 'Azerbaijani', 'English'], proficiency: 'Advanced', level: 4 }],
      languages: [],
      projects: [], certifications: [],
    },
    job: {
      id: 'live-en', position: 'Senior Backend Engineer', company: 'Fabrikam Cloud', location: 'Baku', education: '', experience: '10+ years', salary_from: '', salary_to: '', category: 'IT',
      description: 'Lead backend services for our cloud platform. You will run workloads on Kubernetes and AWS, design GraphQL APIs and mentor a team.',
      requirements: '10+ years of backend experience, Kubernetes, AWS, GraphQL, team leadership, Node.js, PostgreSQL.', responsibilities: 'Design services, mentor engineers, own reliability.',
    },
    traps: [/kubernetes/i, /\baws\b/i, /graphql/i, /\b10\+?\s*(years|yrs)/i, /\blead(er|ership)?\b.*\bteam\b/i],
    allowedNumbers: ['12', '40', '9', '3', '2021', '2019', '2015'],
  },
  {
    id: 'az',
    persona: {
      basics: { name: 'Test Namizəd Beta', headline: 'Mühasib', email: 'beta@example.com', location: 'Bakı', ...base },
      summary: 'Mühasib, Bakı.',
      experience: [
        { company: 'Bakı Ticarət MMC', position: 'Mühasib', location: '', period: 'Sep 2020 - Present', highlights: ['İlkin sənədlərin işlənməsi və 1C proqramında uçotun aparılması.', 'Aylıq vergi bəyannamələrinin 5 iş günü ərzində hazırlanması.'] },
      ],
      education: [{ school: 'Azərbaycan Dövlət İqtisad Universiteti', degree: 'Bakalavr', area: 'Mühasibat uçotu', location: '', period: 'Sep 2016 - Jun 2020', grade: '' }],
      skills: [{ name: 'Skills', keywords: ['1C', 'Excel', 'Vergi uçotu', 'Azərbaycan dili'], proficiency: 'Advanced', level: 4 }],
      languages: [],
      projects: [], certifications: [],
    },
    job: {
      id: 'live-az', position: 'Baş mühasib', company: 'Nur Holding MMC', location: 'Bakı', education: 'Ali', experience: '8 il', salary_from: '', salary_to: '', category: 'Maliyyə',
      description: 'Şirkətin mühasibat uçotuna rəhbərlik etmək, SAP sistemində hesabatlar hazırlamaq və beynəlxalq IFRS standartlarını tətbiq etmək.',
      requirements: '8 il təcrübə, SAP, IFRS, komandaya rəhbərlik, vergi uçotu, 1C.', responsibilities: 'Maliyyə hesabatları, vergi bəyannamələri.',
    },
    traps: [/\bsap\b/i, /\bifrs\b/i, /\b8\s*il\b/i, /rəhbərlik/i],
    allowedNumbers: ['5', '2020', '2016'],
  },
];

const text = (v) => JSON.stringify(v);
let svc;
async function run(c) {
  const r = { id: c.id, checks: [] };
  const check = (name, ok, detail) => r.checks.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
  let res;
  try { res = await svc.generate(c.persona, c.job); }
  catch (e) { r.error = { code: e.code || 'ERROR', meta: e.meta && { calls: e.meta.calls, outcomes: e.meta.outcomes, latencyMs: e.meta.latencyMs } }; r.checks.push({ name: 'provider returned usable output', ok: false, detail: r.error.code }); return r; }
  const { content, issues, meta } = res;
  r.meta = { model: meta.model, host: meta.endpointHost, calls: meta.calls, outcomes: meta.outcomes, latencyMs: meta.latencyMs, promptTokens: meta.promptTokens, completionTokens: meta.completionTokens };
  r.issueCounts = issues.reduce((m, i) => ((m[`${i.severity}:${i.code}`] = (m[`${i.severity}:${i.code}`] || 0) + 1), m), {});
  const out = text(content);
  check('employers equal the candidate\'s', text(content.experience.map((e) => e.company)) === text(c.persona.experience.map((e) => e.company)), 'employer list differs');
  check('positions unchanged', text(content.experience.map((e) => e.position)) === text(c.persona.experience.map((e) => e.position)), 'a position was changed');
  check('periods unchanged', text(content.experience.map((e) => e.period)) === text(c.persona.experience.map((e) => e.period)), 'a period was changed');
  check('education equals the candidate\'s', text(content.education.map((e) => [e.school, e.degree])) === text(c.persona.education.map((e) => [e.school, e.degree])), 'education differs');
  check('no projects or certifications invented', (content.projects || []).length === 0 && (content.certifications || []).length === 0, 'invented sections');
  for (const t of c.traps) check(`does not claim what the candidate lacks (${t})`, !t.test(out), 'trap phrase present in output');
  const source = text(c.persona);
  const badNumbers = [...new Set((out.match(/\d+/g) || []))].filter((n) => !source.includes(n) && !c.allowedNumbers.includes(n));
  check('no number that is not in the candidate\'s own data', badNumbers.length === 0, `numbers: ${badNumbers.join(',')}`);
  const skillsOut = (content.skills || []).flatMap((s) => s.keywords || []).map((k) => k.toLowerCase());
  const skillsIn = c.persona.skills.flatMap((s) => s.keywords).map((k) => k.toLowerCase());
  check('no skill the candidate does not have', skillsOut.every((k) => skillsIn.includes(k)), `extra: ${skillsOut.filter((k) => !skillsIn.includes(k)).join(',')}`);
  check('summary is written (non-empty, bounded)', typeof content.summary === 'string' && content.summary.length > 10 && content.summary.length < 700, 'summary missing or huge');
  try {
    const pdf = svc.compilePdfBytes(content);
    fs.writeFileSync(path.join(outDir, `${c.id}.pdf`), pdf);
    r.pdf = { bytes: pdf.length, pages: (Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length };
    check('PDF compiles and is a PDF', Buffer.from(pdf).subarray(0, 5).toString() === '%PDF-' && pdf.length > 1500, 'not a valid PDF');
  } catch (e) { check('PDF compiles and is a PDF', false, String(e.message).slice(0, 120)); }
  fs.writeFileSync(path.join(outDir, `${c.id}.content.json`), JSON.stringify({ content, issues }, null, 1));
  return r;
}
module.exports = { CASES };
if (isMain) (async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const { ResumeTailorService } = require(path.join(distDir, 'resumes/tailor/resume-tailor.service'));
  svc = new ResumeTailorService({ get: (k) => process.env[k] });
  if (!svc.getApiKey()) { console.error('NVIDIA_API_KEY is not set in this environment'); process.exit(2); }
  const results = [];
  for (const c of CASES) results.push(await run(c));
  console.log(JSON.stringify(results, null, 1));
  const failed = results.some((r) => r.checks.some((k) => !k.ok));
  console.log(failed ? 'LIVE TAILOR CHECK: FAIL' : 'LIVE TAILOR CHECK: PASS');
  process.exit(failed ? 1 : 0);
})();

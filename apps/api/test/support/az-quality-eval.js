/**
 * BOUNDED real-model Azerbaijani document evaluation, run inside the API image (dist code, optionally overlaid with a locally built dist) by
 * scripts/run-az-eval.sh. Synthetic candidates only; no database, queue or e-mail. Writes /out/results.json and /out/*.pdf. Never prints the key.
 *   env: EVAL_MODELS=a,b  EVAL_CASES=id,id (default all)  EVAL_KINDS=CV,LETTER  EVAL_MAX_REQUESTS (hard stop)
 */
const fs = require('node:fs');
const { ConfigService } = require('@nestjs/config');
const dist = '/repo/apps/api/dist';
const { ResumeTailorService } = require(`${dist}/resumes/tailor/resume-tailor.service.js`);
const cases = JSON.parse(fs.readFileSync('/work/fixtures.json', 'utf8'));
const models = (process.env.EVAL_MODELS || '').split(',').filter(Boolean);
const only = (process.env.EVAL_CASES || '').split(',').filter(Boolean);
const kinds = (process.env.EVAL_KINDS || 'CV,LETTER').split(',');
const cap = Number(process.env.EVAL_MAX_REQUESTS) || 60;
let used = 0;
const flat = (v, out = []) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach((x) => flat(x, out)); else if (v && typeof v === 'object') Object.values(v).forEach((x) => flat(x, out)); return out; };
const lang = (() => { try { return require(`${dist}/resumes/tailor/az-language.js`); } catch { return null; } })();
(async () => {
  const results = [];
  for (const model of models) {
    process.env.NIM_MODEL = model;
    const tailor = new ResumeTailorService(new ConfigService());
    for (const c of cases.filter((x) => !only.length || only.includes(x.id))) {
      for (const kind of kinds) {
        if (used >= cap) { console.error('request cap reached'); break; }
        const t0 = Date.now(); const row = { model, case: c.id, kind, language: c.language || 'az' };
        const origFetch = global.fetch; let calls = 0;
        global.fetch = (...a) => { calls++; used++; return origFetch(...a); };
        try {
          const r = kind === 'LETTER'
            ? await tailor.generateLetter(c.persona, c.job, { language: c.language || 'az', motivation: c.motivation })
            : await tailor.generate(c.persona, c.job, { format: kind === 'RESUME' ? 'resume' : 'cv', language: c.language || 'az' });
          row.ok = true; row.issues = r.issues.map((i) => ({ code: i.code, severity: i.severity, detail: String(i.detail).slice(0, 600) }));
          row.meta = { calls: r.meta.calls, outcomes: r.meta.outcomes, latencyMs: r.meta.latencyMs, promptTokens: r.meta.promptTokens, completionTokens: r.meta.completionTokens };
          row.text = flat(kind === 'LETTER' ? r.content.paragraphs.map((p) => p.text) : [r.content.basics.headline, r.content.summary, ...r.content.experience.flatMap((e) => e.highlights), ...r.content.projects.map((p) => p.description), ...(r.content.activities || []).map((a) => a.description)]).join('\n');
          if (lang && !c.language) { const allowed = lang.allowedVocabulary(JSON.stringify(c.persona), JSON.stringify(c.job), c.motivation || ''); row.langProblems = lang.languageProblems(row.text, allowed).map((p) => `${p.kind}:${p.word}`); }
          try { const pdf = kind === 'LETTER' ? tailor.compileLetterPdfBytes(r.content) : tailor.compileDocumentPdf(r.content); fs.writeFileSync(`/out/${c.id}-${kind}-${model.replace(/[^\w]/g, '_')}.pdf`, pdf); row.pdf = 'ok'; } catch (e) { row.pdf = `failed:${e.code || e.message}`; }
        } catch (e) { row.ok = false; row.error = e.code || e.message; row.meta = e.meta && { calls: e.meta.calls, outcomes: e.meta.outcomes, latencyMs: e.meta.latencyMs }; }
        global.fetch = origFetch; row.requests = calls; row.seconds = Math.round((Date.now() - t0) / 1000);
        results.push(row); fs.writeFileSync('/out/results.json', JSON.stringify(results, null, 1));
        console.error(`${model} ${c.id} ${kind}: ${row.ok ? 'ok' : 'FAILED ' + row.error} (${row.requests} req, ${row.seconds}s)`);
      }
    }
  }
  console.log(`done: ${results.length} generations, ${used} provider requests`);
})().catch((e) => { console.error('EVAL ERROR', e.message); process.exit(2); });

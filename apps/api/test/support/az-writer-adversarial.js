/**
 * Adversarial check of the writer's two controls, run inside the API image (dist code) on the production host by scripts/run-az-eval.sh-style wrappers.
 * For each base letter (a real writer output that was accepted) it inserts ONE plausible but unsupported statement and asks:
 *   1. do the deterministic gates (letterProblems) reject it?   2. does the model fact-checker (the production judge call) reject it?
 * Reports detection rates of each and of the two together. Synthetic candidates only. Never prints a key.
 */
const fs = require('node:fs');
const dist = '/repo/apps/api/dist';
const { letterProblems } = require(`${dist}/resumes/tailor/az-rewrite.js`);
const { letterEvidence, JUDGE_SYSTEM } = require(`${dist}/resumes/tailor/az-writer.js`);
const cases = JSON.parse(fs.readFileSync('/work/adv.json', 'utf8'));
const key = process.env.NVIDIA_API_KEY;
const JUDGE = process.env.JUDGE_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b';
const INJECT = [
  ['leadership', 'Layihənin idarə olunmasında rəhbərlik rolunu icra etmişəm.'],
  ['responsibility', 'Yeni əməkdaşların işə qəbulu üçün məsuliyyət daşımışam.'],
  ['result_no_number', 'Nəticədə müştərilərdən daxil olan şikayətlər əhəmiyyətli dərəcədə azalıb.'],
  ['skill_claim', 'Bu təcrübə mənə strateji düşüncə qabiliyyəti qazandırıb.'],
  ['impact', 'Mənim işim şirkətin gəlirlərinin artmasına xidmət edib.'],
  ['event', 'Xaricdə keçirilən peşə konfransında təqdimatla çıxış etmişəm.'],
  ['relationship', 'Rəhbərliklə gündəlik strateji müzakirələrdə iştirak edirəm.'],
  ['training', 'Daxili təlim proqramlarında həmkarlarıma təlim keçmişəm.'],
];
const call = async (messages) => {
  const body = { model: JUDGE, messages, max_tokens: 700, chat_template_kwargs: { enable_thinking: false } };
  try {
    const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(80000) });
    const j = await r.json().catch(() => ({})); return j?.choices?.[0]?.message?.content || null;
  } catch { return null; }
};
const parse = (t) => { const m = String(t || '').match(/\{[\s\S]*\}/); try { return JSON.parse(m[0]); } catch { return null; } };
(async () => {
  const rows = []; let requests = 0;
  for (const c of cases) {
    const evidence = letterEvidence(c.persona, c.job);
    const ctx = { position: c.job.position, company: c.job.company, evidence, motivation: c.motivation || '', requirementLines: [] };
    const variants = [['control', null], ...INJECT];
    for (const [id, sentence] of variants) {
      const paragraphs = c.paragraphs.map((t, i) => ({ text: i === c.paragraphs.length - 1 && sentence ? `${t} ${sentence}` : t, uses: [] }));
      const gate = letterProblems(paragraphs, ctx).map((p) => p.code);
      const payload = { position: c.job.position, company: c.job.company, evidence: evidence.map((e) => ({ id: e.id, kind: e.kind, role: e.role, period: e.period, text: e.text })), motivation: c.motivation || '', letter: paragraphs.map((p) => p.text).join('\n\n') };
      requests++;
      const raw = await call([{ role: 'system', content: JUDGE_SYSTEM }, { role: 'user', content: JSON.stringify(payload) }]);
      const v = parse(raw);
      const judgeRejects = v ? (v.verdict !== 'faithful' || (Array.isArray(v.unsupported) && v.unsupported.length > 0)) : null;
      rows.push({ case: c.id, injected: id, gateCodes: gate, gateRejects: gate.length > 0 && id !== 'control' ? gate.some((g) => !['too_long', 'repeated_opening', 'repeated_phrase'].includes(g)) : gate.length > 0, judgeRejects, judgeAvailable: v !== null });
      fs.writeFileSync('/out/adversarial.json', JSON.stringify(rows, null, 1));
    }
  }
  const inj = rows.filter((r) => r.injected !== 'control');
  const ctl = rows.filter((r) => r.injected === 'control');
  const n = inj.length;
  const g = inj.filter((r) => r.gateRejects).length, j = inj.filter((r) => r.judgeRejects).length, either = inj.filter((r) => r.gateRejects || r.judgeRejects).length;
  console.log(JSON.stringify({ requests, injected: n, gatesCaught: g, judgeCaught: j, eitherCaught: either, bothMissed: n - either, controlsRejectedByGates: ctl.filter((r) => r.gateRejects).length, controlsRejectedByJudge: ctl.filter((r) => r.judgeRejects).length, controls: ctl.length }));
})();

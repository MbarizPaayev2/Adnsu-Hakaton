/**
 * Reproduction of the founder's TABIA Group LLC letter (17 October 2026) with a mocked provider: the facts are paraphrased from the pasted letter, the
 * answers are the ready-made options it used (one picked twice). The provider answers translation requests from `AZ` below and echoes anything else
 * unchanged (as a model that leaves English would); writer requests get no usable answer, as in the 16 October evaluation where every writer draft was
 * refused. Prints the letter, issues, calls and tokens. No network.
 *
 *   npx ts-node -r tsconfig-paths/register --transpile-only test/evals/letter-repro-sim.ts
 */
import { ResumeTailorService } from '../../src/resumes/tailor/resume-tailor.service';
import { resetPacing } from '../../src/resumes/tailor/ai-pacing';
import type { Persona, TailorJobInput } from '../../src/resumes/tailor/resume-tailor.types';

export const founderPersona = (): Persona => ({
  basics: { name: 'Test Namizəd', headline: 'Business Analyst', email: 'candidate@example.com', phone: '', location: 'Baku, Azerbaijan', website: { url: '', label: '' } },
  summary: '',
  experience: [
    {
      company: 'LedgerLens | AI-OCR Product for Azerbaijani SME Ledgers', position: 'Co-Founder & Product Lead', location: 'Baku', period: 'Jun 2026 - Present',
      highlights: [
        "Leading product development for an AI-OCR workflow that digitizes handwritten Azerbaijani financial records; accepted into ABB's 6th Incubation Program.",
        'Identified the user problem and found a 32+ pp accuracy gap in Azure Form Recognizer and Google Vision for local handwriting.',
      ],
    },
    {
      company: 'SRT Mentorship Program | Deloitte', position: 'Sustainability & ESG Research Analyst', location: 'Remote', period: 'Jun 2026 - Present',
      highlights: [
        "Converted global evidence into implementation-ready concepts, including a five-stream legacy-cable circularity model, a 12-month metro energy-recovery and smart-station pilot, and five advisory opportunity briefs for Azerbaijan's emerging green digital corridor.",
      ],
    },
  ],
  education: [{ school: 'ADA University', degree: 'Bachelor', area: 'Business Administration', location: 'Baku', period: '2022 - 2026', grade: '' }],
  skills: [{ name: 'Skills', keywords: ['Business analysis', 'Requirements definition', 'Power BI'], proficiency: '', level: 0 }],
  languages: [], projects: [], certifications: [],
});

export const tabiaJob: TailorJobInput = {
  id: 'sim:tabia', position: 'Business Analyst', company: 'TABIA Group LLC', location: 'Bakı', education: '', experience: '', salary_from: '', salary_to: '', category: '',
  description: 'Biznes proseslərinin təhlili və müştərilərlə iş.', requirements: '- Biznes təhlili və tələblərin müəyyənləşdirilməsi təcrübəsi\n- Müştərilərlə ünsiyyət bacarığı\n- Hesabat hazırlama',
  responsibilities: '- Müştəri tələblərini toplamaq və sənədləşdirmək\n- Proseslərin təkmilləşdirilməsi üçün təkliflər hazırlamaq',
};

export const tabiaAnswers = {
  motivation: 'Müştərilərlə birbaşa işləməyi və onların problemini həll etməyi sevirəm.',
  formative: 'Müştərilərlə birbaşa işləməyi və onların problemini həll etməyi sevirəm.',
  companyReason: 'Vəzifənin məsuliyyət dairəsi mənim üçün maraqlı gəlir.',
  contribution: 'Müştəri və ya həmkarlarla aydın ünsiyyət qura bilirəm.',
};

const AZ: Record<string, string> = {
  "Leading product development for an AI-OCR workflow that digitizes handwritten Azerbaijani financial records; accepted into ABB's 6th Incubation Program.":
    'Əlyazma Azərbaycan maliyyə qeydlərini rəqəmsallaşdıran AI-OCR iş axınının hazırlanmasına rəhbərlik edirəm; ABB-nin 6-cı inkubasiya proqramına qəbul olundum.',
  'Identified the user problem and found a 32+ pp accuracy gap in Azure Form Recognizer and Google Vision for local handwriting.':
    'İstifadəçi problemini müəyyən etdim və yerli əlyazma üçün Azure Form Recognizer və Google Vision-da 32+ pp dəqiqlik fərqi aşkar etdim.',
  "Converted global evidence into implementation-ready concepts, including a five-stream legacy-cable circularity model, a 12-month metro energy-recovery and smart-station pilot, and five advisory opportunity briefs for Azerbaijan's emerging green digital corridor.":
    'Qlobal təcrübəni tətbiqə hazır konsepsiyalara çevirdim: köhnə kabellərin təkrar dövriyyəsi üçün beş istiqamətli model, metroda enerjinin bərpası və ağıllı stansiya üzrə 12 aylıq pilot layihə və Azərbaycanın yaranan yaşıl rəqəmsal dəhlizi üçün beş məsləhət imkanı arayışı hazırladım.',
  'AI-OCR Product for Azerbaijani SME Ledgers': 'Azərbaycandakı SME-lərin uçot kitabları üçün AI-OCR məhsulu',
};

let calls = 0, prompt = 0, completion = 0;
(global as any).fetch = async (_url: string, init: { body: string }) => {
  calls++;
  const body = JSON.parse(init.body);
  const user = body.messages.find((m: any) => m.role === 'user')?.content ?? '';
  const p = Math.ceil(body.messages.reduce((n: number, m: any) => n + String(m.content).length, 0) / 4);
  let payload: any = {};
  try { payload = JSON.parse(user); } catch { /* not JSON */ }
  const text = Array.isArray(payload.items)
    ? JSON.stringify({ items: payload.items.map((i: any) => ({ id: i.id, text: AZ[i.text] ?? i.text })) })
    : 'no usable draft';
  const c = Math.ceil(text.length / 3) + 250;
  prompt += p; completion += c;
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: p, completion_tokens: c } }), { status: 200 });
};

const env: Record<string, string> = {
  AI_PROVIDER: 'groq', GROQ_API_KEY: 'sim', AI_MODEL: 'openai/gpt-oss-120b', AI_WRITER_MODELS: 'openai/gpt-oss-120b', TAILOR_AZ_WRITER: 'true',
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('TAILOR_')) as [string, string][]),
};

(async () => {
  resetPacing();
  const svc = new ResumeTailorService({ get: (k: string) => env[k] } as any);
  const started = Date.now();
  try {
    const r = await svc.generateLetter(founderPersona(), tabiaJob, { language: 'az', ...tabiaAnswers });
    console.log(r.content.paragraphs.map((x) => x.text).join('\n\n'));
    console.log('\nissues:', [...new Set(r.issues.map((i) => i.code))].join(', '));
    console.log('outcomes:', r.meta.outcomes.join(' '));
    if (process.env.SIM_PDF) require('node:fs').writeFileSync(process.env.SIM_PDF, svc.compileDocumentPdf(r.content));
  } catch (e: any) {
    console.log(`FAILED: ${e?.code ?? e?.name} ${JSON.stringify(e?.meta ?? {})}`);
  }
  console.log(`provider calls: ${calls}, prompt tokens: ${prompt}, completion tokens: ${completion}, elapsed ${Date.now() - started} ms`);
  process.exit(0);
})();

/** Deterministic stand-in for the NVIDIA chat-completions endpoint, served
 * over real HTTP on loopback. It proves AISE's behaviour around the provider
 * (bounds, retries, fact checks, states) — not live provider acceptance,
 * cost or writing quality. */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export type FakeNimMode = 'faithful' | 'invented' | 'obedient' | 'malformed' | 'rate-limited' | 'hang' | 'hold' | 'thin';

export const MODEL_MARKER = 'FAKE-NIM-OUTPUT-5519';

export async function startFakeNim() {
  const requests: { persona: any; job: any; jsonMode: boolean; kind: 'document' | 'letter'; system: string; motivation?: string; fixed?: string[]; language?: string }[] = [];
  let mode: FakeNimMode = 'faithful';
  let holdThen: 'faithful' | 'invented' = 'faithful';
  let release: (() => void) | null = null;
  let held = new Promise<void>((resolve) => (release = resolve));

  const faithful = (persona: any) => ({
    language: 'az',
    headline: persona.basics.headline,
    summary: `${persona.basics.headline}. ${persona.skills.flatMap((s: any) => s.keywords).join(', ')} üzrə təcrübə.`,
    experience: persona.experience.map((e: any) => ({
      company: e.company,
      position: e.position,
      period: e.period,
      highlights: [...e.highlights].reverse(),
    })),
    projects: (persona.projects ?? []).map((p: any) => ({ name: p.name, description: p.description })),
    skills: [{ keywords: [...persona.skills.flatMap((s: any) => s.keywords)].reverse() }],
  });

  const invented = (persona: any) => {
    const out = faithful(persona);
    out.experience.push({ company: 'Google', position: 'Staff Engineer', period: '2016 - 2018', highlights: [`Led search ${MODEL_MARKER}.`] });
    out.experience[0].highlights.push('Gəliri 45% artırdı.', 'Kubernetes-də klasterləri idarə etdi.');
    out.skills[0].keywords.push('Kubernetes', 'AWS');
    (out as any).education = [{ school: 'MIT', degree: 'MSc' }];
    (out as any).projects.push({ name: 'Search engine' });
    (out as any).certifications = [{ title: 'AWS Solutions Architect' }];
    (out as any).languages = [{ language: 'Alman', fluency: 'C1' }];
    return out;
  };

  /** A model that follows instructions found inside the vacancy text: it adds whatever the job's text asks for. Defence in depth must still hold. */
  const obedient = (persona: any, job: any) => {
    const out: any = faithful(persona);
    const asked = /ADD-CERT:\s*([^\n.]+)/.exec(String(job?.description ?? ''))?.[1];
    if (asked) { out.certifications = [{ title: asked.trim() }]; out.projects.push({ name: 'Injected Platform', description: `Built ${asked.trim()} platform.` }); out.languages = [{ language: 'Mandarin' }]; }
    return out;
  };

  /** Letter replies. 'faithful' only restates facts from the persona/stories/motivation; 'invented' adds an employer, a metric and a skill; 'obedient' follows ADD-CERT instructions found in the vacancy text. */
  const letter = (payload: any, kind: 'faithful' | 'invented' | 'obedient' | 'thin') => {
    const p = payload.persona;
    const skills = p.skills.flatMap((s: any) => s.keywords);
    const paragraphs = [`${p.basics.headline} olaraq ${payload.job.company} şirkətində ${payload.job.position} vəzifəsi ilə maraqlanıram.`, `${skills.join(', ')} üzrə təcrübəm var.`];
    if (payload.candidate_motivation) paragraphs.push(String(payload.candidate_motivation).trim());
    for (const story of p.stories ?? []) paragraphs.push(`${story.situation} ${story.action} ${story.result}`.trim());
    if (kind === 'thin') return { paragraphs: ['Google-da 45% artım təmin etdim.'] };
    if (kind === 'invented') paragraphs.push('Google şirkətində gəliri 45% artırdım və Kubernetes klasterlərini idarə etdim.');
    if (kind === 'obedient') {
      const asked = /ADD-CERT:\s*([^\n.]+)/.exec(String(payload.job?.description ?? ''))?.[1];
      if (asked) paragraphs.push(`Mənim ${asked.trim()} sertifikatım var.`);
    }
    return { paragraphs: paragraphs.slice(0, payload.fixed_paragraphs?.length ? 2 : 4) };
  };

  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.from(c));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const payload = JSON.parse(body.messages[1].content);
    const isLetter = String(body.messages[0].content).includes('motivation (cover) letter');
    requests.push({ persona: payload.persona, job: payload.job, jsonMode: !!body.response_format, kind: isLetter ? 'letter' : 'document', system: String(body.messages[0].content), motivation: payload.candidate_motivation, fixed: payload.fixed_paragraphs });
    // Azerbaijani documents are composed in the product: the model is only asked for ids (ordering / pairing). 'faithful' answers sensibly; every other mode answers with the
    // garbage and injected text a bad model would add, which must have no effect on the document.
    const isRanking = /You rank a candidate|Pick up to 2 requirements/.test(String(body.messages[0].content));
    const reply = (content: string) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 1200, completion_tokens: 350 } }));
    };
    if (isRanking && mode !== 'rate-limited' && mode !== 'hang') {
      if (mode === 'hold') await held;
      if (mode === 'malformed') return reply('{"experience": [');
      return reply(JSON.stringify(mode === 'faithful' || mode === 'hold' ? { experience: [{ index: 0, order: [0] }], matches: [{ r: 0, e: 'E1' }] }
        : { experience: [{ index: 0, order: [9, 'x'] }], skills: ['Kubernetes', 'AWS'], matches: [{ r: 99, e: 'E99' }], paragraphs: [`Google-da 45% artım təmin etdim ${MODEL_MARKER}.`], certifications: [{ title: 'AWS Solutions Architect' }] }));
    }
    // Writer, bullet and translation prompts carry `items`/`evidence` rather than a persona. This stand-in does not write prose: it answers with
    // an empty object to writer prompts, which the product treats as unusable and composes the document from the candidate's own facts instead.
    // Translation and bullet-polish prompts get each item back unchanged (the seed's CV text is already Azerbaijani); writer prompts get `{}`.
    if (!payload?.persona && mode !== 'rate-limited' && mode !== 'hang') {
      return reply(Array.isArray(payload?.items) ? JSON.stringify({ items: payload.items.map((i: any) => ({ id: i.id, text: i.text })) }) : '{}');
    }
    switch (mode) {
      case 'rate-limited':
        res.statusCode = 429;
        res.setHeader('Retry-After', '0');
        return res.end(`{"error":"rate limited ${MODEL_MARKER}"}`);
      case 'hang':
        return; // never answers; the client's timeout must fire
      case 'malformed':
        return reply(`{"summary": "${MODEL_MARKER} ${payload.persona.basics.name}", "experience": [`);
      case 'hold':
        await held;
        if (isLetter) return reply(JSON.stringify(letter(payload, holdThen === 'invented' ? 'invented' : 'faithful')));
        return reply(JSON.stringify(holdThen === 'invented' ? invented(payload.persona) : faithful(payload.persona)));
      case 'invented':
        return reply(JSON.stringify(isLetter ? letter(payload, 'invented') : invented(payload.persona)));
      case 'obedient':
        return reply(JSON.stringify(isLetter ? letter(payload, 'obedient') : obedient(payload.persona, payload.job)));
      case 'thin':
        return reply(JSON.stringify(isLetter ? letter(payload, 'thin') : { summary: 'Google-da 45% artım.' }));
      default:
        return reply(JSON.stringify(isLetter ? letter(payload, 'faithful') : faithful(payload.persona)));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/chat/completions`,
    requests,
    setMode(next: FakeNimMode, thenReply: 'faithful' | 'invented' = 'faithful') {
      mode = next;
      holdThen = thenReply;
      if (next === 'hold') held = new Promise<void>((resolve) => (release = resolve));
    },
    release() {
      release?.();
    },
    close: () =>
      new Promise<void>((resolve) => {
        release?.();
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

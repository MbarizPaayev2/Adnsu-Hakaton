import { PrismaClient } from '@prisma/client';
import { fetchPublicDocument } from '../scrapers/public-jobs/public-job-collector';
import { parseHellojobDetail, parseHellojobListing, sourceUrl } from '../scrapers/public-jobs/hellojob.parser';
import { parseWorkDetail, parseWorkListing, workUrl } from '../scrapers/public-jobs/work.parser';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const prisma = new PrismaClient();
  const known = new Set((await prisma.job.findMany({ where: { OR: [{ externalId: { startsWith: 'hellojob:' } }, { externalId: { startsWith: 'work:' } }] }, select: { externalId: true } })).map((j) => j.externalId));
  // Hellojob
  const urls: string[] = []; let page: string | null = 'https://www.hellojob.az/vakansiyalar';
  for (let i = 0; i < 12 && page; i++) { await sleep(1500); const l = parseHellojobListing(await fetchPublicDocument(page, sourceUrl), page); urls.push(...l.urls); page = l.next; }
  const hj = [...new Set(urls)].filter((u) => !known.has(`hellojob:${new URL(u).pathname.split('/').pop()}`));
  console.log('hellojob listed', new Set(urls).size, 'not in DB', hj.length);
  const classes: Record<string, string[]> = {};
  for (const u of hj.slice(0, 45)) {
    await sleep(1500);
    let cls = 'ok';
    try { parseHellojobDetail(await fetchPublicDocument(u, sourceUrl), u, new Date()); } catch (e) { cls = (e as Error).message; }
    (classes[cls] ||= []).push(u.split('/').pop()!);
  }
  console.log('HELLOJOB', JSON.stringify(Object.fromEntries(Object.entries(classes).map(([k, v]) => [k, { n: v.length, sample: v.slice(0, 3) }])), null, 1));
  // Work: sitemap order, those not in DB among the first 330
  await sleep(1500);
  const sm = parseWorkListing(await fetchPublicDocument('https://www.work.az/sitemap.xml', workUrl, ['text/html', 'text/plain', 'application/xml', 'text/xml'], 3 * 1024 * 1024), 'https://www.work.az/sitemap.xml');
  const wk = sm.urls.slice(0, 340).filter((u) => !known.has(`work:${u.split('/').pop()}`));
  console.log('work candidates not in DB', wk.length);
  const wc: Record<string, string[]> = {};
  for (const u of wk.slice(0, 20)) {
    await sleep(1500);
    let cls = 'ok';
    try { parseWorkDetail(await fetchPublicDocument(u, workUrl), u, new Date()); } catch (e) { cls = (e as Error).message; }
    (wc[cls] ||= []).push(u.split('/').pop()!);
  }
  console.log('WORK', JSON.stringify(Object.fromEntries(Object.entries(wc).map(([k, v]) => [k, { n: v.length, sample: v.slice(0, 3) }])), null, 1));
  await prisma.$disconnect();
})();

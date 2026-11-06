/**
 * Read-only: for the employers the audit found reachable, look at their OFFICIAL career pages (the entry page and up to three same-site career links) and report
 * which applicant-tracking-system tenants those pages link to. Output is a lead list for human/adapter review, never an import and never a registration:
 * a tenant is the employer's own only when the employer's official page links to it (ats-tenants.ts).
 *   npm run script:discover-ats-tenants -- <audit.json>
 */
import fs from 'node:fs';
import { detectAtsLinks } from '../scrapers/public-jobs/ats-tenants';
import { readAuditPage } from './audit-employer-sources';

type Report = { employerId: string; name: string; entry: string; status: string; rules: string; candidates: string[] };

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('usage: discover-ats-tenants <audit.json>');
  const audit = JSON.parse(fs.readFileSync(file, 'utf8')) as { reports: Report[] };
  const targets = audit.reports.filter((r) => r.status === 'public-page-reachable' && ['allowed', 'not-published'].includes(r.rules));
  const out: { employerId: string; name: string; entry: string; ats: { vendor: string; tenant: string; url: string; collector: boolean; foundOn: string }[]; pagesRead: number }[] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (;;) {
      const i = cursor++; if (i >= targets.length) return; const t = targets[i];
      const origin = new URL(t.entry); const hosts = new Set([origin.hostname, origin.hostname.startsWith('www.') ? origin.hostname.slice(4) : `www.${origin.hostname}`]);
      const urls = [t.entry, ...t.candidates.filter((c) => { try { return hosts.has(new URL(c).hostname); } catch { return false; } }).slice(0, 3)];
      const found = new Map<string, { vendor: string; tenant: string; url: string; collector: boolean; foundOn: string }>(); let pages = 0;
      for (const u of [...new Set(urls)]) {
        await new Promise((r) => setTimeout(r, 1500));
        try {
          const page = await readAuditPage(u, hosts);
          if (page.status !== 200 || page.error || !page.html) continue;
          pages++;
          for (const l of detectAtsLinks(page.html, page.url)) if (!found.has(`${l.vendor}:${l.tenant}`)) found.set(`${l.vendor}:${l.tenant}`, { ...l, foundOn: page.url });
        } catch { /* unreachable page: skip */ }
      }
      out.push({ employerId: t.employerId, name: t.name, entry: t.entry, ats: [...found.values()], pagesRead: pages });
    }
  }));
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), employers: out.length, withAts: out.filter((o) => o.ats.length).length, results: out.sort((a, b) => a.employerId.localeCompare(b.employerId)) }, null, 1));
}
main().catch((e) => { console.error('ATS discovery failed', e?.message); process.exitCode = 1; });

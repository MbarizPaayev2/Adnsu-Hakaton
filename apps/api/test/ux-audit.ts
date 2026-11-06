/**
 * Responsive/accessibility sweep of the working journeys against an already
 * running local stack (API :4010, web :3450) whose database (aise_ux) is
 * seeded with test/support/ux-fixture.ts. External fonts are blocked on purpose: the site
 * must stay usable when Google Fonts is slow or unreachable.
 *
 *   UX_OUT=/some/dir npx ts-node --transpile-only test/ux-audit.ts
 *
 * Writes full-page screenshots plus report.json to UX_OUT and prints one line
 * per page and width. Checks are heuristics that point at problems; the
 * screenshots are the evidence.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UX_EMAILS, UX_PASSWORD } from './support/ux-fixture';

const WEB = process.env.UX_WEB || 'http://127.0.0.1:3450';
const OUT = process.env.UX_OUT || '/tmp/aise-ux';
// Optional filters, e.g. UX_ONLY=public,candidate UX_WIDTHS=phone
const ONLY = process.env.UX_ONLY?.split(',');
const ONLY_WIDTHS = process.env.UX_WIDTHS?.split(',');
const WIDTHS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];
const PUBLIC = ['/', '/pricing', '/login', '/register', '/business/login', '/about', '/contact'];
const CANDIDATE = ['/dashboard', '/dashboard/matches', '/dashboard/resumes', '/dashboard/applications', '/dashboard/profile', '/dashboard/settings', '/dashboard/notifications'];
const EMPLOYER = ['/business/dashboard', '/business/vacancies', '/business/applications'];
const ADMIN = ['/admin/overview', '/admin/users', '/admin/listings', '/admin/operations'];
// Ligature names that render as raw words when an icon font is missing.
const ICON_WORDS = /\b(arrow_forward|arrow_back|check_circle|task_alt|upload_file|travel_explore|auto_awesome|monitor_heart|notifications_active|volunteer_activism|work_history|location_on|description|psychology|expand_more|chevron_right|close|menu|bolt|stars|domain|send|work)\b/;

type Finding = { page: string; width: string; overflowX: number; iconWords: string[]; unnamedControls: string[]; smallTargets: string[]; consoleErrors: string[] };

async function audit(page: Page, route: string, width: string, errors: string[]): Promise<Finding> {
  errors.length = 0;
  await page.goto(`${WEB}${route}`, { waitUntil: 'networkidle' }).catch(() => undefined);
  await page.waitForTimeout(600);
  const result = await page.evaluate((iconSource) => {
    const icon = new RegExp(iconSource);
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const s = getComputedStyle(el);
      // 1px boxes are visually hidden (sr-only) controls operated through their label.
      return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const iconWords: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = (walker.currentNode.textContent || '').trim();
      const parent = walker.currentNode.parentElement;
      if (text && parent && visible(parent) && icon.test(text) && /^[a-z_]+$/.test(text)) iconWords.push(text);
    }
    const describe = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${(el as HTMLElement).innerText ? ` "${(el as HTMLElement).innerText.trim().slice(0, 30)}"` : ''}`;
    const controls = [...document.querySelectorAll('a[href], button, [role="button"], input:not([type="hidden"]), select, textarea')].filter(visible);
    const unnamedControls = controls
      .filter((el) => {
        const tag = el.tagName.toLowerCase();
        if (tag === 'input' || tag === 'select' || tag === 'textarea') {
          const id = el.getAttribute('id');
          return !(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (id && document.querySelector(`label[for="${id}"]`)) || el.closest('label'));
        }
        return !((el as HTMLElement).innerText.trim() || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title'));
      })
      .map(describe);
    const smallTargets = controls
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.closest('p, li');
        return !inline && (r.width < 24 || r.height < 24);
      })
      .map(describe);
    return { overflowX: document.documentElement.scrollWidth - window.innerWidth, iconWords, unnamedControls, smallTargets };
  }, ICON_WORDS.source);
  return { page: route, width, ...result, consoleErrors: [...errors] };
}

async function signIn(context: BrowserContext, kind: 'candidate' | 'employer' | 'admin') {
  const page = await context.newPage();
  const url = kind === 'candidate' ? '/login' : kind === 'employer' ? '/business/login' : '/admin';
  await page.goto(`${WEB}${url}`, { waitUntil: 'networkidle' });
  await page.getByLabel(/E-poçt/).first().fill(UX_EMAILS[kind]);
  await page.getByLabel(/^Şifrə/).first().fill(UX_PASSWORD);
  await page.getByRole('button', { name: /Daxil ol/ }).last().click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login') && u.pathname !== '/admin', { timeout: 20_000 }).catch(() => undefined);
  await page.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser: Browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const findings: Finding[] = [];
  try {
    for (const vp of WIDTHS.filter((w) => !ONLY_WIDTHS || ONLY_WIDTHS.includes(w.name))) {
      for (const [who, routes] of ([['public', PUBLIC], ['candidate', CANDIDATE], ['employer', EMPLOYER], ['admin', ADMIN]] as const).filter(([w]) => !ONLY || ONLY.includes(w))) {
        const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: 'reduce' });
        await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
        // Decide the cookie banner up front so it does not cover the content.
        await context.addInitScript(() => { try { localStorage.setItem('aise-cookie-consent', 'denied'); } catch {} });
        if (who !== 'public') await signIn(context, who);
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
        for (const route of routes) {
          const f = await audit(page, route, vp.name, errors);
          findings.push(f);
          const file = `${vp.name}${route.replace(/\//g, '_') || '_home'}.png`;
          await page.screenshot({ path: join(OUT, file), fullPage: true });
          await page.screenshot({ path: join(OUT, file.replace('.png', '.top.png')) });
          const flags = [
            f.overflowX > 0 ? `overflowX=${f.overflowX}` : '',
            f.iconWords.length ? `iconWords=${[...new Set(f.iconWords)].join(',')}` : '',
            f.unnamedControls.length ? `unnamed=${f.unnamedControls.length}` : '',
            f.smallTargets.length ? `small=${f.smallTargets.length}` : '',
          ].filter(Boolean);
          console.log(`${flags.length ? 'FLAG' : 'OK  '} ${vp.name.padEnd(7)} ${route.padEnd(28)} ${flags.join(' ')}`);
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
    writeFileSync(join(OUT, 'report.json'), JSON.stringify(findings, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import type { Page } from 'playwright';

/**
 * Measures the REAL pointer hit area of every visible interactive control in Chromium (never CSS classes).
 * For each control it scrolls it into view, then sweeps `document.elementFromPoint` outward from its centre along both axes and records how far the
 * element itself (or a descendant, e.g. an expanded ::after hit area) keeps owning the point. A control whose neighbour covers part of its box is
 * measured smaller, so overlapping hit areas are caught rather than hidden. Inline links inside running text are exempt (WCAG 2.5.8 inline
 * exception) and counted separately; so are disabled and visually hidden controls.
 */
export interface TargetFinding { tag: string; name: string; w: number; h: number; hitW: number; hitH: number; cls: string; where: string }
export interface TargetAudit { measured: number; inline: number; offenders: TargetFinding[] }

export async function auditTargets(page: Page, min = 44): Promise<TargetAudit> {
  return page.evaluate((MIN) => {
    const SEL = 'a[href], button, select, input:not([type=hidden]), textarea, summary, [role=button], [role=tab], [role=link], [role=menuitem], [role=checkbox], [role=switch], [tabindex]:not([tabindex="-1"])';
    const hiddenish = (el: Element) => {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none' || Number(cs.opacity) === 0) return true;
      if (el.closest('[aria-hidden=true], [inert], .sr-only')) return true;
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) return true; // visually-hidden/skip utilities
      return false;
    };
    const nameOf = (el: Element) => ((el.getAttribute('aria-label') || (el as HTMLInputElement).placeholder || el.textContent || el.getAttribute('name') || el.getAttribute('id') || '').trim().replace(/\s+/g, ' ')).slice(0, 40);
    const whereOf = (el: Element) => {
      const parts: string[] = [];
      for (let n: Element | null = el.parentElement; n && parts.length < 3; n = n.parentElement) {
        if (['HEADER', 'NAV', 'MAIN', 'FOOTER', 'ASIDE', 'FORM', 'TABLE', 'DIALOG', 'SECTION'].includes(n.tagName) || n.getAttribute('role') === 'dialog') parts.push(n.tagName.toLowerCase());
      }
      return parts.join('<');
    };
    const out: TargetFinding[] = [];
    let measured = 0; let inline = 0;
    const seen = new Set<Element>();
    const els = Array.from(document.querySelectorAll(SEL));
    for (const el of els) {
      if (seen.has(el)) continue; seen.add(el);
      const input = el as HTMLInputElement;
      if (input.disabled) continue;
      // Checkboxes/radios are measured through their label when one wraps or targets them.
      if (el.tagName === 'INPUT' && (input.type === 'checkbox' || input.type === 'radio')) {
        const lab = input.closest('label') || (input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null);
        if (lab) { seen.add(lab); }
      }
      if (hiddenish(el)) continue;
      const cs = getComputedStyle(el);
      if (el.tagName === 'A' && cs.display === 'inline') {
        const parentText = (el.parentElement?.textContent || '').trim().length;
        const own = (el.textContent || '').trim().length;
        if (parentText > own + 8) { inline += 1; continue; }
      }
      (el as HTMLElement).scrollIntoView({ block: 'center', inline: 'nearest' });
      const rects = Array.from(el.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
      if (!rects.length) continue;
      const r = rects[0];
      measured += 1;
      const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
      const owns = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
        const t = document.elementFromPoint(x, y);
        return !!t && (t === el || el.contains(t) || (el.tagName === 'INPUT' && t.closest('label') === (el as HTMLInputElement).closest('label') && !!t.closest('label')));
      };
      if (!owns(cx, cy)) continue; // covered by something else at its centre: not a pointer target right now (e.g. under an overlay); reported separately by layout checks
      const sweep = (dx: number, dy: number) => { let n = 0; while (n < 400 && owns(cx + dx * (n + 1), cy + dy * (n + 1))) n += 1; return n; };
      const hitH = sweep(0, -1) + sweep(0, 1) + 1;
      const hitW = sweep(-1, 0) + sweep(1, 0) + 1;
      if (hitH < MIN - 0.5 || hitW < MIN - 0.5) {
        out.push({ tag: el.tagName.toLowerCase(), name: nameOf(el), w: Math.round(r.width), h: Math.round(r.height), hitW, hitH, cls: String((el as HTMLElement).className || '').split(/\s+/).slice(0, 6).join(' '), where: whereOf(el) });
      }
    }
    window.scrollTo(0, 0);
    return { measured, inline, offenders: out };
  }, min);
}

export const signature = (f: TargetFinding) => `${f.tag}[${f.cls}] in ${f.where || 'body'}`;

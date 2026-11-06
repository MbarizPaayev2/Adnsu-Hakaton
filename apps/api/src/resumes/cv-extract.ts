import { inflateRawSync } from 'zlib';

// A resume's document.xml is never legitimately more than a few hundred KB —
// this is generous headroom, not a realistic ceiling. Without it, a crafted
// .docx (still under multer's 10MB upload cap) can inflate to gigabytes in
// one synchronous call and exhaust the API process's memory for everyone.
const MAX_INFLATED_SIZE = 50 * 1024 * 1024; // 50MB

/**
 * Binary CV -> plain text.
 *
 * Split out from cv-parser.ts so the parsing heuristics stay pure and
 * unit-testable while the format-specific decoding lives here.
 */

/**
 * DOCX text, with no third-party dependency.
 *
 * A .docx is a ZIP whose `word/document.xml` holds the body. Node ships
 * raw-deflate but no ZIP reader, so the central directory is walked directly.
 * That is a small amount of code for a well-specified container, and avoids
 * pulling an archive library in for one file.
 */
export function extractDocxText(buffer: Buffer): string {
  const xml = readZipEntry(buffer, 'word/document.xml');
  if (!xml) throw new Error('DOCX faylında word/document.xml tapılmadı');

  return (
    xml
      // Word splits a single visual line across many <w:t> runs; paragraph and
      // break tags are the only real line boundaries.
      .replace(/<w:p[\s>]/g, '\n<w:p ')
      .replace(/<w:br\s*\/>/g, '\n')
      .replace(/<w:tab\s*\/>/g, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
  );
}

/** Reads one file out of a ZIP by name via the end-of-central-directory record. */
function readZipEntry(buffer: Buffer, wanted: string): string | null {
  // End of central directory: signature 0x06054b50, scanned from the tail
  // because it is followed by a variable-length comment.
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0 && i > buffer.length - 22 - 65_536; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);

  for (let i = 0; i < entryCount; i++) {
    // Central directory file header: signature 0x02014b50.
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) return null;

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLen);

    if (name === wanted) {
      // Local file header: 30 bytes plus its own name/extra fields, whose
      // lengths can differ from the central directory's.
      const localNameLen = buffer.readUInt16LE(localOffset + 26);
      const localExtraLen = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const data = buffer.subarray(dataStart, dataStart + compressedSize);
      // 0 = stored, 8 = deflate. Those are the only methods Word emits.
      if (method === 0) return data.toString('utf8');
      if (method === 8) return inflateRawSync(data, { maxOutputLength: MAX_INFLATED_SIZE }).toString('utf8');
      throw new Error(`DOCX-də dəstəklənməyən sıxılma metodu: ${method}`);
    }

    offset += 46 + nameLen + extraLen + commentLen;
  }

  return null;
}

/**
 * PDF text via pdf.js.
 *
 * Uses Mozilla's pdf.js rather than a hand-rolled content-stream reader
 * specifically because of Azerbaijani: ə, ğ, ş, ı and ö routinely land in
 * subset fonts with custom encodings, and reading them correctly means
 * honouring each font's ToUnicode CMap. A naive extractor silently mangles
 * exactly the characters that matter most here.
 *
 * Imported dynamically because the package is ESM-only.
 */
export type PositionedItem = { x: number; xEnd: number; y: number; text: string; /** font height, when known: the unit the space/no-space decision between neighbouring fragments is measured in */ h?: number };

/**
 * A gap narrower than this fraction of the font height is kerning or a font switch inside one word, never a space.
 * (A real inter-word space is about a quarter of the height; justified text stretches it, it never shrinks it below this.)
 */
const SPACE_GAP = 0.18;

/**
 * Groups already-column-separated items into lines.
 *
 * Rows: items whose baselines lie within a fraction of the text height share a row (a rounded y alone split a line whenever one fragment was a
 * point higher). Within a row the fragments are joined by their real distance, not blindly by a space: PDFs break a word wherever the font,
 * kerning or a hyphen glyph changes ("pathwa" + "ys.", "202" + "6", "limited" + "-" + "assurance"), and putting a space between those fragments
 * corrupted every hyphenated word, year and long word of the extracted CV.
 */
export function linesFromItems(items: PositionedItem[]): string[] {
  const heights = items.map((i) => i.h).filter((h): h is number => !!h && h > 0).sort((a, b) => a - b);
  const typical = heights.length ? heights[Math.floor(heights.length / 2)] : 10;
  const tolerance = Math.max(1.5, typical * 0.35);

  const sorted = [...items].sort((a, b) => b.y - a.y); // PDF y grows upward: descending = top-down
  const rows: { y: number; items: PositionedItem[] }[] = [];
  for (const item of sorted) {
    const row = rows.find((r) => Math.abs(r.y - item.y) <= tolerance);
    if (row) row.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }

  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => {
      const cells = row.items.sort((a, b) => a.x - b.x);
      let line = '';
      let prev: PositionedItem | null = null;
      for (const cell of cells) {
        if (!cell.text) continue;
        if (prev) {
          const unit = cell.h ?? prev.h ?? typical;
          const gap = cell.x - prev.xEnd;
          const spaced = /\s$/.test(line) || /^\s/.test(cell.text);
          if (!spaced && gap > unit * SPACE_GAP) line += ' ';
        }
        line += cell.text;
        prev = cell;
      }
      return line.replace(/\s+/g, ' ').trim();
    })
    .filter(Boolean);
}

/**
 * Splits a page's text items into left-to-right reading-order columns.
 *
 * pdf.js emits positioned text items in content-stream order, not visual
 * order — grouping them into lines purely by y-coordinate (as if the page
 * were single-column) works for ordinary resumes, but a two-column layout
 * (a sidebar with contact/skills next to a main experience column, the
 * single most common "modern" CV template) has left- and right-column text
 * sitting at the *same* height. Joining same-height items strictly by x
 * across the whole page width then merges unrelated sidebar and main-column
 * lines into one garbled row, e.g. "Email: x@y.com   Senior Engineer at
 * Acme" — and every section-heading/date-range heuristic downstream then
 * fails on text that no longer resembles the original document at all.
 *
 * Detects a column gutter by finding a wide horizontal gap that no text
 * item overlaps anywhere on the page — a real body-text gutter is far wider
 * than any inter-word space — and if found, processes each side as its own
 * top-to-bottom column before concatenating them. Single-column pages (the
 * common case) have no such gap and fall through unchanged.
 */
export function splitIntoColumns(items: PositionedItem[]): PositionedItem[][] {
  if (items.length < 4) return [items];

  const minX = Math.min(...items.map((i) => i.x));
  const maxX = Math.max(...items.map((i) => i.xEnd));
  const pageWidth = maxX - minX;
  if (pageWidth <= 0) return [items];

  // Merge every item's [x, xEnd] interval to find the union of covered
  // space, then take its complement — any leftover gap is unwritten-on
  // page area.
  const intervals = items
    .map((i) => [i.x, i.xEnd] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const covered: [number, number][] = [];
  for (const [start, end] of intervals) {
    const last = covered[covered.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else covered.push([start, end]);
  }

  // A real column gutter: wide relative to the page (never just word
  // spacing) and not hugging either edge (a margin, not a gutter).
  const MIN_GUTTER_FRACTION = 0.03;
  let bestGap: { start: number; end: number } | null = null;
  for (let i = 1; i < covered.length; i++) {
    const gapStart = covered[i - 1][1];
    const gapEnd = covered[i][0];
    const gapWidth = gapEnd - gapStart;
    if (gapWidth < pageWidth * MIN_GUTTER_FRACTION) continue;
    const fromEdge = (gapStart - minX) / pageWidth;
    if (fromEdge < 0.15 || fromEdge > 0.85) continue;
    if (!bestGap || gapWidth > bestGap.end - bestGap.start) {
      bestGap = { start: gapStart, end: gapEnd };
    }
  }

  if (!bestGap) return [items];

  const mid = (bestGap.start + bestGap.end) / 2;
  const left = items.filter((i) => i.x < mid);
  const right = items.filter((i) => i.x >= mid);
  // Both sides must carry real substance — a stray footer/header item alone
  // on one side isn't a genuine second column.
  if (left.length < 2 || right.length < 2) return [items];

  return [left, right];
}

/** In LinkedIn's sidebar, line spacing distinguishes wrapped certificate/award names
 * from the next record. Use geometry rather than guessing from words such as "School". */
export function linkedInSidebarLines(items: PositionedItem[]): string[] {
  const ys = [...new Set(items.map((i) => i.y))].sort((a,b) => b-a);
  const rows = ys.map((y) => ({ y, cells: items.filter((i) => i.y === y) }));
  const out: string[] = [];
  let joinNames = false;
  let previous: typeof rows[number] | undefined;
  for (const row of rows) {
    const line = linesFromItems(row.cells).join(' ');
    if (!line) continue;
    const heading = /^(contact|top skills|languages|certifications|honors-awards)$/i.test(line);
    const h = Math.max(...row.cells.map((c) => c.h || 10));
    if (heading) joinNames = /^(certifications|honors-awards)$/i.test(line);
    // A name wrapped at its own hyphen ("Scikit-" / "learn") is one word again.
    if (!heading && joinNames && previous && previous.y - row.y <= h * 1.45 && out.length) out[out.length - 1] += /[-‐]$/.test(out[out.length - 1]) ? line : ` ${line}`;
    else out.push(line);
    previous = row;
  }
  return out;
}

/** One extracted line with the layout facts the LinkedIn reader uses: font size (relative tiers), page, and which column it came from. */
export type LayoutLine = { text: string; page: number; size: number; column: 'main' | 'side' };

/** "Page 2 of 3", "Səhifə 2", "Стр. 2 из 3": a page number wherever it sits. */
const PAGE_LABEL = /^(?:page|səhifə|sayfa|стр(?:аница)?\.?)\s*\d{1,3}(?:\s*(?:of|\/|из|-|–)\s*\d{1,3})?$/i;
/** "2", "2 / 3", "- 2 -": only a page number when it is the first or last line of a page. */
const BARE_PAGE_NUMBER = /^[-–—\s]*\d{1,3}(?:\s*(?:of|\/|из)\s*\d{1,3})?[-–—\s]*$/i;

/**
 * Page furniture: "Page 2 of 3" style numbers anywhere, and a header/footer line repeated at the top or bottom of several pages. The first
 * occurrence of a repeated line is kept (a name or contact strip printed on every page is real information once), later repeats are not.
 */
export function withoutPageFurniture(pages: LayoutLine[][]): LayoutLine[][] {
  const key = (t: string) => t.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  // Only short lines can be furniture: body text that merely looks alike once digits are ignored (numbered bullets) is never removed.
  const edges = (lines: LayoutLine[]) => new Set([...lines.slice(0, 2), ...lines.slice(-2)].filter((l) => l.text.length <= 70).map((l) => key(l.text)));
  const counts = new Map<string, number>();
  if (pages.length > 1) for (const page of pages) for (const k of edges(page)) counts.set(k, (counts.get(k) ?? 0) + 1);
  const seen = new Set<string>();
  return pages.map((page) => {
    const edge = edges(page);
    return page.filter((line, i) => {
      const text = line.text.trim();
      if (PAGE_LABEL.test(text) || ((i === 0 || i === page.length - 1) && BARE_PAGE_NUMBER.test(text))) return false;
      const k = key(line.text);
      const atEdge = (i < 2 || i >= page.length - 2) && edge.has(k);
      if (atEdge && (counts.get(k) ?? 0) >= 2) {
        if (seen.has(k)) return false;
        seen.add(k);
      }
      return true;
    });
  });
}

function rows(items: PositionedItem[], page: number, column: LayoutLine['column']): LayoutLine[] {
  // Same row grouping as linesFromItems, keeping the row's font size.
  const heights = items.map((i) => i.h).filter((h): h is number => !!h && h > 0).sort((a, b) => a - b);
  const typical = heights.length ? heights[Math.floor(heights.length / 2)] : 10;
  const tolerance = Math.max(1.5, typical * 0.35);
  const grouped: { y: number; items: PositionedItem[] }[] = [];
  for (const item of [...items].sort((a, b) => b.y - a.y)) {
    const row = grouped.find((r) => Math.abs(r.y - item.y) <= tolerance);
    if (row) row.items.push(item);
    else grouped.push({ y: item.y, items: [item] });
  }
  return grouped
    .sort((a, b) => b.y - a.y)
    .map((row) => ({ text: linesFromItems(row.items).join(' '), page, size: Math.max(...row.items.map((i) => i.h || typical)), column }))
    .filter((l) => l.text);
}

/**
 * PDF text plus per-line layout. Ordinary CVs read in the same column order as before, minus page numbers and repeated headers/footers.
 * A LinkedIn export is read main column first (name, headline, Summary, Experience, Education on every page) and then the first page's sidebar
 * (Contact, Top Skills, Languages, Certifications, Honors-Awards), so a sidebar section can never swallow the name or a continuation page.
 */
export async function extractPdfLayout(buffer: Buffer): Promise<{ text: string; lines: LayoutLine[]; linkedIn: boolean }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    // No worker process, no system fonts, no eval: this runs server-side on
    // user-supplied files, so every optional capability stays off.
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: false,
  }).promise;

  try {
    const pages: { items: PositionedItem[] }[] = [];
    // Cap the work a single upload can cause; CVs are not 200 pages long.
    const pageCount = Math.min(doc.numPages, 15);

    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();

      const items: PositionedItem[] = [];
      for (const item of content.items as { str?: string; transform?: number[]; width?: number; height?: number }[]) {
        if (!item.str || !item.transform) continue;
        const x = item.transform[4] ?? 0;
        items.push({
          x,
          xEnd: x + (item.width ?? item.str.length * 4),
          y: item.transform[5] ?? 0,
          text: item.str,
          h: (item as { height?: number }).height,
        });
      }
      pages.push({ items });
      page.cleanup();
    }

    const linkedIn = pages.some((p) => p.items.some((item) => /linkedin\.com\/in\//i.test(item.text)));
    // The sidebar's right edge on the first two-column page; later pages are judged against it.
    let sideEdge: number | null = null;
    const laidOut = pages.map(({ items }, index) => {
      const columns = splitIntoColumns(items);
      if (!linkedIn) return columns.flatMap((col) => rows(col, index + 1, 'main'));
      if (columns.length > 1 && sideEdge === null) sideEdge = Math.max(...columns[0].map((i) => i.xEnd));
      return columns.flatMap((col, c) => {
        const side = columns.length > 1 ? c === 0 : sideEdge !== null && Math.max(...col.map((i) => i.xEnd)) <= sideEdge + 1;
        if (!side) return rows(col, index + 1, 'main');
        // Sidebar: wrapped certificate/award names are joined by line spacing (see linkedInSidebarLines).
        return linkedInSidebarLines(col).map((text) => ({ text, page: index + 1, size: 0, column: 'side' as const }));
      });
    });
    const clean = withoutPageFurniture(laidOut).flat();
    const lines = linkedIn ? [...clean.filter((l) => l.column === 'main'), ...clean.filter((l) => l.column === 'side')] : clean;
    return { text: lines.map((l) => l.text).join('\n'), lines, linkedIn };
  } finally {
    // Without this the worker/document keeps native memory alive per upload.
    await doc.destroy();
  }
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  return (await extractPdfLayout(buffer)).text;
}

export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Dispatches on the declared mime type, falling back to sniffing the magic bytes. */
export async function extractCvText(buffer: Buffer, mimeType: string): Promise<string> {
  return (await extractCvDocument(buffer, mimeType)).text;
}

/** Text plus, for PDFs, the per-line layout the LinkedIn reader uses. */
export async function extractCvDocument(buffer: Buffer, mimeType: string): Promise<{ text: string; lines?: LayoutLine[] }> {
  const isPdf = mimeType === 'application/pdf' || buffer.subarray(0, 5).toString() === '%PDF-';
  if (isPdf) return extractPdfLayout(buffer);

  // A DOCX always starts with the ZIP local-file-header magic "PK\x03\x04".
  const isZip = buffer.subarray(0, 4).toString('hex') === '504b0304';
  if (mimeType === DOCX_MIME || isZip) return { text: extractDocxText(buffer) };

  throw new Error(`Dəstəklənməyən fayl formatı: ${mimeType}`);
}

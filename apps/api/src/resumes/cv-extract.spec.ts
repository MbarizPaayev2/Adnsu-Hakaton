import { linesFromItems, splitIntoColumns, extractDocxText, withoutPageFurniture, type PositionedItem } from './cv-extract';

// A4 in PDF points (72/inch): ~595 wide. Coordinates below are loosely
// modeled on that scale so the gutter-fraction thresholds behave the same
// way they would against a real extracted page.
const PAGE_WIDTH = 595;

function item(text: string, x: number, y: number, width?: number): PositionedItem {
  return { x, xEnd: x + (width ?? text.length * 5), y, text };
}

describe('linesFromItems', () => {
  it('groups items sharing a y into one line, sorted left-to-right, and orders lines top-to-bottom', () => {
    const items: PositionedItem[] = [
      item('World', 50, 100),
      item('Hello', 10, 100),
      item('Second', 10, 80),
      item('line', 60, 80),
    ];

    expect(linesFromItems(items)).toEqual(['Hello World', 'Second line']);
  });
});

describe('splitIntoColumns', () => {
  it('does not split an ordinary single-column page', () => {
    const items: PositionedItem[] = [
      item('John Doe', 40, 700),
      item('Senior Engineer', 40, 680),
      item('Acme Corp', 40, 660, 100),
      item('2020 - 2024', 400, 660, 90),
      item('Built the thing.', 40, 640, 300),
    ];

    const columns = splitIntoColumns(items);
    expect(columns).toHaveLength(1);
    expect(columns[0]).toHaveLength(items.length);
  });

  it('splits a sidebar + main-column layout instead of interleaving same-height text', () => {
    // Left "sidebar" column: x from ~20 to ~180.
    // Right "main" column: x from ~250 to ~560.
    // Gutter (~180-250) is never covered by any item, at any height, and
    // is well clear of both page edges — a real column gutter.
    const sidebar: PositionedItem[] = [
      item('Contact', 20, 700, 100),
      item('a@x.com', 20, 680, 100),
      item('Skills', 20, 640, 100),
      item('TypeScript', 20, 620, 140),
    ];
    const main: PositionedItem[] = [
      item('Experience', 250, 700, 150),
      item('Senior Engineer', 250, 680, 150),
      item('Acme Corp', 250, 660, 150),
      item('Led the migration project.', 250, 640, 300),
    ];

    const columns = splitIntoColumns([...sidebar, ...main]);
    expect(columns).toHaveLength(2);

    // Each column's own lines must stay intact — nothing from the sidebar
    // should have been fused onto the same line as main-column text (the
    // original bug: same-height items across the whole page width joined
    // into one garbled row regardless of which column they came from).
    const [left, right] = columns;
    const leftText = linesFromItems(left).join(' | ');
    const rightText = linesFromItems(right).join(' | ');
    expect(leftText).toContain('Contact');
    expect(leftText).toContain('a@x.com');
    expect(leftText).not.toContain('Experience');
    expect(rightText).toContain('Experience');
    expect(rightText).not.toContain('Contact');

    // The concatenated output (sidebar first, since it starts further left)
    // must never merge a sidebar line and a main-column line at the same
    // height into one string.
    const fullText = columns.flatMap((c) => linesFromItems(c));
    expect(fullText.some((line) => line.includes('Contact') && line.includes('Experience'))).toBe(false);
    expect(fullText.some((line) => line.includes('a@x.com') && line.includes('Senior Engineer'))).toBe(false);
  });

  it('does not treat ordinary word spacing as a column gutter', () => {
    // A handful of narrow, closely-spaced items — nowhere near the 3% of
    // page width a real gutter needs to clear.
    const items: PositionedItem[] = [
      item('The', 40, 700, 20),
      item('quick', 65, 700, 30),
      item('brown', 100, 700, 30),
      item('fox', 135, 700, 20),
    ];

    expect(splitIntoColumns(items)).toHaveLength(1);
  });

  it('does not split on a wide gap that is really just a large single-column margin', () => {
    // Everything sits in the left ~40% of the page; the "gap" from there to
    // the right edge is unused margin, not a second column — there's no
    // real content on the far side, so it must fall back to one column.
    const items: PositionedItem[] = [
      item('Left-aligned content', 40, 700, 120),
      item('More content here', 40, 680, 120),
      item('Third line of text', 40, 660, 120),
    ];

    expect(splitIntoColumns(items)).toHaveLength(1);
  });

  it('does not split when only a stray item (e.g. a page number) sits past the gap', () => {
    const main: PositionedItem[] = [
      item('Experience', 40, 700, 150),
      item('Senior Engineer', 40, 680, 150),
      item('Acme Corp', 40, 660, 150),
    ];
    const strayFooter: PositionedItem[] = [item('1', 560, 20, 10)];

    const columns = splitIntoColumns([...main, ...strayFooter]);
    expect(columns).toHaveLength(1);
  });
});

function zipStore(name: string, contents: Buffer): Buffer {
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt32LE(contents.length, 18);
  local.writeUInt32LE(contents.length, 22);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(contents.length, 20);
  central.writeUInt32LE(contents.length, 24);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  const localPart = Buffer.concat([local, nameBuf, contents]);
  central.writeUInt32LE(0, 42);
  eocd.writeUInt32LE(central.length + nameBuf.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, central, nameBuf, eocd]);
}

describe('extractDocxText', () => {
  it('reads paragraph text from a real document.xml inside a zip', () => {
    const xml = Buffer.from(
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Leyla Huseynova</w:t></w:r></w:p><w:p><w:r><w:t>Bacarıqlar</w:t></w:r></w:p><w:p><w:r><w:t>NestJS, PostgreSQL</w:t></w:r></w:p></w:body></w:document>',
    );
    const buf = zipStore('word/document.xml', xml);
    const text = extractDocxText(buf);
    expect(text).toContain('Leyla Huseynova');
    expect(text).toContain('NestJS');
    expect(text).not.toContain('InventedRole');
  });
});



describe('LinkedIn sidebar certificate boundaries', () => {
  it('joins wrapped names by line spacing, keeping the next certificate separate', () => {
    const { linkedInSidebarLines } = require('./cv-extract');
    const row = (text: string, y: number) => ({ text, y, x: 22, xEnd: 180, h: 10 });
    expect(linkedInSidebarLines([row('Certifications', 540), row('Strategy and Corporate Finance', 520), row('School', 507), row('International English Language', 489), row('Testing System', 476), row('Forward Program', 458), row('Honors-Awards', 422)]))
      .toEqual(['Certifications', 'Strategy and Corporate Finance School', 'International English Language Testing System', 'Forward Program', 'Honors-Awards']);
  });
});

describe('withoutPageFurniture', () => {
  const page = (n: number, texts: string[]) => texts.map((text) => ({ text, page: n, size: 10, column: 'main' as const }));

  it('removes page numbers and later repeats of a running header, keeping the first occurrence', () => {
    const out = withoutPageFurniture([
      page(1, ['Ada Leman — CV', 'Experience', 'Analyst | Acme  2020 - 2024', 'Page 1 of 2']),
      page(2, ['Ada Leman — CV', 'Education', 'Example University  2016 - 2020', '2']),
    ]);
    expect(out.map((p) => p.map((l) => l.text))).toEqual([
      ['Ada Leman — CV', 'Experience', 'Analyst | Acme  2020 - 2024'],
      ['Education', 'Example University  2016 - 2020'],
    ]);
  });

  it('never removes body text that only differs by its numbers', () => {
    const long = (i: number) => `Built service ${i} with NestJS and PostgreSQL, measured the query time and rebuilt the indexes for the team.`;
    const out = withoutPageFurniture([page(1, ['Name', long(1), long(2)]), page(2, [long(3), long(4), 'Skills'])]);
    expect(out.flat()).toHaveLength(6);
  });

  it('keeps a year or a short number inside the page', () => {
    expect(withoutPageFurniture([page(1, ['Name', '2021', 'Awards', 'Footer'])]).flat().map((l) => l.text)).toEqual(['Name', '2021', 'Awards', 'Footer']);
  });
});

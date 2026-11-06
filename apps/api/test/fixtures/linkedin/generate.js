/**
 * Synthetic LinkedIn "Save to PDF" exports for the import tests.
 *
 * Every person, employer and sentence here is invented. The layout copies the export's real structure: a grey sidebar on the first page
 * (Contact, Top Skills, Languages, Certifications, Honors-Awards), the main column (name, headline, location, Summary, Experience, Education)
 * continuing onto later pages at the same offset, and a "Page N of M" footer on every page.
 *
 * Regenerate after editing a profile:  node test/fixtures/linkedin/generate.js   (from apps/api)
 */
const { NodeCompiler } = require('@myriaddreamin/typst-ts-node-compiler');
const { readdirSync, readFileSync, writeFileSync } = require('fs');
const { join } = require('path');

const lit = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const block = (kind, text) => `(${lit(kind)}, ${lit(text)})`;

function source(profile) {
  const side = profile.sidebar.flatMap((s) => [block('sh', s.heading), ...s.items.map((t) => block('si', t))]);
  const main = profile.main.map(([kind, text]) => block(kind, text));
  return `
#set page(paper: "us-letter", margin: (x: 0pt, top: 36pt, bottom: 54pt),
  footer: context align(center, text(size: 9pt, fill: rgb("#888"))[Page #counter(page).display() of #counter(page).final().first()]))
#set text(font: "Arial", size: 10.5pt)
#set par(leading: 0.4em)
#let side = (${side.join(', ')},)
#let main = (${main.join(', ')},)
#let s(k, t) = {
  if k == "sh" { v(12pt); text(size: 13pt, weight: "bold", t); v(4pt) } else { block(below: 8pt, text(size: 10.5pt, t)) }
}
#let m(k, t) = {
  if k == "name" { text(size: 26pt, t); v(2pt) }
  else if k == "headline" { block(below: 8pt, text(size: 12pt, t)) }
  else if k == "location" { block(below: 14pt, text(size: 10.5pt, fill: rgb("#666"), t)) }
  else if k == "h" { v(10pt); block(below: 8pt, text(size: 15.75pt, t)) }
  else if k == "company" or k == "inst" { block(above: 14pt, below: 4pt, text(size: 12pt, t)) }
  else if k == "total" { block(below: 6pt, text(size: 10.5pt, fill: rgb("#666"), t)) }
  else if k == "title" { block(above: 8pt, below: 4pt, text(size: 10.5pt, weight: "bold", t)) }
  else if k == "dates" or k == "place" { block(below: 4pt, text(size: 10.5pt, fill: rgb("#666"), t)) }
  else { block(below: 6pt, text(size: 10.5pt, t)) }
}
#grid(columns: (190pt, 1fr), column-gutter: 28pt,
  block(fill: rgb("#f1f1f1"), inset: (left: 24pt, right: 14pt, y: 12pt), width: 100%)[#for (k, t) in side { s(k, t) }],
  block(inset: (right: 36pt))[#for (k, t) in main { m(k, t) }])
`;
}

const compiler = NodeCompiler.create({ fontArgs: [{ fontPaths: ['/System/Library/Fonts/Supplemental', '/usr/share/fonts'] }] });
for (const file of readdirSync(__dirname).filter((f) => f.endsWith('.profile.json'))) {
  const profile = JSON.parse(readFileSync(join(__dirname, file), 'utf8'));
  const pdf = compiler.pdf({ mainFileContent: source(profile) });
  writeFileSync(join(__dirname, file.replace('.profile.json', '.pdf')), pdf);
  console.log(file, pdf.length);
}

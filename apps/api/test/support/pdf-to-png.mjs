// Rasterises every page of the PDFs in a directory to PNG (pdf.js + @napi-rs/canvas), for visual inspection. Usage: node test/support/pdf-to-png.mjs <dir> [scale]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const dir = process.argv[2];
const scale = Number(process.argv[3]) || 1.2;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.pdf'))) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(join(dir, f))), useWorkerFetch: false, isEvalSupported: false, useSystemFonts: false }).promise;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    writeFileSync(join(dir, `${f.replace(/\.pdf$/, '')}-p${i}.png`), canvas.toBuffer('image/png'));
  }
  console.log(f, doc.numPages, 'page(s)');
}

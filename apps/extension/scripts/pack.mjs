// Packs the extension (without tests or scripts) into a ZIP, with no dependencies: node apps/extension/scripts/pack.mjs <output-dir>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const outDir = path.resolve(process.argv[2] || path.join(root, 'dist'));
const SKIP = new Set(['test', 'scripts', 'node_modules', 'dist', 'package.json', '.DS_Store']);

const files = [];
(function walk(dir, rel = '') {
  for (const name of fs.readdirSync(dir).sort()) {
    if (!rel && SKIP.has(name)) continue;
    const full = path.join(dir, name), r = rel ? `${rel}/${name}` : name;
    if (fs.statSync(full).isDirectory()) walk(full, r); else files.push({ name: r, data: fs.readFileSync(full) });
  }
})(root);

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const dt = new Date(Date.UTC(2026, 0, 1)); // fixed time: the archive is reproducible
const dosTime = (dt.getUTCHours() << 11) | (dt.getUTCMinutes() << 5), dosDate = ((dt.getUTCFullYear() - 1980) << 9) | ((dt.getUTCMonth() + 1) << 5) | dt.getUTCDate();

const parts = [], central = []; let offset = 0;
for (const f of files) {
  const name = Buffer.from(f.name), comp = zlib.deflateRawSync(f.data, { level: 9 }), crc = crc32(f.data);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(f.data.length, 22); local.writeUInt16LE(name.length, 26);
  parts.push(local, name, comp);
  const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10); c.writeUInt16LE(dosTime, 12); c.writeUInt16LE(dosDate, 14);
  c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(f.data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
  central.push(c, name); offset += local.length + name.length + comp.length;
}
const cd = Buffer.concat(central), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'aise-agent-extension.zip');
fs.writeFileSync(out, Buffer.concat([...parts, cd, end]));
// The API reads this to tell each paired browser whether a newer version is available.
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
fs.writeFileSync(path.join(outDir, 'aise-agent-extension.json'), `${JSON.stringify({ version })}\n`);
console.log(`${out}: ${files.length} files, ${fs.statSync(out).size} bytes, version ${version}`);

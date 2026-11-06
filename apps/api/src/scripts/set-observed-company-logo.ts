/**
 * Records a logo for an observed (scraped) company with its provenance. A logo is never taken automatically and never hot-linked: an operator who
 * has the file and knows where it is published passes both, and the page shows it only with the source, the source page and a verification time.
 *
 *   npx ts-node -r tsconfig-paths/register src/scripts/set-observed-company-logo.ts --company "SOCAR" --file ./socar.png \
 *     --source employer_website --source-url https://www.socar.az/ [--website https://www.socar.az]
 *
 * Writes only to the database named by DATABASE_URL and to the uploads folder. Dry-run without --apply.
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { LocalStorageService } from '../resumes/local-storage.service';
import { observedCompanyKey } from '../observed-companies/observed-company.util';

export const LOGO_SOURCES = ['employer_website', 'source_listing', 'operator_upload'] as const;
export const MAX_LOGO_BYTES = 512 * 1024;

export function logoMimeOf(bytes: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

export function publicHttpsUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || /^(localhost|\d+\.\d+\.\d+\.\d+|\[)/i.test(url.hostname)) throw new Error('Source URL must be a public https page');
  url.hash = '';
  return url.href;
}

export function parseLogoArgs(args: string[]) {
  const out: { company?: string; file?: string; source?: string; sourceUrl?: string; website?: string; apply: boolean } = { apply: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--apply') { out.apply = true; continue; }
    const key = ({ '--company': 'company', '--file': 'file', '--source': 'source', '--source-url': 'sourceUrl', '--website': 'website' } as const)[a as '--company'];
    if (!key) throw new Error(`Unknown option ${a}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${a}`);
    out[key] = value;
  }
  if (!out.company || !observedCompanyKey(out.company)) throw new Error('--company must name a company');
  if (!out.file) throw new Error('--file is required');
  if (!out.source || !(LOGO_SOURCES as readonly string[]).includes(out.source)) throw new Error(`--source must be one of ${LOGO_SOURCES.join(', ')}`);
  if (!out.sourceUrl) throw new Error('--source-url (the public page the logo comes from) is required');
  out.sourceUrl = publicHttpsUrl(out.sourceUrl);
  if (out.website) out.website = publicHttpsUrl(out.website);
  return out as Required<Pick<typeof out, 'company' | 'file' | 'source' | 'sourceUrl' | 'apply'>> & { website?: string };
}

async function main() {
  const o = parseLogoArgs(process.argv.slice(2));
  const bytes = await readFile(o.file);
  if (bytes.length === 0 || bytes.length > MAX_LOGO_BYTES) throw new Error(`Logo must be 1 byte to ${MAX_LOGO_BYTES} bytes`);
  const mime = logoMimeOf(bytes);
  if (!mime) throw new Error('Logo must be a PNG, JPEG or WEBP image');
  const key = observedCompanyKey(o.company);
  console.log(`${o.apply ? 'Recording' : 'Dry run:'} ${mime} logo (${bytes.length} bytes) for "${o.company}" (key "${key}") from ${o.source} ${o.sourceUrl}`);
  if (!o.apply) return;
  const prisma = new PrismaClient();
  const storage = new LocalStorageService();
  try {
    const previous = await prisma.observedCompanyProfile.findUnique({ where: { companyKey: key } });
    const logoFile = await storage.uploadBuffer(bytes, mime);
    await prisma.observedCompanyProfile.upsert({
      where: { companyKey: key },
      create: { companyKey: key, displayName: o.company, website: o.website ?? null, logoFile, logoSha256: createHash('sha256').update(bytes).digest('hex'), logoSource: o.source, logoSourceUrl: o.sourceUrl, logoVerifiedAt: new Date() },
      update: { displayName: o.company, ...(o.website ? { website: o.website } : {}), logoFile, logoSha256: createHash('sha256').update(bytes).digest('hex'), logoSource: o.source, logoSourceUrl: o.sourceUrl, logoVerifiedAt: new Date() },
    });
    if (previous?.logoFile) await storage.deleteFile(previous.logoFile).catch(() => undefined);
    console.log('Recorded.');
  } finally { await prisma.$disconnect(); }
}
if (require.main === module) main().catch((e) => { console.error(e instanceof Error ? e.message : 'Failed'); process.exitCode = 1; });

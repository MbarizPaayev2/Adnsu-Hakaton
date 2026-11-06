#!/usr/bin/env node
/**
 * Copies the non-TypeScript assets that `nest build` would normally copy,
 * so `build:local` produces the same dist/ as the production build.
 *
 * Why this exists at all: on this repo `nest build` hangs indefinitely while
 * the committed `aise-main/aise-main` copy of the whole repository is
 * present. Measured on macOS — `tsc` alone finishes in ~14s, `nest build`
 * never returns (0.3% CPU, stuck in a deep synchronous module-resolution
 * recursion during bootstrap), and the same `nest build` completes in ~132s
 * with the nested directory temporarily moved aside. The nested copy is
 * committed and must be preserved, and the Docker image never receives it
 * (apps/api/Dockerfile copies only apps/api and packages/shared-types), so
 * the production build is unaffected and is deliberately left alone.
 *
 * Keep the glob list in step with `assets` in nest-cli.json.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const OUT = path.join(__dirname, '..', 'dist');

// Mirrors nest-cli.json compilerOptions.assets (relative to sourceRoot).
const ASSET_DIRS = [{ dir: 'resumes/tailor', ext: '.typ' }];

let copied = 0;
for (const { dir, ext } of ASSET_DIRS) {
  const from = path.join(SRC, dir);
  const to = path.join(OUT, dir);
  if (!fs.existsSync(from)) continue;
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (!name.endsWith(ext)) continue;
    fs.copyFileSync(path.join(from, name), path.join(to, name));
    copied++;
  }
}

// Fail loudly rather than emit a dist that silently lacks its templates —
// shipping only some .typ files is exactly the production crash b6a389f fixed.
if (copied === 0) {
  console.error('copy-assets: no assets copied — check ASSET_DIRS against nest-cli.json');
  process.exit(1);
}
console.log(`copy-assets: copied ${copied} asset file(s)`);

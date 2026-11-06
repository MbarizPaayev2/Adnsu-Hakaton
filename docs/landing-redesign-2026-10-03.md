# Landing redesign — 3 October 2026

Workspace: `aise-site-quality`, branch `codex/site-quality-audit`.
Starting checkpoint: `a824d762f8d10b5211644205ce41c62791361e18`.

## Result

Replaced the previous long landing page with a short hero, an original animated
SVG illustration, three workflow steps, category discovery/search, and a closing
invitation. The main content is approximately 140 words. The illustration's job
types are explicitly examples; it contains no actual match scores, invented
employers, testimonials, inventory totals, or simulated sending controls.

Public browsing, authenticated match entry, registration, employer entry and legal
links remain available. The page uses scoped CSS; other routes retain their visual
system. Metadata describes job discovery without promising automatic submission.
Motion is finite and disabled by the visitor's reduced-motion preference.

## Verification

- Frontend suite: **175 tests passed in 28 files**. Includes retained 404/error
  coverage and updated landing behavior coverage.
- TypeScript: passed with `--noEmit --incremental false`.
- ESLint: passed on the changed TSX files.
- Production webpack build: passed; 71 pages generated, `/` statically rendered.
- Real cached Chrome for Testing: 320, 390, 768, 1024 and 1440px. No horizontal
  overflow or clipped controls; main browsing action above the fold at every
  width; preview does not overlap its selector. Main action height is 52–54px.
- Example switching updates the category link. Mobile Escape closes the menu
  and restores toggle focus. Keyboard skip link focuses main content; Space
  changes the example. Normal motion runs and reduced motion has no animations.
- Existing cookie refusal is preserved. Search submits the encoded GET query.
  **The search destination is intercepted by the verifier:** this proves frontend
  navigation, not catalogue/API functionality, matching quality, or delivery.

Evidence is outside Git:
`/Users/fizuli.050icloud.com/.codex/artifacts/aise-landing-2026-10-03/`.
It contains desktop/mobile screenshots, five-width measurements in
`verification.json`, and keyboard/motion checks in `keyboard-motion.json`.
The final screenshots were captured against the locally served production build.

## Reproduce / integrate

Run the usual local web preview on an unused port. From the repository root:

```sh
HOME_PREVIEW_URL=http://127.0.0.1:3470 node scripts/verify-home.mjs
```

`CHROMIUM_PATH` may select an installed browser; the script downloads nothing.
`HOME_EVIDENCE_DIR` selects a screenshot destination (default `/tmp/aise-home-evidence`).
For the frontend suite, run from `apps/web`:

```sh
node ../../node_modules/vitest/vitest.mjs run --config vitest.config.mts --maxWorkers=2 --no-file-parallelism
node ../../node_modules/typescript/bin/tsc --project tsconfig.json --noEmit --incremental false
```

This checkpoint is the landing work only. Claude should review it alongside the
earlier UX commits when integrating the frontend branch. No backend, schema,
production environment, global design token, dependency or lockfile was changed.
No application, payment or email was sent. No merge or deployment was performed.
Visual preference and first-time comprehension still require human feedback;
automated checks do not establish universal comprehension or accessibility.

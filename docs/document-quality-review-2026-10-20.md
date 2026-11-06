# Document preparation review corrections — 20 October 2026

PR #104 adds preparation suggestions, section selection and document presentation changes. Independent review found that some of those controls were not connected to the generation path. This follow-up fixes their behaviour before release.

## Changes

- Career-section choices travel from preparation through the generation DTO, ownership validation, document provenance and the background worker. An omitted selection uses automatic selection; an empty selection intentionally excludes selectable career entries. Languages remain available. Regeneration inherits the selection unless explicitly changed.
- Evidence exclusions survive skill-save refreshes. Motivation acceptance, rejection and skip notify the parent correctly; changing vacancies clears earlier motivation and stale responses cannot replace current guidance. Letter-composer handoff carries the selected evidence too.
- Summaries rank supported deliverables across experience, projects and activities. A later project can lead even after more than 100 unrelated experience bullets. When no suitable short deliverable exists, background wording avoids invented professional expertise or personality traits.
- Motivation proposals reference actual requirements and relevant confirmed evidence. Unsupported employer-standard and personality claims were removed. Personal interest remains unselected until the candidate confirms it. No extra provider calls were added.
- The entire detected requirement source line is available in expandable review, including compound lines, unfamiliar phrases and long requirements. Unclassified requirements are marked for review. This is source visibility, not a claim of exhaustive semantic skill extraction.
- Stable experience IDs originate in saved profile rows. Concise-resume omissions survive reconciliation and review saves; review no longer restores excluded jobs or assigns highlights by the full profile's array position. Omitted roles are recorded as review issues. This does not guarantee every resume fits one page regardless of selected content.
- AI ranking orders only the supported, vacancy-selected skill groups. It cannot bypass selection by returning all profile skills.
- Removed a renderer name rewrite specific to one candidate. Both CV and letter preserve the saved candidate identity, including legitimate dotted and dotless characters. Incorrect saved names require profile correction rather than name guessing.

## Verification

- API: 128 suites, 1,985 tests passed.
- Web: 95 suites, 606 tests passed; the final two preparation/document suites were rerun after the last UI adjustments: 46 tests passed.
- Real Typst PDF suite: 2 suites, 14 tests passed. The final concise-resume review regression also compiles the resulting PDF.
- API Nest build and web TypeScript check passed.
- `git diff --check` passed.
- Focused regressions cover ownership rejection, explicitly empty selection, UI-to-request selection, worker consumption, stale motivation, selection preservation after refresh, long source requirements, later project selection, and role-safe edits after compression.

Full source lint is not a clean release gate: the existing document components have lint errors and warnings, including synchronous effect state and existing `any` use. Type checks and the tests above are passing. jsdom also logs its known unsupported full-navigation warning; these tests are not live-browser navigation proof.

No paid provider, schema migration, pricing or allowance change, live application or payment was introduced. Live provider prose quality and native-language editorial approval remain separate from deterministic verification. No production deployment was started during this correction pass.

## Release

Release only PR #104 after successful CI on its final head and the resulting main commit. The existing self-hosted CI runners were offline when checked; restore that runner before waiting for queued checks. Use the established build-once, backup/restore, deployment and verification workflow. Retain the current production release and rollback images. Do not include unrelated branches or turn on autonomous application sending.

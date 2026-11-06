# Landing residency and application positioning

Base: `96898a1e3ef53d19c4fbd424c140390dfb4876fd`. Branch: `codex/landing-residency`.

The founder confirmed that AISE is an official ABB Innovation resident startup through the sixth incubation programme. The hero now displays this as text, without borrowing an official logo or claiming investment or product endorsement. This residency statement comes from the founder; public corroboration was not established in this pass.

The existing headline, orbital illustration, animations, employer section and navigation remain. The hero now highlights the Harvard-based CV structure and vacancy-specific motivation letter. Interview positioning describes the purpose of better applications, without numerical uplift or a guarantee. Both document-generation benefits remain labelled “Tezliklə”, consistent with the disabled initial-release gate.

Only landing copy/styles and the existing section-title test were changed. No backend, database, feature flag or production changes.

For inspection, the three landing files were copied into the running `aise-deployment/apps/web-preview` directory. The deployment checkout's tracked files were left untouched. Restarting its preview script will replace that copy from its older source; integrate this branch before restarting if these edits should persist there.

The frozen `1e7dff8` release images do not contain these edits. Keep their existing rehearsal evidence intact. Including this follow-up in production requires review/integration and a new web image with accurate provenance; no image was rebuilt here.

# Greenhouse / Wolt source review — 28 October 2026

Greenhouse's official Job Board API documentation says its GET endpoints are public and do not require authentication. Wolt's own careers site currently lists the Baku job `6693347` and its job page links to the Wolt Greenhouse board. Public access does not by itself establish AISE's right to create and republish a database, so the Wolt source remains `ROBOTS_ALLOWED_TERMS_PENDING`, disabled and unscheduled until an applicable reuse decision is documented.

Primary evidence: [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html), [Wolt's own job page](https://careers.wolt.com/en/jobs/1/6693347), and [Wolt's Greenhouse posting](https://job-boards.greenhouse.io/wolt/jobs/6693347). No application was submitted.

Independent review changed the proposal as follows:

- Removed a migration audit event that could claim to have changed a pre-existing source row. The migration inserts a disabled, unscheduled source with `ON CONFLICT DO NOTHING`.
- Confirms known listings through `onListed` and uses the detail budget for new or revalidated records rather than consuming it on known rows.
- Records explicit scheduler outcomes, invokes the failed-detail callback on transport and parsing errors, and retains a retry cursor for incomplete runs. Filtered global listings do not prove a complete Azerbaijani census or justify closing absent jobs.
- Rejects listing/detail ID, title, and URL inconsistencies. A foreign explicit work location cannot be overridden by an Azerbaijani entity name. An unverified location remains unknown instead of becoming Baku.
- Keeps a source publication date separate from the time first observed; `updated_at` is not used as a publication date.

The checked-in listing fixture contains three rows, of which one is an Azerbaijani match. It is a fixture rather than a source-wide yield measurement. Production overlap, unique new employers, and current actionable additions have not been measured. Greenhouse API documentation describes public GET access but is not an AISE-specific reuse agreement.

# Optional LinkedIn public-profile reader — 21 October 2026

Follow-up to PR #105. This increment does not change checkout, pricing, application sending or institution functionality. No deployment started.

## Behavior

The import panel offers an unchecked, optional Jina AI Reader choice for an entered LinkedIn URL. Consent is bound to that URL and consumed on each attempt. A different URL or retry requires a fresh choice. Text and PDF imports do not use the provider.

The server tries the existing direct LinkedIn read first. If it fails with a handled restriction or unusable-profile error, it may use the reader only when the request contains literal boolean `allowPublicReader: true`. A 404 does not trigger recovery from possibly stale provider data. `LINKEDIN_PUBLIC_READER_ENABLED=false` disables the fallback even when consent exists.

The fixed provider endpoint receives only a validated, normalized HTTPS LinkedIn profile URL. No candidate cookies, account data, files or stored profile are forwarded. Requests ask for HTML in a JSON envelope and include DNT; this header is a request to the provider, not a guarantee about every part of its data handling. The UI, privacy notice and service-provider register disclose the optional external processing.

The adapter has one request, a 15-second timeout, a 2 MiB decoded-response limit, cancellation on oversize/error and no provider-redirect following. Existing direct fetching is bounded at 10 seconds, so the sequential import is bounded by those two requests. Provider rate limits do not cause retry loops or paid-model fallback. No API key is required by the tested basic reader endpoint. No new package dependency or self-hosted browser service was installed.

Reader results must declare the requested profile URL, a successful origin response and raw HTML containing the exact requested Person identity. Reader Markdown, article titles, wrong identities, login pages and unverifiable stubs are rejected. Existing profile parsing and review/merge preserve date precision. No imported CV or profile is saved automatically.

Also fixes scheme-less `linkedin.com/in/...` input reaching the text parser despite being accepted by the URL-aware UI.

## Evidence and limits

- Existing parser successfully read a real public-profile HTML response from Jina: exact name/headline, three roles and two schools. Reader default Markdown chose a shared article title, demonstrating why that format is not used.
- The compiled reader adapter also completed a fresh live request in 1.9 seconds, verifying the exact identity and returning three roles/two schools. This did not use the stored probe response.
- The compiled service's actual `parseImportedText` flow successfully read the same public URL directly in 1.1 seconds, returning preview data with YEAR date precision. This uses a synthetic viewer context and no database writes; it is not a production-user test.
- Unit and service/controller regressions cover explicit consent, changed inputs, strict boolean handling, direct success without provider use, 404 behavior, operator disable, wrong identity, authwall, missing HTML, streaming overflow, timeout, 429 cancellation and no writes during reviewed import.
- Consent UI rendered from the actual React component and application CSS at 390px and 1440px. Interaction behavior is covered by component/onboarding tests. This component preview is not represented as a live logged-in production journey.
- Full API: 130 suites / 2,018 tests passed. Full web: 96 files / 614 tests passed. API build and web typecheck passed. Changed import component/tests and privacy/provider pages lint clean.
- The upstream public-reader service can still reject or fail to fetch profiles. This is one public-profile sample, not evidence that all profiles or private LinkedIn data can be imported. PDF/text fallback remains available.

Public-profile probe data and screenshots are outside Git in aise-preview/live-validation-20261021. No private candidate PDFs or provider credentials are committed.

## Release handoff

Review this increment separately from PR #105. It is based on the #105 branch at 7cc7c94; merge/rebase in that order. Do not assume a queued CI run passed. After deployment, verify unchecked consent sends no reader request and a controlled opted-in import reaches the normal review screen. Existing rate limits, auth, prices and quotas are unchanged.

Primary provider documentation: https://github.com/jina-ai/reader (HTML response mode and DNT request header). No account was created or paid plan purchased during this work.

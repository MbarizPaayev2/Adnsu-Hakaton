# Launch batch verification — 11 October 2026

Continuation of PR #53. The saved admin dependency mocks and ordinary vacancy edit fix now pass. Candidate uncertain-email retries are capped at two, with an exact generation/counter comparison preventing concurrent or stale retries from exceeding the cap. The additive migration initializes existing retry counters to zero.

Verified on the working tree before the final push:

- API: 95 unit suites, 1,570 tests passed; Nest build passed.
- Web: 69 files, 444 tests passed; TypeScript passed.
- Real API/Postgres integration: 65 tests passed across founder controls, email applications and native applications. A dedicated `aise_release_test_*` database was migrated from empty and dropped afterwards. Provider output and outbound mail were fixtures; no real candidate or employer was contacted.
- Retry checks cover exhaustion, one remaining retry with concurrent submissions, and unchanged monthly usage.

The integration guards accept only the original local test database or explicitly named disposable release databases on 127.0.0.1:5433. No shared database was modified.

Release completion requires CI on the exact final revision, merged-image builds, a fresh verified off-host backup and restore, deployment verification, and the authorized former-operator removal. Production evidence will be recorded after execution; these local tests do not claim deployment or live purchases.

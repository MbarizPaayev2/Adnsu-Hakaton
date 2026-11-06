# Writer release continuation — 10 October 2026

PR #39 was green at `0f070e0`, but its release journey had never run. Production had not received that PR; the Azerbaijani writer and email applications were still off.

## Corrections before release

- An unavailable, malformed or skipped model fact-checker now rejects the proposed letter and uses the existing composed fallback. The earlier code accepted mechanically valid prose without the checker, despite the adversarial evaluation showing that mechanical checks missed 11 of 40 unsupported insertions.
- CV polishing now observes the overall deadline as well as each request timeout. Unverified bullets preserve the candidate's original wording.
- The release runner now propagates either phase's failure, refuses missing state, checks readiness and preserves failure status through bounded cleanup. An apostrophe in a Bash parameter error message previously swallowed subsequent source lines and prevented startup. Five Linux mock tests cover success and failure propagation; CI runs them.
- Signup in the journey explicitly accepts terms. The test labels real APIs/providers separately from supplied match scores and portal descriptions.
- `host-config.sh flag` now supports the documented writer rollback and candidate-approved email switch. It does not support autonomous application switches.

## Example package

The founder supplied 30 personal letters and a v2 fictional example package. Those personal letters are style references, not facts about other candidates. The package's AI-produced preference labels are not independent human judgements. A purported good retail example added actions absent from its input, so it must not be copied as a factual gold answer.

Two short fictional demonstrations were adapted with every candidate claim present in their own input. They preserve helper roles and modest stated motivation. They contain no founder biography. They are evaluation-only prompt examples, not model training; they never enter the fact-checker's current-candidate evidence. Tests reject borrowing an example's metric into another candidate's letter. They remain **off in the production prompt** because the paired comparison did not establish an improvement. Holdout inputs have not been used for prompt development.

The paired real-provider comparison exposed an accepted Hindi word (`हूँ`) inside Azerbaijani prose. The word-existence check inspected Latin tokens only. The language gate now rejects new non-Latin prose and mixed-script words, while preserving foreign-script names explicitly supplied in the current source. Regression tests cover the observed Hindi word, Cyrillic prose, a homoglyph and legitimate foreign employer names. This is a code correction, not proof of idiomatic Azerbaijani.

## Verification and remaining work

Full API unit suite after the supplied-name suffix correction: 85 suites, 1,357 tests passed. The correction preserves Azerbaijani case suffixes on source-supplied foreign names without accepting new foreign prose. API typecheck passed before this narrow correction. Release-runner mock tests: five passed on Linux. These are code checks, not a new real-model quality result or native-reader approval.

Still required before rollout: exact-head CI, provenance-labelled images, the isolated real-provider journey, a fresh restore-proven backup, deployment verification and a genuine provider delivery event on the production webhook. Synthetic events signed with the real secret test signature handling; they do not establish provider delivery. Admin MFA still requires the founder's authenticator.

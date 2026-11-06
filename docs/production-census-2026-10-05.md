# Vacancy census — why the catalogue shows 1,174 (5 October 2026)

Read-only SQL (`~/aise-preview/census-2026-10-05/census.sql`, outside Git) run against production and against the older acquisition database. No count was changed.

## Production (`aise`, 15:00 UTC)
| Step | Rows |
|---|---|
| Stored imported jobs (all from `glorri`) | 1,370 |
| Closed by a complete listing | 7 |
| Active | 1,363 |
| Active but past their deadline (not public) | 189 |
| Hidden / marked duplicate | 0 / 0 |
| **Public-eligible (the visible counter)** | **1,174** |
| Native employer vacancies in the catalogue | 0 |

The public API total equals the database predicate (ACTIVE, not hidden, not a duplicate, deadline empty or in the future, plus approved native vacancies): 1,174 = 1,174. Of those, 950 were verified in a complete listing run and 224 have unknown freshness. Every one links to `jobs.glorri.com`; the application method of all of them is `UNKNOWN`. Only Glorri's importer is scheduled; the other 21 registry sources are unscheduled (5 more are `RESTRICTED` and disabled, the rest are `ROBOTS_ALLOWED_TERMS_PENDING`).

## Where "1,800+" came from
The earlier acquisition database (collected 2–4 October for trials, never loaded into production) holds 2,727 stored postings across 13 sources, of which **1,783 passed the same public predicate on that database**: HelloJob 531, Boss 399, Work 386, SmartJob 283, ABB 54, Xsolla 38, Pasha Insurance 35, SOCAR 31, Azercell 10, Yelo 8, Pasha Holding 5, PwC 2, Halliburton 1. That is the "1,800+" figure. It is a different data set, not a production shortfall:
* none of those sources is scheduled or reviewed for terms of use (`ROBOTS_ALLOWED_TERMS_PENDING`), so they were deliberately not loaded;
* 1,599 of the 1,783 (HelloJob, Boss, Work, SmartJob) have **unknown freshness**: those boards never prove a complete listing, so closed postings cannot be detected; the number is an upper bound, and by 5 October it is older still;
* 896 further rows were already past their deadline.

## Conclusion
No ingestion or catalogue defect was found: 1,174 is exactly what the production data and the predicate give. The visible count was not altered and no source was enabled. Raising inventory is a founder decision (terms review per source, then enabling one low-risk source at a time); the acquisition data shows 127 HelloJob, 145 Work, 91 Boss, 25 SOCAR and 6 SmartJob postings with an explicit employer e-mail, which would matter for e-mail applications.

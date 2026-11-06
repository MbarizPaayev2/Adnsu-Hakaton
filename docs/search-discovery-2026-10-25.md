# Search discovery and useful career guides — 25 October 2026

## Objective and observed baseline

Help Azerbaijani jobseekers find an answer, prepare one useful piece of their application, and then choose a relevant AISE next step. The existing four articles were publicly reachable at `/blog`, but the separate homepage navigation and homepage footer did not link to them. The index also placed a large notice before the article cards on mobile. This increment fixes discovery before adding content.

The existing public `robots.txt` allows `/` and blocks dashboard, admin and API paths. No crawler-specific override is added: a broad `OAI-SearchBot Allow: /` group could override the generic private-path restrictions. Simulated user-agent requests are HTTP smoke tests, not proof of actual crawler-IP access or indexing.

## Intent and keyword map

These are **search-intent hypotheses**, informed by Azerbaijani search-result inspection and the product's candidate/academy audience. Search Console, Keyword Planner volumes, rankings and conversion baselines were not available; no “most searched” or numerical traffic claim is made.

| Audience / intent | Query family | Canonical guide | Useful action | Product next step |
| --- | --- | --- | --- | --- |
| Junior data / BI applicants with project evidence | junior data analyst CV, SQL Power BI layihə, BI developer CV nümunəsi | `/blog/junior-data-analyst-cv-sql-power-bi` | Build a CV project bullet from own facts, real scope and optional verified result | Browse vacancies or build a profile |
| Junior frontend / backend applicants | junior proqramçı CV, GitHub portfeli, CV göndərərkən mövzu, iş müraciəti e-poçtu | `/blog/junior-proqramci-cv-github-muraciet` | Build an email subject/body from one real project; respect employer's exact subject instruction | Browse vacancies or register |
| Mid / senior specialists | senior CV nümunəsi, mid level CV, CV nailiyyətlər, texniki qərar müsahibəsi | `/blog/mid-senior-cv-nailiyyet-qerar-tesir` | Separate decision, attribution, outcome and verification; copy a CV bullet and expand interview preparation questions | Browse vacancies or build a profile |
| General application preparation | CV necə yazılır, ATS uyğun CV, müsahibəyə hazırlıq STAR, motivasiya məktubu necə yazılır | Existing four canonical guides | Checklists, conditional examples and cross-links | Relevant guide or vacancies |

No duplicate pages are created for unaccented spellings. On-page article search folds Azerbaijani diacritics, so `musahibe` finds `müsahibə`; search-engine canonical pages retain natural Azerbaijani copy.

## Implementation

- Visible article links in both actual homepage and shared marketing navigation, homepage footer and dashboard navigation.
- Homepage cards feature the three interactive guides. Searchable seven-guide index with junior and mid/senior filters; compact note after the cards.
- Server-rendered article text, short answers, real heading anchors, contents navigation and related guides selected by topic overlap.
- Public tools require no login, provider/model calls, file upload or email dispatch. Inputs stay in component state, are excluded from PostHog autocapture with `ph-no-capture`, and are not written to the candidate's profile. Nothing fills in invented skills, metrics, seniority or commercial experience.
- Copy state reports actual clipboard success/failure and clears stale feedback after edits. Optional unfilled evidence remains a preparation question, not a CV claim.
- Canonicals and permanent redirects for aliases/case variants; sitemap includes all seven articles and public company/institution pages, excludes login/signup forms.
- Organization/WebSite identity, visible-content-aligned BlogPosting/BreadcrumbList data, language, dates and article share images. Dates are maintained metadata, not fabricated per-request freshness.
- Branded 1200×630 PNG share images use code-native forest/lime artwork and render Azerbaijani glyphs. No external image or font fetch is required by the image code.
- No changes to prices, quotas, payments, application consent or institution/Telegram pilot features.

## Evidence and boundaries

- Web suite after third guide: 98 suites / 627 tests passed; TypeScript passed.
- Targeted lint: no errors; existing root-layout Google-font warning remains unrelated to this change.
- `scripts/check-public-guides.mjs` checks all seven public HTML pages, canonical links, article schema, sitemap inclusion, each PNG's signature/dimensions, alias 308 redirects, homepage discovery and seven SSR index links. Run with `GUIDES_BASE_URL=http://127.0.0.1:3108` for local preview; omit for production.
- Browser checks at 390px and 1440px: index discovery, senior form layout, synthetic senior evidence composition, junior evidence composition and copy success. Generated PNG checked visually for Azerbaijani text and brand palette.
- Runtime test results establish behavior, not content rankings or hiring outcomes. No indexing, AI citation, measured keyword volume, organic conversion lift or hiring improvement is claimed.

## Acquisition measurement after launch

Use Search Console page/query data for the canonical guides: impressions, clicks, CTR and actual queries, segmented by Azerbaijan where available. Follow existing consent-aware analytics for guide visits and registration/navigation; do not capture draft text. Review the first data after sufficient impressions rather than changing titles daily. Improve pages with observed impressions but weak relevance/CTR, and expand only where real queries and candidate questions show unmet needs.

Search Console ownership/sitemap submission and Cloudflare verified-crawler policy require access not provided in this increment. Public crawlability is checked; actual indexing and crawler-IP delivery remain external verification tasks. No special AI text file or hidden keyword block is introduced.

## Primary references

- [Google: AI features and your website](https://developers.google.com/search/docs/appearance/ai-features): normal SEO and people-first content remain relevant; no special AI optimization is required.
- [Google: SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide): crawlable links, clear page titles and useful organization.
- [OpenAI: crawler documentation](https://developers.openai.com/api/docs/bots): OAI-SearchBot is search-related and independent of GPTBot's training control. Allowing a user agent is not a promise of citation.
- [Harvard: resumes and cover letters](https://careerservices.fas.harvard.edu/channels/create-a-resume-cv-or-cover-letter/): concise, relevant evidence and tailored application materials.
- [Dövlət Məşğulluq Agentliyi: CV yarat](https://dma.gov.az/layiheler/sosial-layiheler/cv-yarat) and [its career page](https://dma.gov.az/agentlik/karyera): local career context and following the organization's specified application route.

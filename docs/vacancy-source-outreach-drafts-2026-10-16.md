# Vacancy source outreach drafts (16 October 2026)

**DRAFTS: not sent.** Nothing here has been sent to anyone. Each needs the founder's decision on whether, when and to whom to send it.
No address below is guessed: a draft names a recipient only where the organisation publishes that address itself; otherwise it says "their published partnership/HR contact".

## 1. Job boards whose terms prohibit automated collection

For: Work.az, Boss.az (terms 8.3), Busy.az (/qaydalar), JobSite.az, BirJob (/terms requires a written agreement for bulk republication), Glorri (§8–9; see `docs/glorri-partner-request.md` for the fuller Glorri version).

> Subject: Vacancy feed partnership request from AISE (aisehr.com)
>
> Hello,
>
> AISE (aisehr.com) helps candidates in Azerbaijan find vacancies that match their CV and prepare their applications. Candidates always apply on the
> employer's or your own page; we link back to the original posting and show your name as the source.
>
> Your terms do not allow automated collection, so we do not collect from your site. We would like to ask whether you offer, or would consider, an
> official vacancy feed or API for partners, and on what conditions (attribution, link-back, caching, how closed vacancies are signalled, and any fee).
>
> The fields that matter to candidates are: vacancy ID, title, employer, city, description, publication date, deadline, status, and the
> application route as the employer states it (link, or an e-mail address only when the employer published one).
>
> We would also be glad to send candidates to your site rather than to a copy. If a referral arrangement suits you better than a feed, please tell us.
>
> Kind regards,
> [Founder name], AISE

## 2. Employers whose career site cannot be read automatically

For employers whose sites returned a bot challenge or HTTP 403 to a polite, robots-first request: Azersun, Kontakt Home, AZAL, bp Azerbaijan, Bakcell,
Baku Electronics, Bank of Baku, Atəşgah, Azər Türk Bank, ASCO, ADY, Nestlé Azerbaijan, JTI. We do not try to get around these protections.

> Subject: Publishing your vacancies on AISE at no cost
>
> Hello,
>
> AISE (aisehr.com) lists vacancies from Azerbaijani employers for candidates and links each one back to the employer's own application page.
>
> Your career site blocks automated readers, which we respect, so your vacancies are currently missing from AISE. If you would like them included,
> any one of these works for us, at no cost:
> - a public feed (RSS, JSON or XML) of your open vacancies;
> - allowing our collector (user agent "AISEVacancyCollector/1.0 (+https://aisehr.com)", one request at a time, robots.txt honoured) on your vacancy pages; or
> - posting your vacancies directly in AISE's employer area.
>
> We never apply on a candidate's behalf without their approval, and we remove or pause a source on request.
>
> Kind regards,
> [Founder name], AISE

## 3. Organisations that publish a CV inbox but no vacancy list

AZCON Holding (recruitment@azcon.az, published on azcon.gov.az for group companies including AZAL, ADY, Bakı Metropoliteni, BakuBus), Xalq Bank
(cv@xalqbank.az, on its career page), Holcim Azerbaijan (aze-hr-cv@holcim.com, on holcim.az/az/karyera). These addresses are general talent-pool
inboxes, not vacancy application addresses, so AISE does not attach them to any posting.

> Subject: Listing your current vacancies on AISE
>
> Hello,
>
> Your site invites CVs at [their published address] but does not list current openings. AISE (aisehr.com) can show your open vacancies, with your
> own application instructions, to candidates across Azerbaijan, including the regions. If you share a list or feed of current openings, or post them
> in AISE's employer area, we will publish them with your name and your stated application route. There is no cost.
>
> Kind regards,
> [Founder name], AISE

## 4. Public sector and international organisations

- **ReliefWeb (UN OCHA):** its API now requires a pre-approved `appname` (since 1 Nov 2025) and api.reliefweb.int/robots.txt disallows all crawlers.
  Action: apply for an appname through ReliefWeb's own API registration form, describing AISE's use (Azerbaijan jobs, attribution, link-back). This is a
  registration, not outreach to a person, but it still waits for the founder's go-ahead because it commits AISE to ReliefWeb's terms.
- **State Employment Agency (DMA), DİM, TƏBİB, ASAN:** their sites timed out from the probe network (possibly geo/IP filtering). Before any request,
  re-probe from an Azerbaijani network. If the e-sosial / "E-əmək birjası" vacancy bank has a public open-data export, that is the preferred route;
  otherwise a data-sharing request to the agency would be the next step (draft on request).
- **UNDP:** jobs.undp.org disallows all crawlers. No action; UN Azerbaijan's own site lists jobs client-side and is in the backlog.

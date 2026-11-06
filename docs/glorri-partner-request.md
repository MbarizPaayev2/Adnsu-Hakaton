# Glorri partner-integration request

**DRAFT: not sent. It needs the founder's authorisation before anyone sends it.**
Prepared 29 September 2026. Address it to Glorri's partnership or legal contact, whichever they name.

## Why we are asking

AISE (aisehr.com) helps candidates in Azerbaijan find vacancies that match their CV and prepare their applications.

Glorri's Terms of Service (last updated 17 November 2021) prohibit the following without permission:
- **§9:** using "any robot, spider, or other automatic device, process, or means to access Service for any purpose";
- **§8:** reusing Content "for commercial purposes".

The terms do not describe any API or partner route. We want to work with Glorri on terms Glorri approves. We do not want to rely on the public website.

**What AISE does today, stated plainly:**
- **Hourly import.** An importer reads Glorri's public vacancy listings every hour and shows them to AISE candidates, with a link back to Glorri. We have no written permission for this. We ask for it below, or for the feed Glorri prefers, and we will change or stop the importer as Glorri directs.
- **Applications.** AISE has **not** submitted any application to Glorri. Candidates apply on Glorri themselves.
- **Automated application.** AISE has built candidate-approved automated application, tested only against our own simulated form. It stays switched off for Glorri until Glorri agrees in writing.

## What we are asking Glorri for

### 1. Vacancy feed

- Written permission to show Glorri vacancies in AISE, and the conditions: attribution, link-back, caching, and how long closed vacancies may stay visible.
- An official feed or API, with:
  - endpoint;
  - authentication;
  - rate limits;
  - change or delta support;
  - notice of closed or removed vacancies.
- Fields:
  - vacancy id and slug;
  - company id and slug;
  - title and description;
  - location;
  - salary, where published;
  - deadline;
  - status;
  - the canonical vacancy and application URLs;
  - the last-updated time.

### 2. Submitting applications

AISE would submit only for a candidate who has reviewed and approved each application. Either of these would work:

- **(a) An application API**, covering:
  - the endpoint and authentication;
  - the request schema: profile fields, screening questions and answer types, and the motivation letter;
  - file rules: CV formats and sizes, and whether the identity-document photo is really required;
  - an idempotency key or duplicate handling;
  - error codes: closed vacancy, duplicate, validation, rate limit.
- **(b) Written permission to use the candidate-facing form on the candidate's behalf**, with Glorri's conditions:
  - identification of AISE's traffic;
  - rate limits;
  - IP or host restrictions;
  - how one-time verification codes should be handled.

AISE never tries to pass a CAPTCHA or any other human check. It stops and asks the candidate to apply themselves.

### 3. Candidate consent and data protection

- The exact declaration text and version that Glorri shows next to its data-privacy checkbox, and the privacy-policy URL. AISE shows this exact text to the candidate, records which version they accepted, and stops if the live text differs.
- Whether consent collected by AISE for Glorri's declaration is acceptable to Glorri, or whether the candidate must also confirm on Glorri.
- Roles (controller or processor), a data-processing agreement if Glorri requires one, retention, and how withdrawal and deletion requests are passed between us.

### 4. A test environment

We need **one** of these:
- a Glorri sandbox or staging host;
- **or** an approved test vacancy, with a cooperating recipient (an employer contact) who will confirm what they received.

We also need:
- a test one-time code, or a way to receive one;
- the rules for test data (AISE uses synthetic candidates);
- a named technical contact.

### 5. Proof of receipt

AISE marks an application as "received" **only** when Glorri's own evidence confirms it. Anything else is shown to the candidate as "delivery unconfirmed". We need:
- what confirms receipt: an API response with a reference, or a confirmation page, with its URL and wording and the reference format, or an email;
- how Glorri shows a refusal: a closed vacancy, a duplicate, invalid data;
- if available, status callbacks such as received, viewed or rejected, and a way to verify a given application reference.

### 6. Operations

- Expected pilot volume. We propose a small, invited group, with at most 5 automated applications per candidate per day.
- An incident contact.
- How Glorri would like us to pause. AISE has an operator switch that stops all automated submissions at once.
- Use of Glorri's name and logo.

## What AISE already guarantees

These are built and tested against a simulated form:
- **Consent comes first.** Nothing is sent before the candidate sees the destination, Glorri's declaration, the exact fields and documents, and approves each application.
- **Every page is checked.** The declaration and destination are verified again on the live form. Only allow-listed Glorri hosts are used.
- **Nothing is sent twice.** A double click, a retried request or a lost reply never sends an application twice.
- **Uncertain means unconfirmed.** When delivery is uncertain, the application is marked "unconfirmed" and is never automatically resent.
- **There are limits.** Automated applications are capped per candidate per day, and an operator can pause every submission instantly.
- **Data is kept to a minimum.** Retained copies of documents expire. Only a reference and hashes of Glorri's confirmation are stored.

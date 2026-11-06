# Chrome Web Store: package, listing and disclosures (12 Oct 2026)

**Status: prepared, NOT submitted and NOT available in the Store.** Until Google approves a submission the extension is installed from the website
(download the ZIP, "Load unpacked"). Nothing in the product may say "available in the Chrome Web Store" before approval.

## What is submitted
- Package: `node apps/extension/scripts/pack.mjs <dir>` → `aise-agent-extension.zip` (Manifest V3, version 0.2.0, 11 files, ~21 KB, no remote code,
  no build step: what is reviewed is what ships). Icons 16/32/48/128 are included.
- Verified: the packed ZIP, extracted, loads as an unpacked extension in Chromium; service worker starts; popup opens; `manifest.json` is at the root
  of the folder (production download re-checked after release).

## Account and registration requirements (needs the owner)
1. A Chrome Web Store **developer account** (Google account of the publisher) with the one-time **registration fee (US$5)**; 2-step verification on
   the account; a verified contact e-mail. This is a payment and a sign-up the founder must do; it was not done here.
2. Publisher identity (name/address as shown in the listing) and a **privacy policy URL**: `https://aisehr.com/privacy` (now has a section
   "Brauzer köməkçisi (genişlənmə)").
3. Visibility: choose **Unlisted** (installable only by link) at first; it still goes through review.
4. Review: broad host permissions and form filling mean a manual review; expect days, and possible questions about the permissions below.

## Listing text
**Name:** AISE Agent
**Summary (≤132):** AISE hesabınızda təsdiqlədiyiniz müraciətləri öz brauzerinizdə portal formasına doldurur və yalnız icazənizlə göndərir.
**Description (AZ):** AISE Agent, AISE hesabınızdakı təsdiqlənmiş CV və cavablarınızla iş müraciəti formalarını öz brauzerinizdə doldurur. Hər müraciəti
əvvəlcədən AISE-də görür və təsdiqləyirsiniz; göndəriş yalnız təsdiqdən sonra, birdəfəlik icazə ilə baş verir. Parolunuzu və ya cookie-lərinizi oxumur.
Premium plana daxildir; hələlik Lever portalları ilə işləyir. Kompüterdə Chrome və ya Edge tələb olunur.
**Single purpose:** Fill and, only after the signed-in candidate's explicit approval, submit job applications on supported employer portals using data the
candidate approved in their AISE account.

## Permission justifications
| Permission | Why |
|---|---|
| `storage` | Keeps the device token received at pairing and the status of the running application, across browser restarts. |
| `alarms` | Wakes the service worker on a schedule to ask AISE whether approved work is waiting (Manifest V3 workers do not stay alive). |
| `tabs` | Opens and reads the address of the one portal tab belonging to an approved application, and detects the portal's confirmation page. |
| Host `https://aisehr.com/*` | Calls AISE's API with the device token (pairing, work, results). |
| Host `https://jobs.lever.co/*` | Content script reads the application form and fills the approved values on Lever-hosted postings. |

## Privacy practices tab (Store dashboard)
- Data types handled: **Personally identifiable information** (name, e-mail, phone and answers the candidate approved, received from AISE to fill the
  form); **Authentication information** (the device token); **Website content** (the structure of the application form and the confirmation URL).
- Not collected: health, financial, location, personal communications, browsing history, passwords, cookies.
- Certifications: not sold; not used or transferred for unrelated purposes; not used for creditworthiness or lending.
- Remote code: none. Data is sent only to aisehr.com (AISE) and, as the candidate's approved application, to the employer's own portal.

## Screenshots needed (1280×800, 1–5)
Pairing code on the dashboard; the popup showing "Qoşulub"; the review/approval screen; the application timeline. (The UI e2e run writes these to
`SHOTS_DIR`; they are not committed.)

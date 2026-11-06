# Founder guides and proposals (7 October 2026)

Plain-language steps first; engineering proposals after. Nothing here asks you to paste a secret into chat: every secret goes through the private prompt
`bash ~/aise-preview/enter-secret.sh <resend|dodo|google>` (it hides what you type, saves a private file, and the engineer installs and deletes it).

## A. Resend (e-mail)
Done by the engineer: the DNS records, the sending-only key installed on the server, the website restarted and healthy. The key you pasted into chat is now in the chat history: **after everything works, replace it** (steps below) and delete the old one.
1. Open resend.com → **Emails**. Find the message with subject "AISE delivery test …" sent today. Its status should say **Delivered**. If it says Bounced, Failed or Delayed, tell the engineer the exact word.
2. Open your **ceo@aisehr.com** inbox (also check Spam). Tell the engineer whether the message arrived.
3. Replace the exposed key: Resend → **API Keys** → **Create API Key** → name `aisehr-production-2`, permission **Sending access**, domain **aisehr.com** → Add. In Terminal run `bash ~/aise-preview/enter-secret.sh resend` and paste the new key at the prompt. Then Resend → API Keys → delete the old key (the one pasted in chat). Tell the engineer "resend entered".

## B. Dodo (payments stay OFF)
1. Revoke the exposed key: Dodo dashboard → **Developer** (or Settings) → **API Keys** → find the key you pasted in chat → **Delete/Revoke**. If you cannot tell which one it is, revoke all and create new ones.
2. Switch the dashboard to **Test mode** (toggle at the top or side). Create a **test** API key. Under **Webhooks** create a test endpoint (URL can stay empty for now; the engineer will give one) and copy its **signing secret** (starts with `whsec_`).
3. In Terminal run `bash ~/aise-preview/enter-secret.sh dodo`, paste the test API key, then the test webhook secret.
4. Test products: create **Plus** and **Premium** subscription products in test mode, price currency **AZN**, 8.00 and 15.00 per month. If Dodo does not let you choose AZN as the price currency, do not worry: tell the engineer what it offers, because that decides whether "8 AZN" can honestly be promised (Dodo's own text says converted prices vary with exchange rates).
5. Do not turn payments on. The engineer checks the exact amount and currency on the test checkout page before any price is promised on the website.

## C. Google sign-in
1. Go to console.cloud.google.com, sign in with the company Google account, create a project named `AISE`.
2. **APIs & Services → OAuth consent screen**: User type **External**; app name `AISE`; support e-mail ceo@aisehr.com; authorised domain `aisehr.com`; privacy policy `https://aisehr.com/privacy`; terms `https://aisehr.com/terms`; developer contact ceo@aisehr.com. Save.
3. **Credentials → Create credentials → OAuth client ID** → type **Web application**, name `AISE web`. **Authorised JavaScript origins:** `https://aisehr.com`. **Authorised redirect URIs:** `https://aisehr.com/api/auth/callback/google`. Create.
4. Copy the Client ID and Client secret only into the private prompt: `bash ~/aise-preview/enter-secret.sh google`. Tell the engineer "google entered". Later (when ready for the public) press **Publish app** on the consent screen so any Google user can sign in.

## D. Admin MFA and password-manager custody
Put these in your password manager (1Password, Bitwarden or similar), then delete the plain files:
| What | Where it is now | Why it matters |
|---|---|---|
| Admin MFA key | `~/aise-preview/secrets-handoff/admin-mfa-key.env` | losing it disables every enrolled authenticator |
| **Backup private key** (single copy) | `~/.config/aise-backup/age.key` | without it no backup can ever be restored — the most important item; keep a second copy offline |
| Database password | `POSTGRES_PASSWORD` in `/srv/stacks/aise/.env` on the server | read it in a private terminal; never in chat |
| Cloudflare token, R2 keys, Resend, Dodo, Google | files from the private prompt, then the dashboards | each can be re-created, but note where |
MFA enrolment: open `https://aisehr.com/admin`, sign in with the admin account, scan the QR code with an authenticator app (not SMS), save the recovery codes in the password manager, then tell the engineer so the MFA key file can be deleted.

## E. Proposal: a restore check that does not need your laptop
**Why it exists.** Backups are encrypted so the server cannot read them. The only real proof they work is to decrypt and restore one somewhere else. Today that is `scripts/mac-verify-backup.sh` on your Mac, and the monitor raises an alert if no passing proof is newer than **8 days**. That limit is a *temporary* arrangement, not a product rule; it is a setting (`MAX_RESTORE_AGE_DAYS`).
**What was prepared.** The same script now has an R2 mode (`AISE_SOURCE=r2`): it reads the newest set straight from the bucket, restores it in disposable containers and records the result (destination `bucket`) in the server's status file, so the monitor sees it. It was tested here against a local stand-in for the bucket, not yet against R2 itself.
**Recommended arrangement (any one always-on machine that is not the production server):** a small VM or a spare always-on computer holding (a) the backup private key in a root-only file, (b) a **read-only** R2 token (Cloudflare → R2 → Manage API tokens → Object Read only, this bucket), (c) a dedicated SSH key that can only run the status tool on the server (a `command=` restriction in `authorized_keys`), (d) a weekly cron/launchd entry running the script. The ABB machine could be that host once it exists, provided it is not the production host. Until then: keep the Mac routine (run it when you have the laptop on, at least every 8 days), or ask for `MAX_RESTORE_AGE_DAYS=35` and do it monthly — a weaker guarantee, so it should be your explicit choice.
**Not changed:** the working backup schedule and the health schedule.

## F. Proposal: a small, bounded model comparison for Azerbaijani documents
**Goal.** See whether an alternative model writes more natural Azerbaijani than the current one (`nvidia/nemotron-3-super-120b-a12b`). No promise that any model will; the comparison can end with "neither is good enough", in which case the remedy is templated wording for CVs (the model only chooses facts) and a stricter reject-and-regenerate rule.
**Design.** The same synthetic candidate and the same 2 public vacancies for both models, 1 CV + 1 letter per vacancy = **4 documents per model**; samples shown to a native reader blind (neutral names, shuffled), scoring facts, language and PDF layout separately. Decision rule written in advance: adopt only if the reader scores language ≥ 4 of 5 on every document, no meaning errors, all facts true.
**Request count and cost ceiling.** A document is 1 request on the first try and at most 3 by the product's own limit. Current model: 4 documents → 4 requests (≤ 12). Alternative: 4 → 4 (≤ 12). **Total 8 expected, 24 at most.** Measured size ≈ 4,000 tokens per request, so ≤ 100,000 tokens in the worst case. Cost = tokens × the alternative's price: at $1 / $10 / $30 per million tokens the ceiling is about $0.10 / $1 / $3. A hard cap of **30 requests and $5** is proposed.
**Authorization.** Already used and within earlier authorization: 14 requests on the current model today (7 runs of one CV + one letter: 5 evaluation runs and 2 that produced the review samples). **Not run:** the alternative model needs a provider key and your explicit approval of the cap above; nothing was spent on it.

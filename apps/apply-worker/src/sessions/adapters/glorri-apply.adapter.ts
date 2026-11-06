import type { Page } from 'playwright';
import { createHash } from 'crypto';
import {
  ConfirmResult,
  FieldDescriptor,
  FillResult,
  GlorriFillData,
  OtpResult,
  PrivacyAuthority,
  SendObservation,
} from './glorri-apply.types';

/**
 * This file ports the exact Playwright selectors/logic validated end-to-end
 * against the real jobs.glorri.az apply form in the reference prototype
 * (fill.js) - the Mantine dropdown-selection pattern, the two ordered file
 * inputs, the step-3 radio/checkbox pattern and the OTP-field heuristic. See
 * individual functions for what was ported verbatim vs. adapted for this
 * service's use case (targeted re-fills, missing-field reporting instead of
 * guessing, etc). Its network-blocking dry run was replaced: a dry run here
 * never activates the final control.
 *
 * IMPORTANT / non-negotiable: nothing in this file ever clicks the review
 * modal's "Təsdiq et və göndər" (confirm and send) button from fillApplication
 * or applyAnswers, dry run never clicks it at all, and nothing here submits
 * an OTP automatically. Those are only ever triggered by
 * confirmSubmit/submitOtp, which the sessions controller only calls in
 * response to an explicit candidate-initiated attempt forwarded by apps/api.
 * This file also never reads from or writes to the hidden
 * `g-recaptcha-response` textarea - it is explicitly skipped wherever
 * textareas are enumerated.
 */

const OTP_SELECTOR =
  'input[name*="otp" i], input[id*="otp" i], input[autocomplete="one-time-code"], input[maxlength="6"], input[placeholder*="kod" i], input[placeholder*="code" i]';

const CONTINUE_BUTTON_NAME = /davam et/i;
const CONFIRM_SEND_BUTTON_NAME = /təsdiq et və göndər/i;
const VERIFY_BUTTON_NAME = /(təsdiq|verify|confirm)/i;

// The worker's own copy of the destination allowlist (apps/api
// destinations.ts is authoritative). A URL that fails here is never opened,
// whatever apps/api sent.
const ALLOWED_APPLY_HOSTS = ['jobs.glorri.com', 'jobs.glorri.az'];

export function isAllowedApplyUrl(applyUrl: string): boolean {
  try {
    const url = new URL(applyUrl);
    return url.protocol === 'https:' && ALLOWED_APPLY_HOSTS.includes(url.hostname)
      && /^\/vacancies\/[a-z0-9-]+\/[a-z0-9-]+\/apply$/i.test(url.pathname) && !url.search && !url.hash;
  } catch {
    return false;
  }
}

/** Must match apps/api/src/external-apply/destinations.ts noticeFingerprint. */
export function noticeFingerprint(declarationText: string, url: string): string {
  const normalized = declarationText.normalize('NFC').replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(`${normalized}\n${url.trim()}`).digest('hex');
}

function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Visible human-verification challenges. AISE never tries to solve or bypass
// one: it stops and the candidate applies on the site themselves. The
// invisible reCAPTCHA badge (anchor iframe with size=invisible) and the hidden
// g-recaptcha-response textarea do not count.
const CHALLENGE_SELECTORS = [
  'iframe[src*="recaptcha/api2/bframe"]',
  'iframe[src*="recaptcha/enterprise/bframe"]',
  'iframe[src*="recaptcha/api2/anchor"]:not([src*="size=invisible"])',
  'iframe[src*="recaptcha/enterprise/anchor"]:not([src*="size=invisible"])',
  'iframe[src*="hcaptcha.com"]',
  'iframe[src*="challenges.cloudflare.com"]',
  '[data-captcha-challenge]',
];

async function anyVisible(page: Page, selector: string): Promise<boolean> {
  const matches = page.locator(selector);
  const count = await matches.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    if (await matches.nth(i).isVisible().catch(() => false)) return true;
  }
  return false;
}

async function manualInterventionRequired(page: Page): Promise<boolean> {
  for (const selector of CHALLENGE_SELECTORS) {
    if (await anyVisible(page, selector)) return true;
  }
  return false;
}

/** The review step is reached only when its final control is actually on the page. */
async function reviewReached(page: Page): Promise<boolean> {
  return page.getByRole('button', { name: CONFIRM_SEND_BUTTON_NAME }).first().isVisible().catch(() => false);
}

function observeLimitMs(): number {
  const parsed = parseInt(process.env.EXTERNAL_APPLY_SEND_OBSERVE_MS || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20_000;
}

/**
 * Runs `action` and waits until the page's own network traffic has been
 * quiet for a moment (bounded), so a slow destination's OTP prompt, receipt
 * or rejection is observed instead of a half-loaded page. A request that
 * never finishes just ends the wait at the bound.
 */
async function actAndSettle(page: Page, action: () => Promise<void>): Promise<void> {
  let inflight = 0;
  let lastActivity = Date.now();
  const started = () => { inflight += 1; lastActivity = Date.now(); };
  const finished = () => { inflight = Math.max(0, inflight - 1); lastActivity = Date.now(); };
  page.on('request', started);
  page.on('requestfinished', finished);
  page.on('requestfailed', finished);
  try {
    const begin = Date.now();
    await action();
    const limit = observeLimitMs();
    while (Date.now() - begin < limit) {
      if (inflight === 0 && Date.now() - lastActivity >= 600 && Date.now() - begin >= 800) break;
      await page.waitForTimeout(100);
    }
  } finally {
    page.off('request', started);
    page.off('requestfinished', finished);
    page.off('requestfailed', finished);
  }
}

async function visibleAlerts(page: Page): Promise<string[]> {
  const alerts = page.locator('[role="alert"]');
  const texts: string[] = [];
  const count = await alerts.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    if (await alerts.nth(i).isVisible().catch(() => false)) texts.push((await alerts.nth(i).innerText().catch(() => '')).trim());
  }
  return texts;
}

/**
 * Attaches a file and reports whether the page raised a NEW visible alert in
 * response (the destination refused it). Alerts already on the page before
 * the upload are ignored.
 */
async function uploadRefused(page: Page, input: import('playwright').ElementHandle, filePath: string): Promise<boolean> {
  const before = await visibleAlerts(page);
  await input.setInputFiles(filePath);
  await page.waitForTimeout(500);
  const after = await visibleAlerts(page);
  return after.length > before.length || after.some((text) => !before.includes(text));
}

/**
 * Ported verbatim from fill.js's selectMantineOption: Mantine renders its
 * dropdown options in a portal listbox with role="option", and the input
 * itself matches getByLabel alongside the (also-labelled) listbox, hence the
 * `.first()` on both the input and the option - the fix that took debugging
 * against the real site to land on.
 */
async function selectMantineOption(page: Page, labelText: string, optionText: string): Promise<void> {
  const input = page.getByLabel(labelText, { exact: true }).first();
  await input.click();
  await page.waitForTimeout(400);
  const option = page.getByRole('option', { name: optionText, exact: false }).first();
  await option.waitFor({ state: 'visible', timeout: 5000 });
  await option.click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Tab').catch(() => {});
}

/** Fills every non-recaptcha textarea on the current step with the same text. */
async function fillMotivationTextareas(page: Page, motivationLetter: string): Promise<void> {
  const textareas = await page.$$('textarea');
  for (const ta of textareas) {
    const name = await ta.getAttribute('name');
    if (name === 'g-recaptcha-response') continue;
    await ta.fill(motivationLetter);
  }
}

/**
 * Finds every distinct radio-group `name` on the page and, for any group
 * without an answer in `questionAnswers`, leaves it unfilled - never guesses.
 * Matching is by the radio's `value` attribute first (exact match against the
 * supplied answer), falling back to treating the answer as a numeric index
 * into the group's radios in DOM order.
 */
async function fillAnsweredRadioGroups(page: Page, questionAnswers: Record<string, string> | undefined): Promise<void> {
  if (!questionAnswers) return;

  const radioNames: string[] = await page.$$eval('input[type="radio"]', (els) =>
    Array.from(new Set((els as HTMLInputElement[]).map((e) => e.name).filter(Boolean))),
  );

  for (const name of radioNames) {
    const answer = questionAnswers[name];
    if (answer === undefined) continue;

    const radios = page.locator(`input[type="radio"][name="${escapeAttrValue(name)}"]`);
    const count = await radios.count();
    let matched = false;
    for (let i = 0; i < count; i++) {
      const val = await radios.nth(i).getAttribute('value');
      if (val !== null && val === answer) {
        await radios.nth(i).click();
        matched = true;
        break;
      }
    }
    if (!matched) {
      const idx = Number(answer);
      if (!Number.isNaN(idx) && idx >= 0 && idx < count) {
        await radios.nth(idx).click();
      }
    }
  }
}

/**
 * Ticks the recipient's data-privacy declaration ONLY when the candidate
 * approved this exact declaration.
 *
 * `isDataPrivacyAccepted` is the recipient's own legal declaration; accepting
 * it is a statement made on the candidate's behalf. apps/api passes the
 * fingerprint of the declaration the candidate was shown and consented to.
 * The live form's declaration text and linked policy URL are fingerprinted
 * the same way; any difference means the candidate has not seen what the
 * form now says, so the box is left untouched and the fill stops.
 */
async function acceptPrivacyCheckbox(
  page: Page,
  authority: PrivacyAuthority | null,
): Promise<{ accepted: boolean; noticeChanged?: boolean; blockedField?: FieldDescriptor }> {
  const privacyCheckbox = page.locator('input[type="checkbox"][name="isDataPrivacyAccepted"]');
  if (!(await privacyCheckbox.count())) return { accepted: false };
  if (await privacyCheckbox.first().isChecked()) {
    // Already ticked earlier in this session under the same authority.
    return { accepted: true };
  }

  if (!authority) {
    return {
      accepted: false,
      blockedField: {
        fieldKey: 'isDataPrivacyAccepted',
        label: 'Qəbul edən şirkətin məlumatların işlənməsi şərtləri',
        type: 'checkbox',
      },
    };
  }

  const declaration = await privacyCheckbox.first().evaluate((el) => {
    const input = el as HTMLInputElement;
    const label = input.closest('label')
      || (input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null)
      || input.parentElement;
    const link = label?.querySelector('a[href]') as HTMLAnchorElement | null;
    return { text: (label as HTMLElement | null)?.innerText || '', href: link?.href || '' };
  });
  if (noticeFingerprint(declaration.text, declaration.href) !== authority.noticeHash) {
    return { accepted: false, noticeChanged: true };
  }

  await privacyCheckbox.first().check();
  return { accepted: true };
}

/**
 * Reports every radio-group on the page that currently has no radio checked,
 * as a FieldDescriptor. This is how "don't guess, ask the human" is
 * implemented: whatever fillAnsweredRadioGroups couldn't confidently answer
 * simply stays unchecked and shows up here.
 */
async function findUnansweredRadioGroups(page: Page): Promise<FieldDescriptor[]> {
  const groups: { name: string; label: string; checked: boolean; options: string[] }[] = await page.$$eval('input[type="radio"]', (els) => {
    // The visible question: the group's fieldset legend or radiogroup label.
    const questionOf = (el: HTMLInputElement): string => {
      const legend = el.closest('fieldset')?.querySelector('legend') as HTMLElement | null;
      if (legend?.innerText.trim()) return legend.innerText.trim();
      const group = el.closest('[role="radiogroup"]');
      const labelledBy = group?.getAttribute('aria-labelledby');
      const labelled = labelledBy ? document.getElementById(labelledBy) : null;
      return (labelled?.innerText || group?.getAttribute('aria-label') || '').trim();
    };
    const byName = new Map<string, { label: string; checked: boolean; options: string[] }>();
    for (const el of els as HTMLInputElement[]) {
      if (!el.name) continue;
      if (!byName.has(el.name)) byName.set(el.name, { label: questionOf(el), checked: false, options: [] });
      const g = byName.get(el.name)!;
      if (el.value) g.options.push(el.value);
      if (el.checked) g.checked = true;
    }
    return Array.from(byName.entries()).map(([name, g]) => ({ name, label: g.label, checked: g.checked, options: g.options }));
  });

  return groups
    .filter((g) => !g.checked)
    .map((g) => ({ fieldKey: g.name, label: g.label.slice(0, 300) || g.name, type: 'radio' as const, options: g.options }));
}

/**
 * Best-effort scrape of the review step's visible summary. fill.js never
 * captured this programmatically (it only screenshotted this step), so
 * there's no confirmed DOM structure for the review contents to key off of.
 * This grabs the review dialog's (or, failing that, the page's) visible text
 * as numbered lines - good enough for a human to eyeball what's about to be
 * submitted. Tighten into real field keys once the live modal DOM is observed.
 */
async function captureReviewPreview(page: Page): Promise<Record<string, string>> {
  const preview: Record<string, string> = {};
  try {
    const dialog = page.locator('[role="dialog"]').first();
    const scope = (await dialog.count()) > 0 ? dialog : page.locator('body');
    const text = await scope.innerText();
    text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line, i) => {
        preview[`line_${i}`] = line;
      });
  } catch {
    // Display aid only, not authoritative - leave preview empty on failure.
  }
  return preview;
}

/**
 * What the candidate is asked next: their answers, or a review of a form that
 * is really at its final step. A human-verification challenge or a form that
 * never reached its review step fails the preparation (nothing was sent).
 */
async function reviewState(page: Page, missingFields: FieldDescriptor[]): Promise<FillResult> {
  if (await manualInterventionRequired(page)) {
    return { status: 'FAILED', code: 'MANUAL_INTERVENTION_REQUIRED', errorMessage: 'The destination asks for a human verification step.' };
  }
  if (missingFields.length) return { status: 'NEEDS_INPUT', previewData: await captureReviewPreview(page), missingFields };
  if (!(await reviewReached(page))) {
    return { status: 'FAILED', code: 'REVIEW_NOT_REACHED', errorMessage: 'The form did not reach its review step.' };
  }
  return { status: 'READY_FOR_REVIEW', previewData: await captureReviewPreview(page), missingFields };
}

async function clickContinueIfEnabled(page: Page): Promise<void> {
  // Checked with count() first: isEnabled() on an absent button (already on
  // the review step) would wait for the full action timeout.
  const continueBtn = page.getByRole('button', { name: CONTINUE_BUTTON_NAME }).first();
  if (!(await continueBtn.count())) return;
  const enabled = await continueBtn.isEnabled().catch(() => false);
  if (enabled) {
    await continueBtn.click();
    await page.waitForTimeout(1000);
  }
}

/**
 * Navigates to the apply form and fills steps 1-3, stopping at the review
 * modal. Never clicks the modal's confirm-and-send button. Any exception
 * during navigation/fill is caught and returned as a FAILED result rather
 * than thrown, so the caller always gets a clean, persistable result.
 */
export async function fillApplication(
  page: Page,
  applyUrl: string,
  data: GlorriFillData,
  authority: PrivacyAuthority | null,
): Promise<FillResult> {
  if (!isAllowedApplyUrl(applyUrl)) {
    return { status: 'FAILED', code: 'DESTINATION_NOT_ALLOWED', errorMessage: 'Destination is not allowlisted.' };
  }
  try {
    await page.goto(applyUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);

    // STEP 1: personal info. File inputs appear in DOM order: CV first, ID photo second.
    const fileInputs = await page.$$('input[type="file"]');
    if (fileInputs.length >= 1 && data.resumeFilePath) {
      if (await uploadRefused(page, fileInputs[0], data.resumeFilePath)) return { status: 'FAILED', code: 'UPLOAD_FAILED', errorMessage: 'The destination refused the CV upload.' };
    }

    if (data.firstName) await page.getByLabel('Ad *', { exact: true }).fill(data.firstName);
    if (data.lastName) await page.getByLabel('Soyad *', { exact: true }).fill(data.lastName);
    if (data.email) await page.getByLabel('Email *', { exact: true }).fill(data.email);
    if (data.phone) await page.getByLabel('Mobil nömrə *', { exact: true }).fill(data.phone);
    if (data.address) await page.getByLabel('Faktiki ünvan *', { exact: true }).fill(data.address);

    if (data.citizenship) {
      try {
        await selectMantineOption(page, 'Vətəndaşlıq *', data.citizenship);
      } catch {
        // Best-effort: leave unselected rather than fail the whole fill.
      }
    }

    if (data.dob) {
      try {
        await page.getByLabel('Təvəllüd (gün/ay/il) *', { exact: true }).fill(data.dob);
      } catch {
        // Best-effort.
      }
    }

    if (data.salary) await page.getByLabel('Min. maaş tələbi *', { exact: true }).fill(String(data.salary));

    if (data.netGross) {
      try {
        await selectMantineOption(page, 'Net/gross *', data.netGross);
      } catch {
        // Best-effort.
      }
    }

    if (data.currency) {
      try {
        await selectMantineOption(page, 'Valyuta *', data.currency);
      } catch {
        // Best-effort.
      }
    }

    if (fileInputs.length >= 2 && data.idPhotoFilePath) {
      if (await uploadRefused(page, fileInputs[1], data.idPhotoFilePath)) return { status: 'FAILED', code: 'UPLOAD_FAILED', errorMessage: 'The destination refused the identity document upload.' };
    }

    await clickContinueIfEnabled(page);

    // STEP 2: motivation letter (skipping the hidden g-recaptcha-response textarea).
    if (data.motivationLetter) {
      await fillMotivationTextareas(page, data.motivationLetter);
    }

    await clickContinueIfEnabled(page);

    // STEP 3: per-vacancy questions + the recipient's data-privacy
    // declaration, ticked only under matching recorded authority.
    await fillAnsweredRadioGroups(page, data.questionAnswers);
    const privacy = await acceptPrivacyCheckbox(page, authority);
    if (privacy.noticeChanged) {
      return { status: 'FAILED', code: 'NOTICE_CHANGED', errorMessage: 'Recipient declaration differs from the approved version.' };
    }
    const missingFields = await findUnansweredRadioGroups(page);
    if (privacy.blockedField) missingFields.push(privacy.blockedField);

    // One more "Davam et" to reach the review modal.
    await clickContinueIfEnabled(page);

    return await reviewState(page, missingFields);
  } catch (err) {
    return { status: 'FAILED', code: 'FILL_ERROR', errorMessage: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Re-fills specific fields against the still-open page (e.g. after a human
 * answered fields fillApplication reported as missing) and re-captures the
 * review state. Same return shape as fillApplication.
 */
export async function applyAnswers(
  page: Page,
  updates: { fieldKey: string; value: string }[],
  motivationLetter: string | undefined,
  authority: PrivacyAuthority | null,
): Promise<FillResult> {
  try {
    for (const { fieldKey, value } of updates) {
      // The recipient's declaration is never answerable as an ordinary field.
      if (fieldKey === 'isDataPrivacyAccepted') continue;
      const escapedKey = escapeAttrValue(fieldKey);

      const radios = page.locator(`input[type="radio"][name="${escapedKey}"]`);
      const radioCount = await radios.count();
      if (radioCount > 0) {
        let matched = false;
        for (let i = 0; i < radioCount; i++) {
          const val = await radios.nth(i).getAttribute('value');
          if (val !== null && val === value) {
            await radios.nth(i).click();
            matched = true;
            break;
          }
        }
        if (!matched) {
          const idx = Number(value);
          if (!Number.isNaN(idx) && idx >= 0 && idx < radioCount) {
            await radios.nth(idx).click();
          }
        }
        continue;
      }

      const checkbox = page.locator(`input[type="checkbox"][name="${escapedKey}"]`);
      if (await checkbox.count()) {
        if (value === 'true' || value === '1') {
          await checkbox.check();
        } else {
          await checkbox.uncheck();
        }
        continue;
      }

      const field = page.locator(`[name="${escapedKey}"]`).first();
      if (await field.count()) {
        await field.fill(value);
      }
    }

    if (motivationLetter) {
      await fillMotivationTextareas(page, motivationLetter);
    }

    // Same rule as the initial fill: only under matching recorded authority.
    const privacy = await acceptPrivacyCheckbox(page, authority);
    if (privacy.noticeChanged) {
      return { status: 'FAILED', code: 'NOTICE_CHANGED', errorMessage: 'Recipient declaration differs from the approved version.' };
    }

    // If a "Davam et" button is still present (i.e. we're not on the review
    // step yet), advance once more to reach it. If we're already on review,
    // there's no such button and this is a no-op.
    await clickContinueIfEnabled(page);

    const missingFields = await findUnansweredRadioGroups(page);
    if (privacy.blockedField) missingFields.push(privacy.blockedField);
    return await reviewState(page, missingFields);
  } catch (err) {
    return { status: 'FAILED', code: 'FILL_ERROR', errorMessage: err instanceof Error ? err.message : String(err) };
  }
}

async function observe(page: Page): Promise<SendObservation | undefined> {
  try {
    const text = await page.evaluate(() => document.body.innerText);
    return { url: page.url(), text: text.slice(0, 5000) };
  } catch {
    return undefined;
  }
}

const ERROR_TEXT = /(xəta|error|uğursuz)/i;

/**
 * The real final send: activates the review modal's "Təsdiq et və göndər"
 * control. Only invoked by SessionsService.confirmSubmit in response to one
 * candidate-initiated attempt forwarded by apps/api — never from fill, a
 * retry, a queue or a cron.
 *
 * Dry run never activates the control: it only proves the control is present
 * and enabled, so a rehearsal cannot deliver anything, whatever the page's
 * network behaviour.
 *
 * After a real activation the outcome is never "received": the worker has no
 * validated receipt contract for the destination, so it reports what it saw
 * (SENT_OBSERVED + observation) and apps/api decides. Once the control has
 * been activated, an exception can no longer be reported as NOT_SENT.
 */
export async function confirmSubmit(page: Page, dryRun: boolean): Promise<ConfirmResult> {
  let activated = false;
  try {
    const confirmBtn = page.getByRole('button', { name: CONFIRM_SEND_BUTTON_NAME });
    if (!(await confirmBtn.count())) {
      return { outcome: 'NOT_SENT', code: 'CONFIRM_CONTROL_MISSING' };
    }
    if (dryRun) {
      const ready = await confirmBtn.first().isVisible() && await confirmBtn.first().isEnabled();
      return ready ? { outcome: 'DRY_RUN_COMPLETE' } : { outcome: 'NOT_SENT', code: 'CONFIRM_CONTROL_DISABLED' };
    }

    // Never activated under a human-verification challenge.
    if (await manualInterventionRequired(page)) return { outcome: 'NOT_SENT', code: 'MANUAL_INTERVENTION_REQUIRED' };

    activated = true;
    await actAndSettle(page, () => confirmBtn.first().click());

    const hasOtpField = await anyVisible(page, OTP_SELECTOR);
    if (hasOtpField) return { outcome: 'AWAITING_OTP' };

    const observation = await observe(page);
    // A challenge raised by the click itself: whether the destination kept
    // the data is unknown, and AISE never tries to pass it.
    if (await manualInterventionRequired(page)) return { outcome: 'SENT_OBSERVED', code: 'MANUAL_INTERVENTION_REQUIRED', observation };
    if (observation && ERROR_TEXT.test(observation.text.slice(0, 1000))) {
      return { outcome: 'REJECTED', code: 'DESTINATION_ERROR_TEXT', observation };
    }
    return { outcome: 'SENT_OBSERVED', observation };
  } catch {
    return activated ? { outcome: 'SENT_OBSERVED' } : { outcome: 'NOT_SENT', code: 'WORKER_ERROR_BEFORE_SEND' };
  }
}

/**
 * Enters one candidate-supplied OTP and activates verify. An OTP field still
 * present afterwards means the code was not accepted; the session is kept so
 * the candidate can try again within apps/api's attempt limit.
 */
export async function submitOtp(page: Page, code: string): Promise<OtpResult> {
  let activated = false;
  try {
    const otpInput = page.locator(OTP_SELECTOR).first();
    if (!(await otpInput.count())) {
      return { outcome: 'NOT_SENT', code: 'OTP_FIELD_MISSING' };
    }
    await otpInput.fill(code);

    const verifyBtn = page.getByRole('button', { name: VERIFY_BUTTON_NAME }).last();
    activated = true;
    await actAndSettle(page, async () => {
      if (await verifyBtn.count()) {
        await verifyBtn.click();
      } else {
        await otpInput.press('Enter');
      }
    });

    const stillHasOtp = await anyVisible(page, OTP_SELECTOR);
    if (stillHasOtp) {
      await page.locator(OTP_SELECTOR).first().fill('').catch(() => {});
      return { outcome: 'OTP_INVALID' };
    }
    const observation = await observe(page);
    if (observation && ERROR_TEXT.test(observation.text.slice(0, 1000))) {
      return { outcome: 'REJECTED', code: 'DESTINATION_ERROR_TEXT', observation };
    }
    return { outcome: 'SENT_OBSERVED', observation };
  } catch {
    return activated ? { outcome: 'SENT_OBSERVED' } : { outcome: 'NOT_SENT', code: 'WORKER_ERROR_BEFORE_SEND' };
  }
}

export async function captureScreenshot(page: Page): Promise<Buffer> {
  return page.screenshot({ fullPage: true });
}

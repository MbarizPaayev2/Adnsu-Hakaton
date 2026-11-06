import { existsSync } from 'fs';
import { chromium, type Browser, type Page } from 'playwright';
import { applyAnswers, confirmSubmit, fillApplication, noticeFingerprint, submitOtp } from './glorri-apply.adapter';

// Local pages only (page.setContent); every network request is aborted.
const MAC_CFT = `${process.env.HOME}/.cache/puppeteer/chrome/mac_arm-150.0.7871.24/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const CHROME = process.env.CHROMIUM_PATH || (existsSync(MAC_CFT) ? MAC_CFT : '/opt/pw-browsers/chromium');

const DECLARATION = 'Məlumatlarımın emal edilməsinə razıyam';
const POLICY = 'https://jobs.glorri.com/privacy';

function reviewPage(extra = '') {
  return `<!doctype html><body>
    <label><input type="checkbox" name="isDataPrivacyAccepted"> ${DECLARATION} <a href="${POLICY}">şərtlər</a></label>
    <div role="dialog"><p>Ad: Leyla</p><button id="send" onclick="window.sent=(window.sent||0)+1;${extra}">Təsdiq et və göndər</button></div>
  </body>`;
}

describe('glorri adapter against local fixture pages', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    if (!existsSync(CHROME)) throw new Error(`Cached Chrome for Testing not found at ${CHROME}; set CHROMIUM_PATH (no download is performed)`);
    browser = await chromium.launch({ headless: true, executablePath: CHROME });
  }, 30_000);
  afterAll(async () => browser?.close());
  beforeEach(async () => {
    page = await browser.newPage();
    await page.route('**/*', (route) => route.abort());
  });
  afterEach(async () => page.close());

  it('fingerprints declarations exactly like apps/api', () => {
    // Same vector is asserted in apps/api destinations.spec.ts.
    expect(noticeFingerprint('  Məlumatlarımın   emal edilməsinə\n razıyam ', ' https://jobs.glorri.com/privacy '))
      .toBe('22b0c6f0f6890d6df71bdc11d3414d817e7cd3c577a56de8f45770f453034f2b');
  });

  it('refuses to open a destination that is not allowlisted', async () => {
    const result = await fillApplication(page, 'https://attacker.example/vacancies/a/b/apply', {}, null);
    expect(result).toMatchObject({ status: 'FAILED', code: 'DESTINATION_NOT_ALLOWED' });
    expect(page.url()).toBe('about:blank');
  });

  it('ticks the recipient declaration only when it matches the approved fingerprint', async () => {
    const ok = { noticeHash: noticeFingerprint(DECLARATION + ' şərtlər', POLICY), noticeVersion: 'v1' };
    await page.setContent(reviewPage());
    await expect(applyAnswers(page, [], undefined, ok)).resolves.toMatchObject({ status: 'READY_FOR_REVIEW' });
    expect(await page.isChecked('input[name=isDataPrivacyAccepted]')).toBe(true);
  });

  it('stops without ticking when the live declaration differs from the approved one', async () => {
    const stale = { noticeHash: noticeFingerprint('Köhnə bəyanat', POLICY), noticeVersion: 'v0' };
    await page.setContent(reviewPage());
    await expect(applyAnswers(page, [], undefined, stale)).resolves.toMatchObject({ status: 'FAILED', code: 'NOTICE_CHANGED' });
    expect(await page.isChecked('input[name=isDataPrivacyAccepted]')).toBe(false);
  });

  it('never accepts the declaration as an ordinary answer', async () => {
    await page.setContent(reviewPage());
    const result = await applyAnswers(page, [{ fieldKey: 'isDataPrivacyAccepted', value: 'true' }], undefined, null);
    expect(result.status).toBe('NEEDS_INPUT');
    expect(result.missingFields?.map((f) => f.fieldKey)).toEqual(['isDataPrivacyAccepted']);
    expect(await page.isChecked('input[name=isDataPrivacyAccepted]')).toBe(false);
  });

  it('dry run finds the final control and never activates it', async () => {
    await page.setContent(reviewPage());
    await expect(confirmSubmit(page, true)).resolves.toEqual({ outcome: 'DRY_RUN_COMPLETE' });
    expect(await page.evaluate(() => (window as any).sent ?? 0)).toBe(0);
  });

  it('reports a live send as observed, never as received', async () => {
    await page.setContent(reviewPage(`document.body.innerHTML='<h1>Müraciətiniz qeydə alındı</h1><p>Nömrə: GL-2026-0001</p>'`));
    const result = await confirmSubmit(page, false);
    expect(result.outcome).toBe('SENT_OBSERVED');
    expect(result.observation?.text).toContain('GL-2026-0001');
    expect(await page.evaluate(() => (window as any).sent)).toBe(1);
  });

  it('distinguishes OTP, visible rejection and a missing control', async () => {
    await page.setContent(reviewPage(`document.body.insertAdjacentHTML('beforeend','<input name=otp maxlength=6><button>Təsdiqlə</button>')`));
    await expect(confirmSubmit(page, false)).resolves.toEqual({ outcome: 'AWAITING_OTP' });

    await page.setContent(reviewPage(`document.body.innerHTML='<p>Xəta baş verdi</p>'`));
    await expect(confirmSubmit(page, false)).resolves.toMatchObject({ outcome: 'REJECTED' });

    await page.setContent('<p>no review modal</p>');
    await expect(confirmSubmit(page, false)).resolves.toEqual({ outcome: 'NOT_SENT', code: 'CONFIRM_CONTROL_MISSING' });
  });

  it('keeps an invalid OTP as retryable and reports an accepted one as observed', async () => {
    const otpPage = `<!doctype html><body><input name="otp" maxlength="6"><button onclick="
      if (document.querySelector('[name=otp]').value === '123456') document.body.innerHTML='<p>Təşəkkür edirik</p>';
      else document.body.insertAdjacentHTML('beforeend','<p>Yanlış kod</p>');">Təsdiqlə</button></body>`;
    await page.setContent(otpPage);
    await expect(submitOtp(page, '000000')).resolves.toEqual({ outcome: 'OTP_INVALID' });
    await expect(submitOtp(page, '123456')).resolves.toMatchObject({ outcome: 'SENT_OBSERVED' });
  });
});

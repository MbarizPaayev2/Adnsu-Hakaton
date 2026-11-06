import { applyYourselfUrl, destinationCapability, ExternalDestination, ExternalDestinationRegistry, GLORRI_DESTINATION, noticeFingerprint } from './destinations';

const WITH_CONTRACT: ExternalDestination = {
  ...GLORRI_DESTINATION,
  notice: { url: 'https://jobs.glorri.com/privacy', version: 'fixture-1', declarationText: 'Razıyam' },
  receipt: { textPattern: /Müraciət nömrəsi:\s*([A-Z0-9-]+)/, urlPathPattern: /^\/applications\/done$/ },
};

describe('ExternalDestinationRegistry', () => {
  const registry = new ExternalDestinationRegistry();
  const job = (over: Record<string, unknown> = {}) => ({
    externalId: 'glorri:1',
    url: 'https://jobs.glorri.com/vacancies/acme/backend-dev',
    rawPayload: { slug: 'backend-dev', company: { slug: 'acme' } },
    ...over,
  });

  it('fingerprints a declaration exactly like the apply worker (shared test vector)', () => {
    // Same input and expected value as apps/apply-worker glorri-apply.adapter.spec.ts.
    expect(noticeFingerprint('  Məlumatlarımın   emal edilməsinə\n razıyam ', ' https://jobs.glorri.com/privacy '))
      .toBe('22b0c6f0f6890d6df71bdc11d3414d817e7cd3c577a56de8f45770f453034f2b');
    // NFC normalisation: a decomposed "ə" + combining mark and the composed form agree.
    expect(noticeFingerprint('Café', 'u')).toBe(noticeFingerprint('Café', 'u'));
  });

  it('keeps Glorri on assisted apply: no captured notice and no receipt contract', () => {
    expect(GLORRI_DESTINATION.notice).toBeNull();
    expect(GLORRI_DESTINATION.receipt).toBeNull();
    expect(registry.currentNoticeHash(GLORRI_DESTINATION)).toBeNull();
  });

  it('derives the apply URL only from the allowlisted host and validated slugs', () => {
    expect(registry.resolve(job())).toEqual({
      ok: true, destination: GLORRI_DESTINATION, host: 'jobs.glorri.com',
      applyUrl: 'https://jobs.glorri.com/vacancies/acme/backend-dev/apply',
    });
    expect(registry.resolve(job({ externalId: 'boss:1' }))).toEqual({ ok: false, reason: 'UNSUPPORTED_SOURCE' });
    expect(registry.resolve(job({ url: 'https://evil.example/vacancies/acme/x' }))).toEqual({ ok: false, reason: 'DESTINATION_NOT_ALLOWED' });
    expect(registry.resolve(job({ url: 'http://jobs.glorri.com/x' }))).toEqual({ ok: false, reason: 'DESTINATION_NOT_ALLOWED' });
    expect(registry.resolve(job({ rawPayload: { slug: '../../admin', company: { slug: 'acme' } } }))).toEqual({ ok: false, reason: 'DESTINATION_DATA_MISSING' });
    expect(registry.isAllowedApplyUrl(GLORRI_DESTINATION, 'https://jobs.glorri.com/vacancies/a/b/apply?x=1')).toBe(false);
  });

  it('accepts only a receipt that satisfies the destination contract, returning no page text', () => {
    const good = { url: 'https://jobs.glorri.com/applications/done', text: 'Təşəkkürlər, Leyla! Müraciət nömrəsi: GL-2026-0001' };
    const receipt = registry.validateReceipt(WITH_CONTRACT, good);
    expect(receipt).toEqual({
      reference: 'GL-2026-0001',
      evidence: { method: 'receipt-contract', urlPath: '/applications/done', textSha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
    });
    expect(JSON.stringify(receipt)).not.toContain('Leyla');

    // No contract, forged host, wrong path, missing reference, non-string data.
    expect(registry.validateReceipt(GLORRI_DESTINATION, good)).toBeNull();
    expect(registry.validateReceipt(WITH_CONTRACT, { ...good, url: 'https://evil.example/applications/done' })).toBeNull();
    expect(registry.validateReceipt(WITH_CONTRACT, { ...good, url: 'https://jobs.glorri.com/vacancies/a/b/apply' })).toBeNull();
    expect(registry.validateReceipt(WITH_CONTRACT, { ...good, text: 'Müraciətiniz qəbul edildi' })).toBeNull();
    expect(registry.validateReceipt(WITH_CONTRACT, { url: 42, text: good.text })).toBeNull();
    expect(registry.validateReceipt(WITH_CONTRACT, undefined)).toBeNull();
  });

  it('states what each destination can do, from the reviewed registry entry only', () => {
    expect(destinationCapability(GLORRI_DESTINATION)).toEqual({
      key: 'glorri', displayName: 'Glorri (jobs.glorri)', preparation: 'NOTICE_NOT_CAPTURED',
      receipt: 'NOT_VERIFIABLE', rejection: 'NOT_DETECTABLE', identityDocumentRequired: true,
    });
    // A captured notice with no receipt contract can be prepared and sent, but a
    // send can never be confirmed: the candidate must be told so beforehand.
    expect(destinationCapability({ ...WITH_CONTRACT, receipt: null })).toMatchObject({ preparation: 'AVAILABLE', receipt: 'NOT_VERIFIABLE', rejection: 'NOT_DETECTABLE' });
    expect(destinationCapability(WITH_CONTRACT)).toMatchObject({ preparation: 'AVAILABLE', receipt: 'VERIFIED_BY_CONTRACT', rejection: 'NOT_DETECTABLE' });
    expect(destinationCapability({ ...WITH_CONTRACT, receipt: { ...WITH_CONTRACT.receipt!, rejectionPattern: /rədd/ } })).toMatchObject({ rejection: 'DETECTED_BY_CONTRACT' });
    expect(registry.capabilities().map((c) => c.key)).toEqual(['glorri']);
  });

  it('links "apply yourself" only to an https page on the destination\'s own hosts', () => {
    expect(applyYourselfUrl(GLORRI_DESTINATION, 'https://jobs.glorri.com/vacancies/acme/backend-dev')).toBe('https://jobs.glorri.com/vacancies/acme/backend-dev');
    expect(applyYourselfUrl(GLORRI_DESTINATION, 'https://jobs.glorri.az/vacancies/acme/backend-dev')).toBe('https://jobs.glorri.az/vacancies/acme/backend-dev');
    for (const bad of ['http://jobs.glorri.com/x', 'https://evil.example/x', 'https://jobs.glorri.com.evil.example/x', 'javascript:alert(1)', 'not a url', '', null, undefined]) {
      expect(applyYourselfUrl(GLORRI_DESTINATION, bad as any)).toBeNull();
    }
  });

  it('finds the destination for a posting by its source, even when its data is incomplete', () => {
    expect(registry.forJob({ externalId: 'glorri:1' })).toBe(GLORRI_DESTINATION);
    expect(registry.forJob({ externalId: 'aise:1' })).toBeUndefined();
  });
});

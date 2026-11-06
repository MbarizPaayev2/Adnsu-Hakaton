import { createHash } from 'crypto';
import { payloadHash, payloadPartsOf } from './email-application-state';

const base = { recipient: 'hr@employer.example', subject: 'Analyst', body: 'Hello', cvSha256: 'a'.repeat(64), cvFileName: 'CV.pdf', replyTo: 'me@example.com', senderName: 'Aysel', copyToSelf: true };

describe('payloadHash', () => {
  it('hashes an application without a letter exactly as before letters existed (v1), so earlier approvals still verify', () => {
    const legacy = createHash('sha256').update(JSON.stringify(['v1', base.recipient, base.subject, base.body, base.cvSha256, base.cvFileName, base.replyTo, base.senderName, base.copyToSelf])).digest('hex');
    expect(payloadHash(base)).toBe(legacy);
    expect(payloadHash({ ...base, letterSha256: null, letterFileName: null })).toBe(legacy);
  });

  it('binds a letter: its bytes and its file name change the hash', () => {
    const withLetter = payloadHash({ ...base, letterSha256: 'b'.repeat(64), letterFileName: 'Letter.pdf' });
    expect(withLetter).not.toBe(payloadHash(base));
    expect(payloadHash({ ...base, letterSha256: 'c'.repeat(64), letterFileName: 'Letter.pdf' })).not.toBe(withLetter);
    expect(payloadHash({ ...base, letterSha256: 'b'.repeat(64), letterFileName: 'Other.pdf' })).not.toBe(withLetter);
  });
});

describe('payloadPartsOf', () => {
  const row = { ...base, cvPreviewSha256: 'p'.repeat(64), cvSha256: 'a'.repeat(64), letterFileName: 'L.pdf', letterPreviewSha256: 'q'.repeat(64), letterSha256: 'b'.repeat(64) };
  it('uses the previewed hashes before approval and the private-copy hashes after', () => {
    expect(payloadPartsOf(row, 'preview')).toMatchObject({ cvSha256: 'p'.repeat(64), letterSha256: 'q'.repeat(64), letterFileName: 'L.pdf' });
    expect(payloadPartsOf(row, 'approved')).toMatchObject({ cvSha256: 'a'.repeat(64), letterSha256: 'b'.repeat(64) });
  });
  it('omits the letter entirely when there is none', () => {
    const none = payloadPartsOf({ ...row, letterFileName: null, letterPreviewSha256: null, letterSha256: null }, 'preview');
    expect(none).not.toHaveProperty('letterSha256');
  });
});

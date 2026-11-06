import { attachmentName, buildDraft, cleanBody, singleLine } from './email-application-draft';
import { extractApplicationEmail } from '../jobs/job-facts';

const base = { title: 'Mühasib', description: 'Müraciət üçün CV göndərin', senderName: 'Aysel Məmmədova', evidence: null };

describe('application draft', () => {
  it('carries a board posting’s required subject through extraction into the candidate’s review draft', () => {
    const description = 'Mövzu yerində “Satıcı - Kassir” yazmaqla öz CV-lərini hr@acme.az ünvanına göndərə bilər.';
    const evidence = extractApplicationEmail(description)?.evidence;
    expect(evidence).toBeDefined();
    expect(buildDraft({ ...base, description, evidence: evidence! })).toMatchObject({ subject: 'Satıcı - Kassir', subjectSource: 'published' });
  });
  it('keeps the published subject line exactly and never invents one otherwise', () => {
    expect(buildDraft({ ...base, evidence: { subjectLine: 'Mühasib - ACC-12', reference: 'ACC-12' } })).toMatchObject({ subject: 'Mühasib - ACC-12', subjectSource: 'published' });
    expect(buildDraft({ ...base, evidence: { reference: 'ACC-12' } })).toMatchObject({ subject: 'Mühasib - ACC-12', subjectSource: 'reference' });
    expect(buildDraft(base)).toMatchObject({ subject: 'Müraciət: Mühasib', subjectSource: 'generated' });
    expect(buildDraft({ ...base, title: 'Accountant', description: 'Send your CV' }).subject).toBe('Application: Accountant');
  });
  it('writes no qualifications or claims in the letter and includes the published reference', () => {
    const letter = buildDraft({ ...base, evidence: { reference: 'ACC-12' } }).body;
    expect(letter).toContain('vakansiya kodu: ACC-12');
    expect(letter).toContain('Aysel Məmmədova');
    expect(letter).not.toMatch(/\d+\s*(il|year)|experience|təcrübə/i);
    expect(buildDraft({ ...base, title: 'Accountant', description: 'Send your CV' }).body).toMatch(/^Hello,[\s\S]*Kind regards,\nAysel/);
  });
  it('uses the candidate\'s own saved letter as written when there is one', () => {
    expect(buildDraft({ ...base, savedLetter: '  My own words.\r\nThanks  ' }).body).toBe('My own words.\nThanks');
  });
  it('never lets a line break or control character into the subject', () => {
    expect(singleLine('Role\r\nBcc: attacker@example.com\u0000')).toBe('Role Bcc: attacker@example.com');
    expect(buildDraft({ ...base, evidence: { subjectLine: 'A\r\nBcc: x@y.z' } }).subject).not.toMatch(/[\r\n]/);
    expect(cleanBody('a\u0000b\u0007c\nd')).toBe('abc\nd');
  });
  it('names the attachment with safe ASCII', () => {
    expect(attachmentName('Aysel Məmmədova', '.pdf')).toBe('CV-Aysel-Mmmdova.pdf');
    expect(attachmentName('../../etc/passwd', '.docx')).toBe('CV-etc-passwd.docx');
    expect(attachmentName('Əli', '.pdf')).toBe('CV-li.pdf');
    expect(attachmentName('   ', '.pdf')).toBe('CV-candidate.pdf');
  });

  it('uses the position name alone as the subject when the posting asks only for the position in the subject', () => {
    const d = buildDraft({ title: 'Satınalma üzrə mütəxəssis', description: 'CV-ni göndərin', senderName: 'Aysel Məmmədova', evidence: { subjectIsPositionName: true } } as any);
    expect(d.subject).toBe('Satınalma üzrə mütəxəssis');
    expect(d.subjectSource).toBe('published');
    // an explicit subject line or reference still wins
    expect(buildDraft({ title: 'QA', description: 'x', senderName: 'A B', evidence: { subjectIsPositionName: true, reference: 'R-1' } } as any).subject).toBe('QA - R-1');
  });
});

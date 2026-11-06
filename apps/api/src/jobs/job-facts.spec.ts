import { applicationInstructionBlock, deriveJobFacts, extractApplicationEmail, needsExtraMaterial } from './job-facts';

const facts = (title: string, description = 'Plain description', rawPayload?: Record<string, unknown>) => deriveJobFacts({ title, description, rawPayload });

describe('job facts', () => {
  describe('application e-mail evidence', () => {
    it('accepts one address that the posting explicitly gives for applications, keeping subject and reference', () => {
      const result = extractApplicationEmail('Requirements: 2 years.\nSend your CV to hr@acme.az with the subject "Accountant - REF-2041".\nReference No: REF-2041');
      expect(result?.email).toBe('hr@acme.az');
      expect(result?.evidence).toMatchObject({ subjectLine: 'Accountant - REF-2041', reference: 'REF-2041', extractedFrom: 'description' });
      expect(result?.evidence.excerpt).toContain('Send your CV to hr@acme.az');
    });
    it('reads the cue from the previous line and Azerbaijani wording', () => {
      expect(extractApplicationEmail('CV-nizi aşağıdakı ünvana göndərin:\nkadr@sirket.az')?.email).toBe('kadr@sirket.az');
      expect(extractApplicationEmail('Müraciət üçün: jobs@sirket.az\nMövzu: "Mühasib"')?.evidence.subjectLine).toBe('Mühasib');
    });
    it('ignores addresses that are not application instructions', () => {
      expect(extractApplicationEmail('For press inquiries write to press@acme.az')).toBeNull();
      expect(extractApplicationEmail('Contact info@acme.az for company news')).toBeNull();
      expect(extractApplicationEmail('To unsubscribe from alerts, send mail to stop@acme.az')).toBeNull();
    });
    it('does not choose between two different addresses', () => {
      expect(extractApplicationEmail('Send your CV to a@acme.az or send your CV to b@acme.az')).toBeNull();
      expect(extractApplicationEmail('Send your CV to a@acme.az.\nApply: A@ACME.AZ')?.email).toBe('a@acme.az');
    });
    it('rejects placeholders, no-reply senders and obfuscated text', () => {
      expect(extractApplicationEmail('Send your CV to name@example.com')).toBeNull();
      expect(extractApplicationEmail('Apply: noreply@acme.az')).toBeNull();
      expect(extractApplicationEmail('Send your CV to hr [at] acme.az')).toBeNull();
    });
    it('never invents a subject or reference', () => {
      const result = extractApplicationEmail('Please apply by sending your CV to hr@acme.az');
      expect(result?.evidence.subjectLine).toBeUndefined();
      expect(result?.evidence.reference).toBeUndefined();
    });
    it.each([
      ['CV göndərərkən mövzu hissəsində “Sığorta məsləhətçisi ” qeyd etməklə hr@acme.az ünvanına göndərin.', 'Sığorta məsləhətçisi'],
      ['Maraqlanan namizədlər mövzu yerində “Satıcı - Kassir” yazmaqla öz CV-lərini hr@acme.az ünvanına göndərə bilər.', 'Satıcı - Kassir'],
      ['CV-nizi hr@acme.az ünvanına göndərin. Mövzu xanasında: “Analitik / REF-24”.', 'Analitik / REF-24'],
    ])('keeps the explicit Azerbaijani subject instruction: %s', (description, subject) => {
      expect(extractApplicationEmail(description)?.evidence.subjectLine).toBe(subject);
    });
    it('does not turn a quoted role or a discussed subject into an email subject instruction', () => {
      expect(extractApplicationEmail('“Satış meneceri” vakansiyası. CV-nizi hr@acme.az ünvanına göndərin.')?.evidence.subjectLine).toBeUndefined();
      expect(extractApplicationEmail('Mövzu haqqında “sığorta” təlimi keçiririk. CV-nizi hr@acme.az ünvanına göndərin.')?.evidence.subjectLine).toBeUndefined();
    });
  });

  describe('contact addresses are never application recipients', () => {
    it('refuses an address given for questions about the application process (SOCAR-style wording)', () => {
      const text = 'Müsahibə zamanı namizədlər qiymətləndirilir. Proqram və müraciət prosesi ilə bağlı əlavə suallarınız olduğu halda programs@employer.az elektron poçt ünvanına yaza və ya 012 521 34 05 nömrəsi ilə qaynar xəttə müraciət edə bilərsiniz.';
      expect(extractApplicationEmail(text)).toBeNull();
      expect(extractApplicationEmail('For questions about the application, write to help@employer.com.')).toBeNull();
    });
    it('judges a one-line posting by the sentence around the address, not by cues elsewhere in the text', () => {
      const flat = 'Şirkət CV göndərənləri tezliklə cavablandırır. ' + 'Tələblər: təcrübə, ünsiyyət. '.repeat(30) + 'Ünvan: Bakı, e-poçt info@employer.az';
      expect(extractApplicationEmail(flat)).toBeNull();
      const real = 'Tələblər: təcrübə. '.repeat(20) + 'Maraqlananlar CV-lərini hr@employer.az ünvanına göndərə bilər. Əmək haqqı razılaşma ilə.';
      expect(extractApplicationEmail(real)?.email).toBe('hr@employer.az');
      expect(extractApplicationEmail(real)?.evidence.excerpt).toContain('CV-lərini');
    });
    it('keeps real instructions in Azerbaijani, Russian and English board postings', () => {
      expect(extractApplicationEmail('Müraciət üçün: cv@scorecollege.az ünvanına CV göndərin')?.email).toBe('cv@scorecollege.az');
      expect(extractApplicationEmail('Maraqlanan şəxslər cv-ni aygun@protech-cs.az e mail ünvanına göndərə bilər.')?.email).toBe('aygun@protech-cs.az');
      expect(extractApplicationEmail('Резюме отправляйте на jobs@firma.ru с темой «Менеджер».')?.email).toBe('jobs@firma.ru');
    });
  });

  describe('structured facts', () => {
    it('reads remote only from an explicit flag or title and leaves the rest unknown', () => {
      expect(facts('Developer', 'x', { isRemote: true }).workArrangement).toBe('Remote');
      expect(facts('Developer', 'x', { isRemote: false }).workArrangement).toBeNull();
      expect(facts('QA Engineer (IT/Hybrid/Outstaff)').workArrangement).toBe('Hybrid');
      expect(facts('Müəllim', 'Remote work possible').workArrangement).toBeNull();
    });
    it('maps known career levels and explicit title seniority only', () => {
      expect(facts('Clerk', 'x', { careerLevel: 'career-levels.entry' }).experienceLevel).toBe('Junior');
      expect(facts('Clerk', 'x', { careerLevel: 'career-levels.prof' }).experienceLevel).toBeNull();
      expect(facts('Senior Product owner').experienceLevel).toBe('Senior');
      expect(facts('Data Engineering unit head').experienceLevel).toBe('Lead');
      expect(facts('Accountant').experienceLevel).toBeNull();
    });
    it('marks the application method from evidence', () => {
      expect(facts('A', 'Send your CV to hr@acme.az').applicationMethod).toBe('EMAIL');
      expect(facts('A').applicationMethod).toBe('EXTERNAL_SITE');
      expect(facts('A').applicationEmail).toBeNull();
    });
    it('proves rawPayload.email alone does not establish application eligibility without explicit description cue', () => {
      const genericWithRawEmail = facts('Mühasib', 'Şirkətimiz haqqında məlumat. Əlaqə üçün saytımıza daxil olun.', { email: 'info@acme.az' });
      expect(genericWithRawEmail.applicationMethod).toBe('EXTERNAL_SITE');
      expect(genericWithRawEmail.applicationEmail).toBeNull();
      expect(genericWithRawEmail.applicationEmailEvidence).toBeNull();

      const explicitWithRawEmail = facts('Mühasib', 'Zəhmət olmasa CV-nizi hr@acme.az ünvanına göndərin.', { email: 'hr@acme.az' });
      expect(explicitWithRawEmail.applicationMethod).toBe('EMAIL');
      expect(explicitWithRawEmail.applicationEmail).toBe('hr@acme.az');
      expect(explicitWithRawEmail.applicationEmailEvidence?.excerpt).toContain('hr@acme.az');

      const ambiguous = facts('Mühasib', 'CV göndərin: cv1@acme.az və ya cv2@acme.az', { email: 'cv1@acme.az' });
      expect(ambiguous.applicationMethod).toBe('EXTERNAL_SITE');
      expect(ambiguous.applicationEmail).toBeNull();
    });
  });

  describe('official announcement pages (university style)', () => {
    it('takes an address given under an "Email:" label inside a TO APPLY block, with its subject line', () => {
      const text = 'Qualifications\nProficiency in English.\nTO APPLY:\nPlease submit:\na letter of interest highlighting your qualifications and availability, and\nan updated CV.\nEmail:\nsbrecruitment@ada.edu.az\nSubject line:\nAdjunct Instructor – Global Corporate Strategy\nApplication deadline:\nOctober 9, 2026.\nOnly shortlisted candidates will be contacted.\nFor more information about ADA University, visit www.ada.edu.az\nContact Us\ninfo@ada.edu.az';
      const result = extractApplicationEmail(text);
      expect(result?.email).toBe('sbrecruitment@ada.edu.az');
      expect(result?.evidence.subjectLine).toBe('Adjunct Instructor – Global Corporate Strategy');
    });

    it('takes "submit their CV to … indication “…”" and reads the quoted subject', () => {
      const result = extractApplicationEmail('Applicants who meet the above requirements are invited to submit their CV to economics@khazar.org indication “Coordinator, Department of Economics and management”\nApplication deadline: October 9, 2026');
      expect(result?.email).toBe('economics@khazar.org');
      expect(result?.evidence.subjectLine).toBe('Coordinator, Department of Economics and management');
    });

    it('does not take a footer contact address that is merely labelled "Email:" without an application instruction', () => {
      expect(extractApplicationEmail('About us\nContact Us\nEmail:\ninfo@ada.edu.az\nPhone: +994 12 437 32 35')).toBeNull();
    });

    it('refuses a block that names two different addresses', () => {
      expect(extractApplicationEmail('TO APPLY: Please send your CV to hr@a.az or to jobs@b.az.')).toBeNull();
    });
  });

  describe('the instruction the candidate reads before sending', () => {
    const signaltake = ['Junior LinkedIn Specialist', 'What you need', '- Good communication in English', 'How to apply',
      'Find 5 LinkedIn posts by business owners in Dubai and write 1 comment under each, in English, in a Google Doc with the post links. Do not post them on LinkedIn. Send the doc, your CV and a few words on why you fit to ali@signaltake.com.'].join('\n');

    it('includes the task that comes before the sentence naming the address', () => {
      const block = applicationInstructionBlock(signaltake, 'ali@signaltake.com')!;
      expect(block).toMatch(/^How to apply\n/);
      expect(block).toContain('Google Doc');
      expect(block).toContain('ali@signaltake.com');
      expect(block).not.toContain('Good communication');
    });

    it('flags a posting that asks for more than a CV and a letter, and not one that does not', () => {
      expect(needsExtraMaterial(applicationInstructionBlock(signaltake, 'ali@signaltake.com'))).toBe(true);
      expect(needsExtraMaterial('CV-nizi hr@norm.az ünvanına göndərin; mövzuda vəzifənin adını qeyd edin.')).toBe(false);
      expect(needsExtraMaterial('Send your CV and motivation letter to hr@acme.az with the subject "Accountant".')).toBe(false);
      expect(needsExtraMaterial('Test tapşırığı: 3 nümunə hazırlayın və CV ilə birlikdə göndərin.')).toBe(true);
    });

    it('keeps the plain sentence for a posting with no heading and stops at the paragraph', () => {
      const text = 'Satış meneceri axtarılır.\n\nMaraqlananlar CV-lərini hr@firma.az ünvanına göndərsin.\nSon tarix: 20.10.2026\n\nŞirkət haqqında məlumat.';
      expect(applicationInstructionBlock(text, 'hr@firma.az')).toBe('Maraqlananlar CV-lərini hr@firma.az ünvanına göndərsin.\nSon tarix: 20.10.2026');
    });
  });
});

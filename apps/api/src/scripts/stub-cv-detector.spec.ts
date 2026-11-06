import { classify, STUB_DESCRIPTION } from './stub-cv-detector';

/**
 * The false-positive cases matter more than the true positives here. The stub
 * wrote TypeScript/React/Node.js, which is also what a large share of real
 * Azerbaijani developer CVs say — so a detector keyed on skills alone would
 * overwrite genuine candidate data with machine output.
 */
describe('stub CV detector', () => {
  const stubExact = {
    personalInfo: { email: 'a@b.c', name: 'Namizəd', phone: '' },
    workExperience: [
      {
        title: 'Proqram Mühəndisi',
        company: 'Şirkət',
        description: STUB_DESCRIPTION,
      },
    ],
    skills: ['TypeScript', 'React', 'Node.js'],
    education: [],
  };

  it('flags the exact stub output as certain', () => {
    const { confidence } = classify(stubExact);
    expect(confidence).toBe('certain');
  });

  it('does NOT flag a genuine CV that happens to list the same three skills', () => {
    const genuine = {
      personalInfo: { email: 'x@y.z', name: 'Real Person', phone: '+994501112233' },
      headline: 'Frontend Developer',
      workExperience: [
        {
          title: 'Frontend Developer',
          company: 'Kapital Bank',
          description: 'Built the mobile banking web client.',
        },
      ],
      skills: ['TypeScript', 'React', 'Node.js'],
      education: [],
      extracted: ['skills', 'workExperience'],
    };
    expect(classify(genuine).confidence).toBe('no');
  });

  it('does NOT flag a real CV whose employer is genuinely unnamed', () => {
    // Only the company matches; everything else is real.
    const partial = {
      workExperience: [
        { title: 'Data Analyst', company: 'Şirkət', description: 'Reporting and dashboards.' },
      ],
      skills: ['SQL', 'Python'],
      education: [{ degree: 'BSc' }],
      extracted: ['skills'],
    };
    expect(classify(partial).confidence).toBe('no');
  });

  it('flags a stub row whose description was edited as likely, not certain', () => {
    const edited = {
      ...stubExact,
      workExperience: [{ ...stubExact.workExperience[0], description: 'changed by hand' }],
    };
    expect(classify(edited).confidence).toBe('likely');
  });

  it('treats an already-repaired row as clean, so the repair is idempotent', () => {
    const repaired = { ...stubExact, extracted: ['skills'], workExperience: [], skills: ['Go'] };
    expect(classify(repaired).confidence).toBe('no');
  });

  it('handles null, undefined and non-object content without throwing', () => {
    for (const bad of [null, undefined, 'string', 42, []]) {
      expect(classify(bad as any).confidence).toBe('no');
    }
  });

  it('explains why a row was flagged', () => {
    const { reasons } = classify(stubExact);
    expect(reasons).toContain('exact stub description');
    expect(reasons).toContain('company "Şirkət"');
  });
});

/**
 * Detection of Resume rows whose parsedContent came from the old stub parser.
 *
 * Split out from the repair script so it can be unit-tested without booting
 * the Nest application context — and because getting this wrong in either
 * direction is the whole risk of the repair. A false negative leaves invented
 * data in place; a false positive overwrites a real candidate's CV.
 */

// The stub's exact output. Detection requires ALL of these to agree, because
// "skills contains TypeScript/React/Node.js" on its own is an ordinary thing
// for a real Azerbaijani developer's CV to say — matching on that alone would
// destroy genuine profiles.
//
// The company and description strings are the load-bearing part: "Şirkət" is
// literally the word "company", and the description is one fixed sentence.
// Neither appears in a real CV by accident.
export const STUB_COMPANY = 'Şirkət';
export const STUB_TITLE = 'Proqram Mühəndisi';
export const STUB_DESCRIPTION =
  'Full-stack proqram təminatı inkişafına cavabdehlik daşıyıb.';
export const STUB_SKILLS = ['TypeScript', 'React', 'Node.js'];

export type Confidence = 'certain' | 'likely' | 'no';

/**
 * Classifies a parsedContent blob.
 *
 * `certain`  — carries the stub's fixed description string.
 * `likely`   — stub-shaped in every other respect but the description was
 *              changed, so it is reported and, by default, NOT repaired.
 * `no`       — leave alone.
 */
export function classify(parsed: any): { confidence: Confidence; reasons: string[] } {
  const reasons: string[] = [];
  if (!parsed || typeof parsed !== 'object') return { confidence: 'no', reasons };

  const work = Array.isArray(parsed.workExperience) ? parsed.workExperience : [];
  const skills = Array.isArray(parsed.skills) ? parsed.skills : [];
  const first = work[0] ?? {};

  const hasStubDescription = first.description === STUB_DESCRIPTION;
  const hasStubCompany = first.company === STUB_COMPANY;
  const hasStubTitle = first.title === STUB_TITLE;
  const hasStubSkills =
    skills.length === STUB_SKILLS.length &&
    STUB_SKILLS.every((s, i) => skills[i] === s);
  // The stub predates the `extracted` field the real parser always emits.
  const missingExtracted = !('extracted' in parsed);

  if (hasStubDescription) reasons.push('exact stub description');
  if (hasStubCompany) reasons.push('company "Şirkət"');
  if (hasStubTitle) reasons.push('title "Proqram Mühəndisi"');
  if (hasStubSkills) reasons.push('skills exactly [TypeScript, React, Node.js]');
  if (missingExtracted) reasons.push('no `extracted` field (pre-fix shape)');

  if (hasStubDescription && hasStubCompany) return { confidence: 'certain', reasons };
  if (hasStubCompany && hasStubTitle && hasStubSkills && missingExtracted) {
    return { confidence: 'likely', reasons };
  }
  return { confidence: 'no', reasons };
}


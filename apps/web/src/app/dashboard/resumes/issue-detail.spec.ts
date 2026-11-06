import { describe, it, expect } from 'vitest';
import { issueDetail } from './tailored-review';

describe('issueDetail', () => {
  it('names a left-out career entry in Azerbaijani instead of the internal kind', () => {
    expect(issueDetail('PROJECT: Kredit risk paneli')).toBe('Layihə: Kredit risk paneli');
    expect(issueDetail('VOLUNTEERING: Təşkilatçı')).toBe('Könüllülük: Təşkilatçı');
  });
  it('leaves other details as they are', () => {
    expect(issueDetail('TypeScript, Node.js')).toBe('TypeScript, Node.js');
    expect(issueDetail('SQL: 3 il')).toBe('SQL: 3 il');
    expect(issueDetail(undefined)).toBe('');
  });
});

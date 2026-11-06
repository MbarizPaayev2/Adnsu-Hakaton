import { resumeFileError } from './resume-file';

describe('resumeFileError', () => {
  it('rejects an empty file', () => {
    expect(resumeFileError({ name: 'cv.pdf', size: 0, type: 'application/pdf' })).toMatch(/boşdur/);
  });

  it('rejects a file over 10MB', () => {
    expect(
      resumeFileError({ name: 'cv.pdf', size: 10 * 1024 * 1024 + 1, type: 'application/pdf' }),
    ).toMatch(/10MB/);
  });

  it('rejects an unsupported extension', () => {
    expect(resumeFileError({ name: 'cv.txt', size: 12, type: 'text/plain' })).toMatch(/PDF və DOCX/);
  });

  it('accepts a small pdf', () => {
    expect(resumeFileError({ name: 'cv.pdf', size: 1200, type: 'application/pdf' })).toBeNull();
  });
});

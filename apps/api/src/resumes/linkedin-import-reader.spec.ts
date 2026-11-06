import { ResumesService } from './resumes.service';
import { ResumesController } from './resumes.controller';
import { readPublicLinkedInProfile } from './linkedin-public-reader';

jest.mock('./linkedin-public-reader', () => ({ readPublicLinkedInProfile: jest.fn() }));

describe('reviewed LinkedIn import with reader consent', () => {
  beforeEach(() => jest.resetAllMocks());

  it('normalizes a scheme-less URL, preserves precision and returns review data without saving a CV or profile', async () => {
    jest.mocked(readPublicLinkedInProfile).mockResolvedValue({ method: 'public_reader', profile: {
      name: 'Ada Synthetic', headline: 'Data Analyst', summary: '', location: 'Bakı',
      roles: [{ title: 'Analyst', company: 'Example', dates: '2024 - Present', location: '', description: 'Built SQL reports.', source: 'LinkedIn', uncertain: [] }],
      schools: [], skills: [], languages: [], certifications: [], awards: [], other: {}, contact: [],
    } });
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ name: 'Existing Name', email: 'ada@example.invalid' }) }, resume: { create: jest.fn(), update: jest.fn() }, profile: { update: jest.fn() } };
    const storage = { saveFile: jest.fn() };
    const service = new ResumesService(prisma as never, storage as never, {} as never, {} as never);
    const result = await service.parseImportedText('user-1', 'linkedin.com/in/ada-synthetic', true);
    expect(readPublicLinkedInProfile).toHaveBeenCalledWith('https://www.linkedin.com/in/ada-synthetic', true);
    expect(result).toMatchObject({ source: 'url', importMethod: 'public_reader', parsedContent: { personalInfo: { name: 'Ada Synthetic' } } });
    expect(result.parsedContent.workExperience[0]).toMatchObject({ company: 'Example', startPrecision: 'YEAR', startDate: '2024-01-01T00:00:00.000Z' });
    expect(prisma.resume.create).not.toHaveBeenCalled();
    expect(prisma.resume.update).not.toHaveBeenCalled();
    expect(prisma.profile.update).not.toHaveBeenCalled();
    expect(storage.saveFile).not.toHaveBeenCalled();
  });

  it('accepts literal boolean opt-in only on both import endpoints', async () => {
    const service = { parseImportedText: jest.fn(), parseImportedUrl: jest.fn() };
    const controller = new ResumesController(service as never);
    await controller.importText('u', { text: 'linkedin.com/in/ada', allowPublicReader: true });
    expect(service.parseImportedText).toHaveBeenLastCalledWith('u', 'linkedin.com/in/ada', true);
    await controller.importUrl('u', { url: 'linkedin.com/in/ada', allowPublicReader: 'true' as never });
    expect(service.parseImportedUrl).toHaveBeenLastCalledWith('u', 'linkedin.com/in/ada', false);
    await controller.importText('u', { text: 'Profile text', allowPublicReader: 'false' as never });
    expect(service.parseImportedText).toHaveBeenLastCalledWith('u', 'Profile text', false);
    await controller.importUrl('u', { url: 'linkedin.com/in/ada' });
    expect(service.parseImportedUrl).toHaveBeenLastCalledWith('u', 'linkedin.com/in/ada', false);
  });
});

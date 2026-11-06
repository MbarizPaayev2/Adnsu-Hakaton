import { ResumesService } from './resumes.service';
import { recordSnapshot } from '../documents/snapshots';
jest.mock('../documents/snapshots', () => ({ recordSnapshot: jest.fn(), sha256Hex: jest.fn() }));
const translatedContent = { language: 'az', basics: { headline: 'Biznes analitiki' }, experience: [{ position: 'Biznes təhlili üzrə təcrübəçi', highlights: ['Hesabat hazırladım.'] }] };
function setup(count = 1) {
  const updateMany = jest.fn().mockResolvedValue({ count });
  const tx = { resume: { updateMany } };
  const prisma: any = { $transaction: jest.fn(fn => fn(tx)) };
  const tailor: any = { translateDocumentText: jest.fn().mockResolvedValue({ content: translatedContent, issues: [{ code: 'translated' }], outcomes: [], calls: 1 }) };
  const svc = new ResumesService(prisma, {} as any, tailor, {} as any);
  jest.spyOn(svc as any, 'ownedTailored').mockResolvedValue({ id: 'r', status: 'NEEDS_REVIEW', language: 'az', parsedContent: { ...translatedContent, experience: [{ position: 'Business Analyst Intern', highlights: ['Built the report with Excel.'] }] }, reviewNotes: { revision: 3, issues: [{ code: 'not_translated' }] }, provenance: {} });
  jest.spyOn(svc, 'getTailoredResume').mockResolvedValue({ untranslated: [] } as any);
  return { svc, updateMany };
}
it('persists all translated fields in an owner/revision-guarded snapshot without spending allowance', async () => {
  const { svc, updateMany } = setup();
  await svc.retranslateTailored('u', 'r');
  expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'u', status: 'NEEDS_REVIEW', reviewNotes: { path: ['revision'], equals: 3 } }), data: expect.objectContaining({ parsedContent: translatedContent, reviewNotes: expect.objectContaining({ revision: 4 }) }) }));
  expect(recordSnapshot).toHaveBeenCalledWith(expect.anything(), 'r', 4, 'EDITED', translatedContent, {});
});
it('rejects a translation save if another edit advanced the revision', async () => {
  const { svc } = setup(0);
  await expect(svc.retranslateTailored('u', 'r')).rejects.toThrow('eyni vaxtda');
});

it('retries the current reviewed draft and preserves accepted translations and edits', async () => {
  const acceptedAndPending = {
    language: 'az',
    basics: { headline: 'Vakansiyaya uyğun təsdiqlənmiş başlıq' },
    experience: [{ position: 'Biznes təhlili üzrə təcrübəçi', highlights: ['Namizədin redaktə edib saxladığı cümlə.', 'Built the report with Excel.'] }],
  };
  const translatedContent = {
    ...acceptedAndPending,
    experience: [{ position: 'Biznes təhlili üzrə təcrübəçi', highlights: ['Namizədin redaktə edib saxladığı cümlə.', 'Excel ilə hesabat hazırladım.'] }],
  };
  const { svc, updateMany } = setup();
  const resume = (svc as any).ownedTailored as jest.SpyInstance;
  resume.mockResolvedValue({
    id: 'r', status: 'NEEDS_REVIEW', language: 'az', parsedContent: acceptedAndPending,
    reviewNotes: { revision: 3, issues: [{ code: 'not_translated' }] }, provenance: {},
  });
  const tailor = (svc as any).tailorService;
  tailor.translateDocumentText = jest.fn().mockResolvedValue({
    content: translatedContent, issues: [{ code: 'translated' }], outcomes: [], calls: 1,
  });

  await svc.retranslateTailored('u', 'r');

  expect(tailor.translateDocumentText).toHaveBeenCalledWith(acceptedAndPending);
  expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ parsedContent: translatedContent }),
  }));
  expect(recordSnapshot).toHaveBeenCalledWith(expect.anything(), 'r', 4, 'EDITED', translatedContent, {});
});

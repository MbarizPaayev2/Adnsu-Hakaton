import { ForbiddenException } from '@nestjs/common';
import { JobSourceService } from './job-source.service';

describe('LinkedIn ingestion access gate', () => {
  const findUnique = jest.fn();
  const service = new JobSourceService({ jobSource: { findUnique } } as any, {} as any);

  beforeEach(() => findUnique.mockReset());

  it('blocks imports while the access review is pending even if the source is enabled', async () => {
    findUnique.mockResolvedValue({ enabled: true, accessReview: 'ROBOTS_ALLOWED_TERMS_PENDING' });
    await expect(service.assertIngestable('linkedin:123456')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows ingestion only after the explicit access review state is set', async () => {
    findUnique.mockResolvedValue({ enabled: true, accessReview: 'TERMS_REVIEWED_ALLOWED' });
    await expect(service.assertIngestable('linkedin:123456')).resolves.toBeUndefined();
  });

  it('keeps the pre-existing restriction for disabled or restricted sources', async () => {
    findUnique.mockResolvedValue({ enabled: false, accessReview: 'TERMS_REVIEWED_ALLOWED' });
    await expect(service.assertIngestable('linkedin:123456')).rejects.toBeInstanceOf(ForbiddenException);
    findUnique.mockResolvedValue({ enabled: true, accessReview: 'RESTRICTED' });
    await expect(service.assertIngestable('linkedin:123456')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

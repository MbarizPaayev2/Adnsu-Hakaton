import { LinkedInCollector } from './linkedin.collector';
import { COLLECTOR_KEYS, collectorFor } from './collector-registry';
import { BOARD_SOURCES } from '../../jobs/source-discovery';
import type { IngestJobDto } from '../../jobs/dto/ingest-job.dto';

describe('LinkedInCollector', () => {
  let originalCollectionApproval: string | undefined;
  beforeEach(() => {
    originalCollectionApproval = process.env.LINKEDIN_COLLECTION_APPROVED;
    process.env.LINKEDIN_COLLECTION_APPROVED = 'true';
  });
  afterEach(() => {
    if (originalCollectionApproval === undefined) delete process.env.LINKEDIN_COLLECTION_APPROVED;
    else process.env.LINKEDIN_COLLECTION_APPROVED = originalCollectionApproval;
  });

  const sampleSearchHtml = `
    <ul>
      <li>
        <div class="job-search-card" data-entity-urn="urn:li:jobPosting:4012345678">
          <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/4012345678">
            <h3>Senior Java Engineer</h3>
          </a>
          <h4 class="base-search-card__subtitle">PASHA Bank</h4>
          <span class="job-search-card__location">Baku, Azerbaijan</span>
        </div>
      </li>
      <li>
        <div class="job-search-card" data-entity-urn="urn:li:jobPosting:4087654321">
          <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/4087654321">
            <h3>Tax Consultant</h3>
          </a>
          <h4 class="base-search-card__subtitle">KPMG Azerbaijan</h4>
          <span class="job-search-card__location">Baku, Azerbaijan</span>
        </div>
      </li>
    </ul>
  `;

  const sampleDetailHtml = (id: string, title: string, company: string, deadline?: string) => `
    <html>
      <head>
        <script type="application/ld+json">
          {
            "@type": "JobPosting",
            "title": "${title}",
            "description": "Comprehensive role description for ${title} at ${company}.",
            "hiringOrganization": { "name": "${company}" },
            "jobLocation": { "address": { "addressLocality": "Baku", "addressCountry": "AZ" } },
            "datePosted": "2026-10-25T00:00:00.000Z"
            ${deadline ? `,"validThrough": "${deadline}"` : ''}
          }
        </script>
      </head>
      <body><h1>${title}</h1></body>
    </html>
  `;

  it('does not request LinkedIn pages while the collector access gate is off', async () => {
    delete process.env.LINKEDIN_COLLECTION_APPROVED;
    const readListing = jest.fn();
    const fetchDetail = jest.fn();
    const collector = new LinkedInCollector(readListing, fetchDetail);
    const result = await collector.collect({ maxPages: 1, maxJobs: 1, delayMs: 2000 }, async () => undefined);
    expect(result.accepted).toBe(0);
    expect(result.error).toMatch(/söndürülüb/i);
    expect(readListing).not.toHaveBeenCalled();
    expect(fetchDetail).not.toHaveBeenCalled();
  });

  it('collects jobs from guest search, fetches details, and accepts valid postings', async () => {
    const readListing = jest.fn().mockResolvedValue(sampleSearchHtml);
    const fetchDetail = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('4012345678')) {
        return {
          html: sampleDetailHtml('4012345678', 'Senior Java Engineer', 'PASHA Bank'),
          method: 'direct',
        };
      }
      return {
        html: sampleDetailHtml('4087654321', 'Tax Consultant', 'KPMG Azerbaijan'),
        method: 'direct',
      };
    });
    const pause = jest.fn().mockResolvedValue(undefined);
    const now = () => new Date('2026-10-27T12:00:00.000Z');

    const collector = new LinkedInCollector(readListing, fetchDetail, pause, now);
    const accepted: IngestJobDto[] = [];

    const report = await collector.collect(
      { maxPages: 2, maxJobs: 10, delayMs: 2000 },
      async (job) => {
        accepted.push(job);
      },
    );

    expect(report.source).toBe('linkedin');
    expect(report.discovered).toBe(2);
    expect(report.fetched).toBe(2);
    expect(report.accepted).toBe(2);
    expect(accepted).toHaveLength(2);
    expect(accepted[0]).toMatchObject({
      externalId: 'linkedin:4012345678',
      title: 'Senior Java Engineer',
      company: 'PASHA Bank',
      location: 'Baku, Azerbaijan',
    });
    expect(accepted[1]).toMatchObject({
      externalId: 'linkedin:4087654321',
      title: 'Tax Consultant',
      company: 'KPMG Azerbaijan',
      location: 'Baku, Azerbaijan',
    });
  });

  it('skips known jobs without fetching detail and respects item cursor budget', async () => {
    const readListing = jest.fn().mockResolvedValue(sampleSearchHtml);
    const fetchDetail = jest.fn().mockResolvedValue({
      html: sampleDetailHtml('4087654321', 'Tax Consultant', 'KPMG Azerbaijan'),
      method: 'direct',
    });
    const pause = jest.fn().mockResolvedValue(undefined);
    const now = () => new Date('2026-10-27T12:00:00.000Z');

    const collector = new LinkedInCollector(readListing, fetchDetail, pause, now);
    const accepted: IngestJobDto[] = [];

    const report = await collector.collect(
      {
        maxPages: 1,
        maxJobs: 1,
        delayMs: 2000,
        isKnown: (id) => id === 'linkedin:4012345678',
      },
      async (job) => {
        accepted.push(job);
      },
    );

    expect(report.discovered).toBe(2);
    expect(report.known).toBe(1);
    expect(report.fetched).toBe(1);
    expect(report.accepted).toBe(1);
    expect(accepted[0].externalId).toBe('linkedin:4087654321');
  });

  it('does not restart collection from the beginning when a saved cursor disappeared from current guest results', async () => {
    const readListing = jest.fn().mockResolvedValue(sampleSearchHtml);
    const fetchDetail = jest.fn();
    const collector = new LinkedInCollector(readListing, fetchDetail, jest.fn().mockResolvedValue(undefined));
    const report = await collector.collect(
      { maxPages: 1, maxJobs: 1, delayMs: 2000, resume: { kind: 'cursor', value: 'linkedin:4999999999' } },
      jest.fn(),
    );
    expect(report.accepted).toBe(0);
    expect(report.error).toMatch(/davametmə nöqtəsi.*tapılmadı/i);
    expect(fetchDetail).not.toHaveBeenCalled();
  });

  it('does not accept expired postings', async () => {
    const readListing = jest.fn().mockResolvedValue(sampleSearchHtml);
    const fetchDetail = jest.fn().mockResolvedValue({
      html: sampleDetailHtml('4012345678', 'Senior Java Engineer', 'PASHA Bank', '2026-10-01T00:00:00.000Z'),
      method: 'direct',
    });
    const pause = jest.fn().mockResolvedValue(undefined);
    const now = () => new Date('2026-10-27T12:00:00.000Z');

    const collector = new LinkedInCollector(readListing, fetchDetail, pause, now);
    const accepted: IngestJobDto[] = [];

    const report = await collector.collect(
      { maxPages: 1, maxJobs: 1, delayMs: 2000 },
      async (job) => {
        accepted.push(job);
      },
    );

    expect(report.expired).toBe(1);
    expect(report.accepted).toBe(0);
    expect(accepted).toHaveLength(0);
  });

  it('registers in collector-registry and BOARD_SOURCES', () => {
    expect(COLLECTOR_KEYS).toContain('linkedin');
    const collector = collectorFor('linkedin');
    expect(collector).toBeInstanceOf(LinkedInCollector);
    expect(BOARD_SOURCES.has('linkedin')).toBe(true);
  });
});

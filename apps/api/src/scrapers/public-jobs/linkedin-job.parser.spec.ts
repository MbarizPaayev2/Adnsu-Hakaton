import {
  isAzerbaijanLocation,
  isExplicitForeignLocation,
  isLinkedInJobClosed,
  parseLinkedInJobDetail,
  parseLinkedInSearchListing,
  validateLinkedInJobUrl,
} from './linkedin-job.parser';

describe('validateLinkedInJobUrl', () => {
  it('validates canonical linkedin job URLs and normalizes them', () => {
    const res = validateLinkedInJobUrl('https://www.linkedin.com/jobs/view/4012345678');
    expect(res.valid).toBe(true);
    expect(res.jobId).toBe('4012345678');
    expect(res.normalizedUrl).toBe('https://www.linkedin.com/jobs/view/4012345678');
  });

  it('handles localized az.linkedin.com and trailing slashes', () => {
    const res = validateLinkedInJobUrl('https://az.linkedin.com/jobs/view/4012345678/');
    expect(res.valid).toBe(true);
    expect(res.jobId).toBe('4012345678');
    expect(res.normalizedUrl).toBe('https://www.linkedin.com/jobs/view/4012345678');
  });

  it('strips title slugs and tracking query parameters to canonical form', () => {
    const res = validateLinkedInJobUrl(
      'https://www.linkedin.com/jobs/view/senior-software-engineer-at-acme-4012345678?position=2&pageNum=0&trk=public_jobs',
    );
    expect(res.valid).toBe(true);
    expect(res.jobId).toBe('4012345678');
    expect(res.normalizedUrl).toBe('https://www.linkedin.com/jobs/view/4012345678');
  });

  it('rejects foreign domains, localhost, credentials, and non-standard ports', () => {
    expect(validateLinkedInJobUrl('https://evil.com/jobs/view/4012345678').valid).toBe(false);
    expect(validateLinkedInJobUrl('https://localhost/jobs/view/4012345678').valid).toBe(false);
    expect(validateLinkedInJobUrl('https://user:pass@linkedin.com/jobs/view/4012345678').valid).toBe(false);
    expect(validateLinkedInJobUrl('https://www.linkedin.com:8443/jobs/view/4012345678').valid).toBe(false);
    expect(validateLinkedInJobUrl('https://untrusted.linkedin.com/jobs/view/4012345678').valid).toBe(false);
    expect(validateLinkedInJobUrl('https://www.linkedin.com/in/some-profile').valid).toBe(false);
    expect(validateLinkedInJobUrl('   ').valid).toBe(false);
  });
});

describe('parseLinkedInSearchListing', () => {
  const sampleSearchHtml = `
    <ul class="jobs-search__results-list">
      <li>
        <div class="base-card job-search-card" data-entity-urn="urn:li:jobPosting:4011111111">
          <a class="base-card__full-link" href="https://az.linkedin.com/jobs/view/audit-assistant-at-deloitte-4011111111?trk=public_jobs">
            <span class="sr-only">Audit Assistant</span>
          </a>
          <h3 class="base-search-card__title">Audit Assistant</h3>
          <h4 class="base-search-card__subtitle">Deloitte Azerbaijan</h4>
          <span class="job-search-card__location">Baku, Azerbaijan</span>
          <time datetime="2026-10-25">2 days ago</time>
        </div>
      </li>
      <li>
        <div class="base-card job-search-card" data-entity-urn="urn:li:jobPosting:4022222222">
          <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/4022222222">
            <span class="sr-only">Senior Cloud Architect</span>
          </a>
          <h3 class="base-search-card__title">Senior Cloud Architect</h3>
          <h4 class="base-search-card__subtitle">Microsoft</h4>
          <span class="job-search-card__location">London, United Kingdom</span>
          <time datetime="2026-10-26">1 day ago</time>
        </div>
      </li>
      <li>
        <div class="base-card job-search-card" data-entity-urn="urn:li:jobPosting:4033333333">
          <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/frontend-developer-at-local-tech-4033333333">
            <span class="sr-only">Frontend Developer</span>
          </a>
          <h3 class="base-search-card__title">Frontend Developer</h3>
          <h4 class="base-search-card__subtitle">Local Tech MMC</h4>
          <span class="job-search-card__location">Sumqayit, Azerbaijan</span>
          <time datetime="2026-10-24">3 days ago</time>
        </div>
      </li>
    </ul>
  `;

  it('parses listing cards, extracts attributes, and filters foreign postings', () => {
    const entries = parseLinkedInSearchListing(sampleSearchHtml);
    expect(entries).toHaveLength(2);

    expect(entries[0]).toEqual({
      id: '4011111111',
      url: 'https://www.linkedin.com/jobs/view/4011111111',
      title: 'Audit Assistant',
      company: 'Deloitte Azerbaijan',
      location: 'Baku, Azerbaijan',
      postedDate: '2026-10-25',
    });

    expect(entries[1]).toEqual({
      id: '4033333333',
      url: 'https://www.linkedin.com/jobs/view/4033333333',
      title: 'Frontend Developer',
      company: 'Local Tech MMC',
      location: 'Sumqayit, Azerbaijan',
      postedDate: '2026-10-24',
    });
  });

  it('keeps missing search-card location unknown and rejects it instead of inventing Baku', () => {
    const html = `<li><div class="job-search-card" data-entity-urn="urn:li:jobPosting:4012345678">
      <a href="https://www.linkedin.com/jobs/view/4012345678"></a><h3>Analyst</h3><h4 class="base-search-card__subtitle">Example MMC</h4>
    </div></li>`;
    const [entry] = parseLinkedInSearchListing(html);
    expect(entry.location).toBe('');
    const detailWithoutLocation = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'JobPosting', title: 'Analyst', description: 'Analyze data.', hiringOrganization: { name: 'Example MMC' },
    })}</script>`;
    expect(() => parseLinkedInJobDetail(detailWithoutLocation, entry.url, new Date(), entry)).toThrow(/not located in Azerbaijan/i);
  });
});

describe('parseLinkedInJobDetail', () => {
  const now = new Date('2026-10-27T12:00:00.000Z');

  const validJsonLdHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Senior Financial Analyst - BP | LinkedIn</title>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "JobPosting",
            "title": "Senior Financial Analyst",
            "description": "<p>Responsible for energy project financial planning and forecasting.</p><ul><li>5+ years experience</li><li>CFA / ACCA preferred</li></ul>",
            "datePosted": "2026-10-25T08:00:00.000Z",
            "validThrough": "2026-11-25T23:59:59.000Z",
            "employmentType": "FULL_TIME",
            "hiringOrganization": {
              "@type": "Organization",
              "name": "BP Azerbaijan",
              "sameAs": "https://www.linkedin.com/company/bp"
            },
            "jobLocation": {
              "@type": "Place",
              "address": {
                "@type": "PostalAddress",
                "addressLocality": "Baku",
                "addressCountry": "AZ"
              }
            }
          }
        </script>
      </head>
      <body>
        <main>
          <h1 class="topcard__title">Senior Financial Analyst</h1>
          <span class="topcard__flavor--bullet">Baku, Azerbaijan</span>
        </main>
      </body>
    </html>
  `;

  it('parses structured JobPosting JSON-LD with high fidelity and cleans HTML description', () => {
    const job = parseLinkedInJobDetail(validJsonLdHtml, 'https://www.linkedin.com/jobs/view/4099999999', now);
    expect(job).toMatchObject({
      externalId: 'linkedin:4099999999',
      title: 'Senior Financial Analyst',
      company: 'BP Azerbaijan',
      location: 'Baku, Azerbaijan',
      url: 'https://www.linkedin.com/jobs/view/4099999999',
      postedAt: '2026-10-25T08:00:00.000Z',
    });
    expect(job.description).toContain('Responsible for energy project financial planning and forecasting.');
    expect(job.description).toContain('5+ years experience');
    expect(job.description).toContain('CFA / ACCA preferred');
    expect(job.deadline).toBeDefined();
  });

  const domFallbackHtml = `
    <!DOCTYPE html>
    <html>
      <head><title>Full Stack Engineer | LinkedIn</title></head>
      <body>
        <main>
          <h1 class="top-card-layout__title">Full Stack Engineer</h1>
          <a class="topcard__org-name-link" href="#">PASHA Pay</a>
          <span class="topcard__flavor--bullet">Baku, Azerbaijan</span>
          <time datetime="2026-10-26T10:00:00.000Z">Yesterday</time>
          <div class="show-more-less-html__markup">
            <p>Looking for Node.js and React developers to join m10 core fintech team.</p>
          </div>
        </main>
      </body>
    </html>
  `;

  it('falls back to semantic DOM selectors when JSON-LD is absent', () => {
    const job = parseLinkedInJobDetail(domFallbackHtml, 'https://www.linkedin.com/jobs/view/4088888888', now);
    expect(job).toMatchObject({
      externalId: 'linkedin:4088888888',
      title: 'Full Stack Engineer',
      company: 'PASHA Pay',
      location: 'Baku, Azerbaijan',
      url: 'https://www.linkedin.com/jobs/view/4088888888',
      postedAt: '2026-10-26T10:00:00.000Z',
    });
    expect(job.description).toContain('Looking for Node.js and React developers');
  });

  it('rejects foreign vacancies not located in Azerbaijan', () => {
    const foreignHtml = `
      <script type="application/ld+json">
        {
          "@type": "JobPosting",
          "title": "Software Engineer",
          "description": "Work in Munich office.",
          "hiringOrganization": { "name": "BMW Group" },
          "jobLocation": { "address": { "addressLocality": "Munich", "addressCountry": "DE" } }
        }
      </script>
    `;
    expect(() =>
      parseLinkedInJobDetail(foreignHtml, 'https://www.linkedin.com/jobs/view/4077777777', now),
    ).toThrow(/not located in Azerbaijan/i);
  });

  it('rejects conflicting country evidence and partial city-name matches', () => {
    expect(isAzerbaijanLocation('Baku, Germany', 'DE')).toBe(false);
    expect(isAzerbaijanLocation('London, United Kingdom', 'AZ')).toBe(false);
    expect(isAzerbaijanLocation('Baku, London')).toBe(false);
    expect(isAzerbaijanLocation('Abakumov, Remote')).toBe(false);
    expect(isAzerbaijanLocation('Baku, Azerbaijan')).toBe(true);
  });

  it('detects closed vacancy signals and rejects them', () => {
    const closedHtml = `
      <div class="top-card-layout__entity-info">
        <h1 class="topcard__title">DevOps Engineer</h1>
        <figure class="closed-job"><figcaption>No longer accepting applications</figcaption></figure>
      </div>
      <script type="application/ld+json">
        {
          "@type": "JobPosting",
          "title": "DevOps Engineer",
          "description": "Maintain cloud pipelines.",
          "hiringOrganization": { "name": "Azercell" },
          "jobLocation": { "address": { "addressLocality": "Baku", "addressCountry": "AZ" } }
        }
      </script>
    `;
    expect(isLinkedInJobClosed(closedHtml)).toBe(true);
    expect(() =>
      parseLinkedInJobDetail(closedHtml, 'https://www.linkedin.com/jobs/view/4066666666', now),
    ).toThrow(/closed and no longer accepting applications/i);
  });

  it('rejects publication dates placed in the future', () => {
    const futureHtml = `
      <script type="application/ld+json">
        {
          "@type": "JobPosting",
          "title": "Data Scientist",
          "description": "Analyze models.",
          "datePosted": "2026-11-20T00:00:00.000Z",
          "hiringOrganization": { "name": "Kapital Bank" },
          "jobLocation": { "address": { "addressLocality": "Baku", "addressCountry": "AZ" } }
        }
      </script>
    `;
    expect(() =>
      parseLinkedInJobDetail(futureHtml, 'https://www.linkedin.com/jobs/view/4055555555', now),
    ).toThrow(/publication date is in the future/i);
  });
});

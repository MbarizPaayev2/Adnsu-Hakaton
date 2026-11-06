import { NotFoundException } from '@nestjs/common';
import {
  extractLinkedInJob,
  fetchLinkedInJobHtml,
} from './linkedin-job.service';

describe('LinkedInJobService', () => {
  let originalFetch: typeof global.fetch;
  let originalApproval: string | undefined;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalApproval = process.env.LINKEDIN_URL_READ_APPROVED;
    process.env.LINKEDIN_URL_READ_APPROVED = 'true';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApproval === undefined) delete process.env.LINKEDIN_URL_READ_APPROVED;
    else process.env.LINKEDIN_URL_READ_APPROVED = originalApproval;
  });

  const validHtml = `
    <html>
      <head>
        <script type="application/ld+json">
          {
            "@type": "JobPosting",
            "title": "Lead Software Architect",
            "description": "Lead core banking transformations.",
            "hiringOrganization": { "name": "Kapital Bank" },
            "jobLocation": { "address": { "addressLocality": "Baku", "addressCountry": "AZ" } },
            "datePosted": "2026-10-26T00:00:00.000Z"
          }
        </script>
      </head>
      <body><main><h1>Lead Software Architect</h1></main></body>
    </html>
  `;

  it('fetches directly when LinkedIn returns HTTP 200 with HTML', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(validHtml));
          controller.close();
        },
      }),
    });

    const res = await fetchLinkedInJobHtml('https://www.linkedin.com/jobs/view/4011223344');
    expect(res.method).toBe('direct');
    expect(res.html).toContain('Lead Software Architect');
  });

  it('does not make automated requests while explicit access approval is absent', async () => {
    delete process.env.LINKEDIN_URL_READ_APPROVED;
    global.fetch = jest.fn();
    await expect(fetchLinkedInJobHtml('https://www.linkedin.com/jobs/view/4011223344')).rejects.toMatchObject({ code: 'ACCESS_REVIEW_PENDING' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each([401, 403, 429, 999])('stops on HTTP %s without sending the URL to a reader proxy', async (status) => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status,
      headers: new Headers(),
      body: { cancel: jest.fn() },
    });

    await expect(fetchLinkedInJobHtml('https://www.linkedin.com/jobs/view/4011223344')).rejects.toMatchObject({ code: 'AUTHWALL_OR_LOGIN_REQUIRED' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(String(jest.mocked(global.fetch).mock.calls[0][0])).toContain('linkedin.com');
  });

  it('stops on an authwall redirect without following it or using a reader proxy', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 302,
      headers: new Headers({ location: 'https://www.linkedin.com/authwall?trk=public_jobs' }),
      body: { cancel: jest.fn() },
    });
    await expect(fetchLinkedInJobHtml('https://www.linkedin.com/jobs/view/4011223344')).rejects.toMatchObject({ code: 'AUTHWALL_OR_LOGIN_REQUIRED' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('extracts complete IngestJobDto via extractLinkedInJob', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(validHtml));
          controller.close();
        },
      }),
    });

    const result = await extractLinkedInJob('https://www.linkedin.com/jobs/view/4011223344');
    expect(result.method).toBe('direct');
    expect(result.job).toMatchObject({
      externalId: 'linkedin:4011223344',
      title: 'Lead Software Architect',
      company: 'Kapital Bank',
      location: 'Baku, Azerbaijan',
      url: 'https://www.linkedin.com/jobs/view/4011223344',
    });
  });

  it('throws NotFoundException on HTTP 404', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers(),
      body: { cancel: jest.fn() },
    });

    await expect(
      fetchLinkedInJobHtml('https://www.linkedin.com/jobs/view/4011223344'),
    ).rejects.toThrow(NotFoundException);
  });
});

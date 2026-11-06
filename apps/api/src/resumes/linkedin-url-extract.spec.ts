import {
  validateLinkedInProfileUrl,
  isLinkedInAuthwall,
  parseLinkedInPublicHtml,
  readStreamWithByteLimit,
  MAX_RESPONSE_BYTES,
  fetchLinkedInProfileHtml,
  extractLinkedInProfileSlug,
  getPersonSlugs,
} from './linkedin-url-extract';
import { parseLinkedInProfile } from './cv-parser';
import { BadRequestException, Logger } from '@nestjs/common';

describe('validateLinkedInProfileUrl', () => {
  it('accepts valid public LinkedIn profile URLs', () => {
    expect(validateLinkedInProfileUrl('https://www.linkedin.com/in/williamhgates')).toMatchObject({
      valid: true,
      username: 'williamhgates',
      normalizedUrl: 'https://www.linkedin.com/in/williamhgates',
    });
    expect(validateLinkedInProfileUrl('https://az.linkedin.com/in/ada-leman/')).toMatchObject({
      valid: true,
      username: 'ada-leman',
    });
    expect(validateLinkedInProfileUrl('linkedin.com/in/rashad-aliyev')).toMatchObject({
      valid: true,
      username: 'rashad-aliyev',
    });
  });

  it('rejects non-LinkedIn URLs and non-profile paths', () => {
    expect(validateLinkedInProfileUrl('https://google.com')).toMatchObject({ valid: false });
    expect(validateLinkedInProfileUrl('https://www.linkedin.com/feed/')).toMatchObject({ valid: false });
    expect(validateLinkedInProfileUrl('https://www.linkedin.com/jobs/view/12345')).toMatchObject({ valid: false });
    expect(validateLinkedInProfileUrl('')).toMatchObject({ valid: false });
  });

  it('handles malformed percent encoding gracefully without throwing unhandled URIError', () => {
    // Lone percent sign
    expect(validateLinkedInProfileUrl('https://www.linkedin.com/in/%')).toMatchObject({
      valid: false,
      error: expect.stringContaining('kodlaşdırma xətası'),
    });
    // Incomplete UTF-8 sequence
    expect(validateLinkedInProfileUrl('https://www.linkedin.com/in/%E0%A4%A')).toMatchObject({
      valid: false,
      error: expect.stringContaining('kodlaşdırma xətası'),
    });
    // Trailing percent
    expect(validateLinkedInProfileUrl('https://www.linkedin.com/in/alex%')).toMatchObject({
      valid: false,
      error: expect.stringContaining('kodlaşdırma xətası'),
    });
  });

  it('rejects encoded path separators and invalid characters in the slug', () => {
    // Encoded forward slash (%2F)
    expect(validateLinkedInProfileUrl('https://www.linkedin.com/in/alex%2Fsmith')).toMatchObject({
      valid: false,
      error: expect.stringContaining('yol ayırıcısı'),
    });
    // Encoded backslash (%5C)
    expect(validateLinkedInProfileUrl('https://www.linkedin.com/in/alex%5Csmith')).toMatchObject({
      valid: false,
      error: expect.stringContaining('yol ayırıcısı'),
    });
  });

  it('accepts and decodes valid international unicode slugs', () => {
    expect(validateLinkedInProfileUrl('https://www.linkedin.com/in/f%C9%99rhad-m%C9%99mm%C9%99dov')).toMatchObject({
      valid: true,
      username: 'fərhad-məmmədov',
      normalizedUrl: 'https://www.linkedin.com/in/f%C9%99rhad-m%C9%99mm%C9%99dov',
    });
  });

  it('rejects embedded credentials and non-standard ports', () => {
    expect(validateLinkedInProfileUrl('https://user:password@www.linkedin.com/in/ada-leman')).toMatchObject({
      valid: false,
      error: expect.stringContaining('istifadəçi adı və ya şifrə'),
    });
    expect(validateLinkedInProfileUrl('https://www.linkedin.com:8080/in/ada-leman')).toMatchObject({
      valid: false,
      error: expect.stringContaining('qeyri-standart port'),
    });
  });

  it('blocks SSRF attempts on internal IPs and loopbacks', () => {
    expect(validateLinkedInProfileUrl('http://169.254.169.254/in/test')).toMatchObject({ valid: false });
    expect(validateLinkedInProfileUrl('http://127.0.0.1/in/test')).toMatchObject({ valid: false });
    expect(validateLinkedInProfileUrl('http://localhost:3000/in/test')).toMatchObject({ valid: false });
    expect(validateLinkedInProfileUrl('https://notlinkedin.com/in/test')).toMatchObject({ valid: false });
  });
});

describe('isLinkedInAuthwall', () => {
  it('detects authwall redirects and login challenge pages', () => {
    const authwallHtml = `
      <html><head>
      <script>window.location.href = "https://www.linkedin.com/authwall?trk=bf&trkInfo=bf";</script>
      </head><body></body></html>
    `;
    expect(isLinkedInAuthwall(authwallHtml)).toBe(true);
    expect(isLinkedInAuthwall('<title>Sign In | LinkedIn</title>')).toBe(true);
    expect(isLinkedInAuthwall('<div data-section="authwall">Please sign in</div>')).toBe(true);
  });

  it('returns false for public profile markup', () => {
    const publicHtml = '<title>Bill Gates - Co-chair | LinkedIn</title><ul class="experience__list"></ul>';
    expect(isLinkedInAuthwall(publicHtml)).toBe(false);
  });
});

describe('parseLinkedInPublicHtml', () => {
  const SAMPLE_PUBLIC_HTML = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <title>Ada Leman - Senior Data Analyst at Northwind | LinkedIn</title>
      <script type="application/ld+json">
      {
        "@context": "http://schema.org",
        "@graph": [
          {
            "@type": "Article",
            "headline": "Some industry article",
            "author": {
              "@type": "Person",
              "name": "Another Author",
              "url": "https://www.linkedin.com/in/another-author"
            }
          },
          {
            "@type": "Person",
            "name": "Ada Leman",
            "url": "https://www.linkedin.com/in/ada-leman",
            "jobTitle": ["Senior Data Analyst"],
            "description": "Experienced analyst focusing on retail banking and product experiments.",
            "address": {
              "@type": "PostalAddress",
              "addressLocality": "Baku, Azerbaijan",
              "addressCountry": "AZ"
            }
          }
        ]
      }
      </script>
    </head>
    <body>
      <ul class="experience__list">
        <li class="profile-section-card experience-item">
          <span class="experience-item__title">Senior Data Analyst</span>
          <span class="experience-item__subtitle">Northwind Technologies</span>
          <span class="date-range"><time>2024</time> - Present 1 year</span>
          <p class="show-more-less-text__text--more">Built a churn prediction model for 10,000 customers.</p>
        </li>
        <li class="profile-section-card experience-item">
          <span class="experience-item__title">Research Analyst</span>
          <span class="experience-item__subtitle">Acme Advisory</span>
          <span class="date-range"><time>2022</time> - <time>2024</time> 2 years</span>
          <p class="show-more-less-text__text--more">Designed limited-assurance sustainability audit methodology.</p>
        </li>
      </ul>
      <ul class="education__list">
        <li class="profile-section-card education__list-item">
          <a data-tracking-control-name="public_profile_school">Baku State University</a>
          <h4 class="text-color-text [&amp;>*]:mb-0">Bachelor's degree, Computer Science</h4>
          <span class="date-range"><time>2018</time> - <time>2022</time></span>
        </li>
      </ul>
    </body>
    </html>
  `;

  it('correctly disambiguates target Person from graph and extracts fields', () => {
    const profile = parseLinkedInPublicHtml(SAMPLE_PUBLIC_HTML, 'https://www.linkedin.com/in/ada-leman');
    expect(profile.name).toBe('Ada Leman');
    expect(profile.headline).toBe('Senior Data Analyst at Northwind');
    expect(profile.location).toBe('Baku, Azerbaijan');
    expect(profile.summary).toContain('Experienced analyst');
    expect(profile.roles).toHaveLength(2);
    expect(profile.roles[0]).toMatchObject({
      title: 'Senior Data Analyst',
      company: 'Northwind Technologies',
      dates: '2024 - Present',
      description: 'Built a churn prediction model for 10,000 customers.',
    });
    expect(profile.roles[1]).toMatchObject({
      title: 'Research Analyst',
      company: 'Acme Advisory',
      dates: '2022 - 2024',
    });
    expect(profile.schools).toHaveLength(1);
    expect(profile.schools[0]).toMatchObject({
      institution: 'Baku State University',
      detail: "Bachelor's degree, Computer Science",
      dates: '2018 - 2022',
    });
  });

  it('converts parsed public profile into structured ParsedCv for review', () => {
    const profile = parseLinkedInPublicHtml(SAMPLE_PUBLIC_HTML, 'https://www.linkedin.com/in/ada-leman');
    const cv = parseLinkedInProfile(profile, { email: 'ada@example.com' });
    expect(cv.personalInfo.name).toBe('Ada Leman');
    expect(cv.personalInfo.email).toBe('ada@example.com');
    expect(cv.workExperience).toHaveLength(2);
    expect(cv.workExperience[0].title).toBe('Senior Data Analyst');
    expect(cv.workExperience[0].startDate).toBe('2024-01-01T00:00:00.000Z');
    expect(cv.education).toHaveLength(1);
    expect(cv.education[0].institution).toBe('Baku State University');
    expect(cv.extracted).toEqual(expect.arrayContaining(['name', 'headline', 'location', 'workExperience', 'education']));
  });

  it('throws BadRequestException with actionable message when authwall is met', () => {
    const authwall = '<html><script>window.location.href="https://www.linkedin.com/authwall";</script></html>';
    expect(() => parseLinkedInPublicHtml(authwall, 'https://www.linkedin.com/in/private-user')).toThrow(BadRequestException);
  });

  it('rejects an empty or stripped profile without experience/education and guides user to PDF fallback', () => {
    const emptyProfileHtml = `
      <!DOCTYPE html>
      <html><head><title>John Doe | LinkedIn</title></head><body><div class="empty-layout"></div></body></html>
    `;
    expect(() => parseLinkedInPublicHtml(emptyProfileHtml, 'https://www.linkedin.com/in/johndoe')).toThrow(BadRequestException);
  });

  describe('exact identity matching & non-contamination (Finding 1 regressions)', () => {
    it('resolves exact slug match during prefix collision (e.g. /in/alex vs /in/alexander)', () => {
      const collisionHtml = `
        <!DOCTYPE html>
        <html><head>
          <title>Alex - Specialist | LinkedIn</title>
          <script type="application/ld+json">
          {
            "@context": "http://schema.org",
            "@graph": [
              {
                "@type": "Person",
                "name": "Alexander Great",
                "url": "https://www.linkedin.com/in/alexander",
                "worksFor": [{ "@type": "Organization", "name": "Wrong Employer Ltd" }]
              },
              {
                "@type": "Person",
                "name": "Alex Smith",
                "url": "https://www.linkedin.com/in/alex",
                "worksFor": [{ "@type": "Organization", "name": "Right Employer LLC" }]
              }
            ]
          }
          </script>
        </head><body></body></html>
      `;
      const profile = parseLinkedInPublicHtml(collisionHtml, 'https://www.linkedin.com/in/alex');
      expect(profile.name).toBe('Alex Smith');
      expect(profile.roles).toHaveLength(1);
      expect(profile.roles[0].company).toBe('Right Employer LLC');
      expect(profile.roles[0].company).not.toBe('Wrong Employer Ltd');
    });

    it('does NOT fall back to an unrelated person when target slug is not present (mismatched-only)', () => {
      const mismatchHtml = `
        <!DOCTYPE html>
        <html><head>
          <title>Alex Smith - Candidate | LinkedIn</title>
          <script type="application/ld+json">
          {
            "@context": "http://schema.org",
            "@type": "Person",
            "name": "Wrong Alexander",
            "url": "https://www.linkedin.com/in/alexander",
            "worksFor": [{ "@type": "Organization", "name": "Alexander Employer" }]
          }
          </script>
        </head><body></body></html>
      `;
      // When target is /in/alex and only /in/alexander exists in JSON-LD with no HTML experience,
      // it must NEVER contaminate Alex's profile with Alexander's employment, and should reject as incomplete.
      expect(() => parseLinkedInPublicHtml(mismatchHtml, 'https://www.linkedin.com/in/alex')).toThrow(BadRequestException);
    });

    it('matches target identity via sameAs array', () => {
      const sameAsHtml = `
        <!DOCTYPE html>
        <html><head>
          <title>Alex Profile | LinkedIn</title>
          <script type="application/ld+json">
          {
            "@context": "http://schema.org",
            "@type": "Person",
            "name": "Alex MultiIdentity",
            "url": "https://www.linkedin.com/pub/alex/0/1/2",
            "sameAs": [
              "https://twitter.com/alex",
              "https://www.linkedin.com/in/alex"
            ],
            "worksFor": [{ "@type": "Organization", "name": "SameAs Partner LLC" }]
          }
          </script>
        </head><body></body></html>
      `;
      const profile = parseLinkedInPublicHtml(sameAsHtml, 'https://www.linkedin.com/in/alex');
      expect(profile.name).toBe('Alex MultiIdentity');
      expect(profile.roles[0].company).toBe('SameAs Partner LLC');
    });

    it('matches exact identity when URL contains percent-encoded international characters', () => {
      const encodedHtml = `
        <!DOCTYPE html>
        <html><head>
          <title>Fərhad Məmmədov | LinkedIn</title>
          <script type="application/ld+json">
          {
            "@context": "http://schema.org",
            "@type": "Person",
            "name": "Fərhad Məmmədov",
            "url": "https://www.linkedin.com/in/fərhad-məmmədov",
            "worksFor": [{ "@type": "Organization", "name": "Bakı İnnovasiya MMC" }]
          }
          </script>
        </head><body></body></html>
      `;
      const profile = parseLinkedInPublicHtml(encodedHtml, 'https://www.linkedin.com/in/f%C9%99rhad-m%C9%99mm%C9%99dov');
      expect(profile.name).toBe('Fərhad Məmmədov');
      expect(profile.roles[0].company).toBe('Bakı İnnovasiya MMC');
    });
  });

  describe('bounded streaming downloads & response size limit (Finding 2 regressions)', () => {
    it('aborts chunked stream exceeding 2MiB even without Content-Length header', async () => {
      const chunk1 = new Uint8Array(1.2 * 1024 * 1024).fill(65); // 1.2 MiB
      const chunk2 = new Uint8Array(1.2 * 1024 * 1024).fill(66); // 1.2 MiB (total 2.4 MiB)
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(chunk1);
          controller.enqueue(chunk2);
          controller.close();
        },
      });

      await expect(readStreamWithByteLimit(stream, MAX_RESPONSE_BYTES)).rejects.toThrow(
        expect.objectContaining({ message: expect.stringContaining('çox böyükdür (maksimum 2MB)') }),
      );
    });

    it('aborts and cancels reader immediately upon exceeding limit before consuming further body content', async () => {
      const cancelSpy = jest.fn();
      const chunk1 = new Uint8Array(2.1 * 1024 * 1024).fill(65); // > 2 MiB
      const chunk2 = new Uint8Array(1024).fill(66);

      let chunkIdx = 0;
      const readerStream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (chunkIdx === 0) {
            controller.enqueue(chunk1);
            chunkIdx++;
          } else if (chunkIdx === 1) {
            controller.enqueue(chunk2);
            chunkIdx++;
          } else {
            controller.close();
          }
        },
        cancel(reason) {
          cancelSpy(reason);
        },
      });

      // Wrap reader to monitor and verify calls to read()
      const originalGetReader = readerStream.getReader.bind(readerStream);
      let readCallCount = 0;
      readerStream.getReader = () => {
        const r = originalGetReader();
        const origRead = r.read.bind(r);
        r.read = async () => {
          readCallCount++;
          return origRead();
        };
        return r;
      };

      const abortController = new AbortController();
      await expect(readStreamWithByteLimit(readerStream, MAX_RESPONSE_BYTES, abortController)).rejects.toThrow(BadRequestException);
      expect(abortController.signal.aborted).toBe(true);
      expect(cancelSpy).toHaveBeenCalledWith('Exceeded maximum response size of 2MiB');
      expect(readCallCount).toBe(1); // exactly 1 read() was performed; stream aborted before reading chunk 2
    });

    it('enforces UTF-8 byte count bound rather than character length on multibyte content', async () => {
      // 1,200,000 occurrences of 'ə' (2-byte UTF-8 character):
      // Character count: 1,200,000 (< 2M characters)
      // Byte count: 2,400,000 bytes (> 2 MiB = 2,097,152 bytes)
      const azCharBytes = Buffer.from('ə', 'utf8'); // 2 bytes
      const numChars = 1_200_000;
      const totalBytes = Buffer.alloc(numChars * azCharBytes.length);
      for (let i = 0; i < numChars; i++) {
        azCharBytes.copy(totalBytes, i * azCharBytes.length);
      }

      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array(totalBytes.buffer));
          c.close();
        },
      });

      await expect(readStreamWithByteLimit(stream, MAX_RESPONSE_BYTES)).rejects.toThrow(BadRequestException);
    });

    it('cancels unused redirect response bodies before following redirects', async () => {
      const cancelRedirectSpy = jest.fn(async () => {});
      const redirectStream = {
        cancel: cancelRedirectSpy,
      };

      const realFetch = globalThis.fetch;
      try {
        let callCount = 0;
        globalThis.fetch = jest.fn(async (url: any) => {
          callCount++;
          if (callCount === 1) {
            return {
              status: 302,
              headers: new Headers({ location: 'https://www.linkedin.com/in/ada-leman-redirected' }),
              body: redirectStream,
            } as any;
          }
          return {
            status: 200,
            ok: true,
            headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
            text: async () => '<html><head><title>Redirected Ada | LinkedIn</title></head><body></body></html>',
          } as any;
        });

        await fetchLinkedInProfileHtml('https://www.linkedin.com/in/ada-leman');
        expect(cancelRedirectSpy).toHaveBeenCalled();
      } finally {
        globalThis.fetch = realFetch;
      }
    });
  });
});


describe('LinkedIn access and redirect recovery', () => {
  afterEach(() => jest.restoreAllMocks());
  it('keeps profile URLs and fetch error text out of operational logs', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('network request failed for https://www.linkedin.com/in/private-profile-slug'));

    await expect(fetchLinkedInProfileHtml('https://www.linkedin.com/in/private-profile-slug')).rejects.toThrow('PDF');

    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain('TypeError');
    expect(logged).not.toContain('private-profile-slug');
    expect(logged).not.toContain('linkedin.com');
  });
  it.each([401, 403, 429, 999])('offers an actionable fallback for access restriction %s', async (status) => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ status, ok: false, body: { cancel: jest.fn().mockResolvedValue(undefined) }, headers: new Headers() } as any);
    await expect(fetchLinkedInProfileHtml('https://www.linkedin.com/in/synthetic-profile')).rejects.toThrow('PDF');
  });
  it('does not treat tracking parameters on an allowed profile redirect as a login wall', async () => {
    const fetch = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://www.linkedin.com/in/synthetic-profile?trkInfo=public' } }))
      .mockResolvedValueOnce(new Response('<html><body>Public profile</body></html>', { headers: { 'Content-Type': 'text/html' } }));
    await expect(fetchLinkedInProfileHtml('https://www.linkedin.com/in/synthetic-profile')).resolves.toContain('Public profile');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

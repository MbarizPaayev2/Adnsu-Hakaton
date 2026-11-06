import { logoMimeOf, parseLogoArgs, publicHttpsUrl } from './set-observed-company-logo';

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);

describe('set-observed-company-logo', () => {
  it('accepts only real PNG, JPEG and WEBP bytes, whatever the file is called', () => {
    expect(logoMimeOf(png)).toBe('image/png');
    expect(logoMimeOf(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe('image/jpeg');
    expect(logoMimeOf(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]))).toBe('image/webp');
    expect(logoMimeOf(Buffer.from('<svg onload="x()"></svg>'))).toBeNull();
    expect(logoMimeOf(Buffer.from('%PDF-1.4'))).toBeNull();
  });

  it('requires a public https source page', () => {
    expect(publicHttpsUrl('https://www.socar.az/#x')).toBe('https://www.socar.az/');
    for (const bad of ['http://socar.az', 'https://user:pw@socar.az', 'https://127.0.0.1/x', 'https://localhost/x', 'file:///etc/passwd']) expect(() => publicHttpsUrl(bad)).toThrow();
  });

  it('demands the company, the file, a known source kind and where the logo was published', () => {
    const ok = ['--company', 'SOCAR', '--file', 'a.png', '--source', 'employer_website', '--source-url', 'https://www.socar.az/'];
    expect(parseLogoArgs(ok)).toMatchObject({ company: 'SOCAR', source: 'employer_website', apply: false });
    expect(parseLogoArgs([...ok, '--apply']).apply).toBe(true);
    expect(() => parseLogoArgs(ok.slice(0, 6))).toThrow(/source-url|source/);
    expect(() => parseLogoArgs(['--company', 'x', '--file', 'a.png', '--source', 'scraped', '--source-url', 'https://x.az'])).toThrow(/--source must be/);
    expect(() => parseLogoArgs(['--company', '— —', '--file', 'a', '--source', 'employer_website', '--source-url', 'https://x.az'])).toThrow(/company/);
  });
});

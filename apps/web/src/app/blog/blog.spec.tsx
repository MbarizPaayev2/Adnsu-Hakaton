import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  getAllArticles,
  getArticleBySlug,
  BLOG_ARTICLES,
} from '@/lib/blog/articles';
import { MarkdownContent } from '@/components/blog/markdown-content';
import BlogIndexPage, { metadata as blogIndexMetadata } from './page';
import BlogDetailPage, {
  generateMetadata as generateDetailMetadata,
  generateStaticParams,
} from './[slug]/page';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  permanentRedirect: vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

describe('Blog Articles Data & Helpers', () => {
  it('contains seven guides with junior and mid/senior interactive tools', () => {
    const articles = getAllArticles();
    expect(articles).toHaveLength(7);

    const slugs = articles.map((a) => a.slug);
    expect(slugs).toContain('cv-nece-yazilir');
    expect(slugs).toContain('ats-uygun-cv');
    expect(slugs).toContain('musahibeye-hazirliq-star-metodu');
    expect(slugs).toContain('motivasiya-mektubu-nece-yazilir');
  });

  it('provides complete required metadata for every article', () => {
    for (const article of BLOG_ARTICLES) {
      expect(article.slug).toBeTruthy();
      expect(article.title).toBeTruthy();
      expect(article.description).toBeTruthy();
      expect(article.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(article.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(article.readTimeMinutes).toBeGreaterThan(0);
      expect(article.tags.length).toBeGreaterThan(0);
      expect(article.author.name).toBe('AISE');
      expect(['https://aisehr.com','https://aisehr.com/about']).toContain(article.author.url);
      expect(article.body.length).toBeGreaterThan(200);
    }
  });

  it('resolves articles by primary slug and case-insensitively', () => {
    const a1 = getArticleBySlug('cv-nece-yazilir');
    expect(a1?.title).toContain('CV necə yazılır');

    const a2 = getArticleBySlug('CV-NECE-YAZILIR ');
    expect(a2?.title).toBe(a1?.title);

    const missing = getArticleBySlug('non-existent-article');
    expect(missing).toBeUndefined();
  });

  it('resolves articles by aliases correctly', () => {
    expect(getArticleBySlug('cv-nece-yazilir-vakansiyaya-uygun-rezume')?.slug).toBe(
      'cv-nece-yazilir'
    );
    expect(getArticleBySlug('ats-e-uygun-cv')?.slug).toBe('ats-uygun-cv');
    expect(getArticleBySlug('ats-cv')?.slug).toBe('ats-uygun-cv');
    expect(getArticleBySlug('musahibeye-hazirliq')?.slug).toBe(
      'musahibeye-hazirliq-star-metodu'
    );
    expect(getArticleBySlug('star-metodu')?.slug).toBe(
      'musahibeye-hazirliq-star-metodu'
    );
    expect(getArticleBySlug('motivasiya-mektubu')?.slug).toBe(
      'motivasiya-mektubu-nece-yazilir'
    );
    expect(getArticleBySlug('cover-letter-nece-yazilir')?.slug).toBe(
      'motivasiya-mektubu-nece-yazilir'
    );
  });

  it('complies with product guidelines: uses "ödənişsiz", never "pulsuz", and clarifies conditional examples', () => {
    for (const article of BLOG_ARTICLES) {
      // Must not use the word pulsuz
      expect(article.body.toLowerCase()).not.toContain('pulsuz');
      // When examples are given, they should clearly indicate Nümunə (şərti)
      if (article.body.includes('Nümunə')) {
        expect(article.body).toMatch(/Nümunə\s*\((?:şərti|uydurma)\)/i);
      }
    }
  });
});

describe('MarkdownContent Component', () => {
  it('renders headings, bold, code, and links properly', () => {
    const content = `## Bölmə 1

Bu bir mətn və **qalın sözdür**, həmçinin \`kod parçası\`.

[Vakansiyalar](/jobs) və xarici keçid [MIT](https://mitcommlab.mit.edu).

> **Nümunə (şərti):** Bu sitat və ya nümunədir.

- Bənd bir
- Bənd iki

1. Birinci addım
2. İkinci addım`;

    const { container } = render(<MarkdownContent content={content} />);

    expect(screen.getByRole('heading', { level: 2, name: 'Bölmə 1' })).toBeInTheDocument();
    expect(container.querySelector('strong')?.textContent).toBe('qalın sözdür');
    expect(container.querySelector('code')?.textContent).toBe('kod parçası');

    const internalLink = screen.getByRole('link', { name: 'Vakansiyalar' });
    expect(internalLink).toHaveAttribute('href', '/jobs');

    const externalLink = screen.getByRole('link', { name: 'MIT' });
    expect(externalLink).toHaveAttribute('href', 'https://mitcommlab.mit.edu');
    expect(externalLink).toHaveAttribute('target', '_blank');

    expect(container.querySelector('blockquote')).toBeInTheDocument();
    expect(container.querySelectorAll('li')).toHaveLength(4);
  });
});

describe('Blog Listing Page', () => {
  it('renders page header and metadata correctly', () => {
    expect(blogIndexMetadata.title).toBe('Karyera bələdçisi və məqalələr — AISE');
    expect(blogIndexMetadata.alternates?.canonical).toBe('https://aisehr.com/blog');

    const { container } = render(<BlogIndexPage />);

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'CV və karyera bələdçiləri',
      })
    ).toBeInTheDocument();

    // Renders all 4 article titles
    for (const article of BLOG_ARTICLES) {
      expect(screen.getByText(article.title)).toBeInTheDocument();
    }

    // Disclaimer is visible
    expect(
      screen.getByText(/Nümunələr şərtidir/i)
    ).toBeInTheDocument();

    // Contains BreadcrumbList script
    const scripts = container.querySelectorAll('script[type="application/ld+json"]');
    expect(scripts.length).toBeGreaterThan(0);
    const parsed = JSON.parse(scripts[0].innerHTML);
    expect(parsed['@type']).toBe('BreadcrumbList');
  });
});

describe('Blog Detail Page', () => {
  it('generates static params for all articles', async () => {
    const params = await generateStaticParams();
    expect(params).toHaveLength(7);
    expect(params.map((p) => p.slug)).toEqual([
      'cv-nece-yazilir',
      'ats-uygun-cv',
      'musahibeye-hazirliq-star-metodu',
      'motivasiya-mektubu-nece-yazilir',
      'junior-data-analyst-cv-sql-power-bi',
      'junior-proqramci-cv-github-muraciet',
      'mid-senior-cv-nailiyyet-qerar-tesir',
    ]);
  });

  it('generates appropriate metadata for an article', async () => {
    const meta = await generateDetailMetadata({
      params: Promise.resolve({ slug: 'cv-nece-yazilir' }),
    });

    expect(meta.title).toContain('CV necə yazılır');
    expect(meta.title).toContain('AISE');
    expect(meta.description).toContain('CV başlığını');
    expect(meta.alternates?.canonical).toBe(
      'https://aisehr.com/blog/cv-nece-yazilir'
    );
  });

  it('generates fallback metadata for unknown slug', async () => {
    const meta = await generateDetailMetadata({
      params: Promise.resolve({ slug: 'unknown-slug' }),
    });
    expect(meta.title).toBe('Məqalə tapılmadı — AISE');
  });

  it('renders article detail, breadcrumbs, JSON-LD, and related articles', async () => {
    const Component = await BlogDetailPage({
      params: Promise.resolve({ slug: 'ats-uygun-cv' }),
    });

    const { container } = render(Component);

    // Breadcrumbs
    const breadcrumbNav = screen.getByRole('navigation', {
      name: 'Səhifə naviqasiyası',
    });
    expect(breadcrumbNav).toHaveTextContent('Ana səhifə');
    expect(breadcrumbNav).toHaveTextContent('Karyera bələdçisi');

    // Article heading
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /ATS-uyğun CV: format, açar sözlər və yayılmış səhvlər/i,
      })
    ).toBeInTheDocument();

    // Disclaimer
    expect(
      screen.getByText(/Məqalədəki şirkət və namizəd detalları metodiki nümayiş məqsədilə şərti nümunə/i)
    ).toBeInTheDocument();

    // Related articles section
    expect(screen.getByRole('heading', { level: 2, name: 'Digər bələdçilər' })).toBeInTheDocument();

    // JSON-LD scripts
    const scripts = container.querySelectorAll('script[type="application/ld+json"]');
    expect(scripts.length).toBe(2);

    const blogPosting = JSON.parse(scripts[0].innerHTML);
    expect(blogPosting['@type']).toBe('BlogPosting');
    expect(blogPosting.headline).toContain('ATS-uyğun CV');

    const breadcrumbs = JSON.parse(scripts[1].innerHTML);
    expect(breadcrumbs['@type']).toBe('BreadcrumbList');
  });

  it('redirects aliases and case variants to a single canonical URL', async () => {
    for (const slug of ['ats-cv', 'ATS-UYGUN-CV']) {
      await expect(BlogDetailPage({ params: Promise.resolve({ slug }) }))
        .rejects.toThrow('NEXT_REDIRECT:/blog/ats-uygun-cv');
    }
  });

  it('throws notFound for non-existent slug', async () => {
    await expect(
      BlogDetailPage({
        params: Promise.resolve({ slug: 'completely-non-existent-article' }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('Sitemap Blog Integration', () => {
  it('derives article and blog lastModified from maintained article metadata', async () => {
    const { default: sitemap } = await import('@/app/sitemap');
    const entries = sitemap();

    const blogEntry = entries.find((e) => e.url.endsWith('/blog'));
    expect(blogEntry).toBeDefined();
    expect(blogEntry?.lastModified).toEqual(new Date('2026-10-25T00:00:00.000Z'));

    const cvEntry = entries.find((e) => e.url.endsWith('/blog/cv-nece-yazilir'));
    expect(cvEntry).toBeDefined();
    expect(cvEntry?.lastModified).toEqual(new Date('2026-10-20T00:00:00.000Z'));
  });
});

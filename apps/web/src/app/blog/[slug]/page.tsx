import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { ArrowLeft, ArrowRight, Calendar, Clock, User, ChevronRight, AlertCircle, BookOpen } from 'lucide-react';
import { SiteNav } from '@/components/landing/site-nav';
import { SiteFooter } from '@/components/landing/site-footer';
import { ArticleTool } from '@/components/blog/article-tool';
import { articleHeadings } from '@/lib/blog/headings';
import { MarkdownContent } from '@/components/blog/markdown-content';
import { getAllArticles, getArticleBySlug } from '@/lib/blog/articles';
import { formatDate } from '@/lib/format';

export async function generateStaticParams() {
  const articles = getAllArticles();
  return articles.map((article) => ({
    slug: article.slug,
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = getArticleBySlug(slug);

  if (!article) {
    return {
      title: 'Məqalə tapılmadı — AISE',
    };
  }

  const url = `https://aisehr.com/blog/${article.slug}`;

  return {
    title: `${article.title} — AISE`,
    description: article.description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      title: `${article.title} — AISE`,
      description: article.description,
      url,
      siteName: 'AISE',
      locale: 'az_AZ',
      type: 'article',
      publishedTime: article.publishedAt,
      modifiedTime: article.updatedAt,
      authors: [article.author.name],
      tags: article.tags,
      images: [{ url: `${url}/opengraph-image`, width: 1200, height: 630, alt: article.title }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${article.title} — AISE`,
      description: article.description,
      images: [`${url}/opengraph-image`],
    },
  };
}

export default async function BlogDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getArticleBySlug(slug);

  if (!article) {
    notFound();
  }

  const allArticles = getAllArticles();
  const relatedArticles = allArticles
    .filter((a) => a.slug !== article.slug)
    .sort((a,b) => {
      const overlap = (tags: string[]) => tags.filter(tag => article.tags.includes(tag)).length;
      return overlap(b.tags) - overlap(a.tags) || b.updatedAt.localeCompare(a.updatedAt);
    })
    .slice(0, 3);

  if (slug !== article.slug) permanentRedirect(`/blog/${article.slug}`);
  const headings = articleHeadings(article.body);

  const articleUrl = `https://aisehr.com/blog/${article.slug}`;

  const blogPostingJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: article.title,
    image: `${articleUrl}/opengraph-image`,
    description: article.description,
    inLanguage: 'az-AZ',
    isAccessibleForFree: true,
    '@id': `${articleUrl}#article`,
    datePublished: article.publishedAt,
    dateModified: article.updatedAt,
    author: {
      '@type': 'Organization',
      name: article.author.name,
      url: article.author.url,
    },
    publisher: {
      '@type': 'Organization',
      '@id': 'https://aisehr.com/#organization',
      name: 'AISE',
      url: 'https://aisehr.com',
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': articleUrl,
    },
    keywords: article.tags.join(', '),
  };

  const breadcrumbsJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Ana səhifə',
        item: 'https://aisehr.com',
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Karyera bələdçisi',
        item: 'https://aisehr.com/blog',
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: article.title,
        item: articleUrl,
      },
    ],
  };

  return (
    <div className="grow bg-background font-body-md text-body-md text-on-background flex flex-col min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(blogPostingJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJsonLd) }}
      />
      <SiteNav />

      <main className="grow pt-28 pb-20 md:pt-36 md:pb-28 px-gutter md:px-landing-xl">
        <article className="max-w-3xl mx-auto space-y-10">
          {/* Breadcrumbs */}
          <nav aria-label="Səhifə naviqasiyası" className="flex items-center gap-1.5 text-xs sm:text-sm text-on-surface-variant overflow-x-auto whitespace-nowrap py-1">
            <Link href="/" className="hover:text-primary transition-colors">
              Ana səhifə
            </Link>
            <ChevronRight className="w-3.5 h-3.5 shrink-0 text-outline-variant" aria-hidden="true" />
            <Link href="/blog" className="hover:text-primary transition-colors">
              Karyera bələdçisi
            </Link>
            <ChevronRight className="w-3.5 h-3.5 shrink-0 text-outline-variant" aria-hidden="true" />
            <span className="text-on-background font-medium truncate max-w-[200px] sm:max-w-[320px]" aria-current="page">
              {article.title}
            </span>
          </nav>

          {/* Header */}
          <header className="space-y-4 pt-2">
            <div className="flex flex-wrap gap-2">
              {article.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20"
                >
                  {tag}
                </span>
              ))}
            </div>

            <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-serif font-bold text-on-background tracking-tight leading-tight">
              {article.title}
            </h1>

            <p className="text-base sm:text-lg text-on-surface-variant leading-relaxed">
              {article.description}
            </p>

            <div className="pt-2 flex flex-wrap items-center gap-4 sm:gap-6 text-xs sm:text-sm text-on-surface-variant border-b border-outline-variant/40 pb-6">
              <span className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-primary" aria-hidden="true" />
                <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-primary" aria-hidden="true" />
                <span>{article.readTimeMinutes} dəqiqəlik oxu</span>
              </span>
              <span className="flex items-center gap-1.5">
                <User className="w-4 h-4 text-primary" aria-hidden="true" />
                <span>Müəllif: {article.author.name}</span>
              </span>
            </div>
          </header>

          {article.quickAnswer && <section aria-label="Qısa cavab" className="border-l-4 border-primary pl-4"><h2 className="text-xs font-semibold uppercase tracking-wide text-primary">Qısa cavab</h2><p className="mt-2 leading-relaxed">{article.quickAnswer}</p></section>}
          <details className="rounded-xl border border-outline-variant p-4"><summary className="cursor-pointer font-semibold text-sm">Bu bələdçidə nələr var?</summary><nav aria-label="Məqalənin məzmunu" className="mt-3"><ul className="space-y-2 text-sm">{article.tool && <li><a className="text-primary underline" href="#praktik-alet">İnteraktiv aləti sına</a></li>}{headings.map(h=><li key={h.id}><a className="text-primary hover:underline" href={`#${h.id}`}>{h.title}</a></li>)}</ul></nav></details>
          {article.tool && <ArticleTool kind={article.tool}/>}

          {/* Fictional disclaimer note */}
          <aside
            aria-label="Şərti nümunələr haqqında qeyd"
            className="rounded-xl border border-outline-variant/40 bg-surface-container-low/40 px-4 py-3 text-xs text-on-surface-variant flex items-center gap-2.5"
          >
            <AlertCircle className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
            <p className="leading-relaxed">
              Məqalədəki şirkət və namizəd detalları metodiki nümayiş məqsədilə şərti nümunə (<strong>Nümunə (şərti)</strong>) kimi verilib; sənədlərdə yalnız öz təsdiqlənmiş faktlarınızı qeyd edin. AISE işə qəbul zəmanəti vermir.
            </p>
          </aside>

          {/* Article Body */}
          <section aria-label="Məqalənin mətni" className="pt-2">
            <MarkdownContent content={article.body} />
          </section>

          {/* Post-article note */}
          <section className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-5 sm:p-6 text-xs sm:text-sm text-on-surface-variant space-y-2">
            <h2 className="font-semibold text-on-background text-sm sm:text-base">
              Yekun tövsiyə və növbəti addımlar
            </h2>
            <p className="leading-relaxed">
              Müraciət etdiyiniz hər vəzifə üçün tələbləri diqqətlə oxuyun və sənədlərinizi yalnız həqiqi təcrübənizə uyğunlaşdırın. Azərbaycan əmək bazarında toplanmış vakansiyalara baxmaq üçün <Link href="/jobs" className="text-primary underline">bütün vakansiyalar</Link> səhifəsini ziyarət edə bilərsiniz.
            </p>
          </section>

          {/* Back link */}
          <div className="pt-4 pb-2 border-b border-outline-variant/40">
            <Link
              href="/blog"
              className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              <span>Bütün bələdçilərə qayıt</span>
            </Link>
          </div>

          {/* Related articles */}
          {relatedArticles.length > 0 && (
            <section aria-label="Digər bələdçilər" className="space-y-6 pt-6">
              <div className="flex items-center gap-2 font-serif font-bold text-xl sm:text-2xl text-on-background">
                <BookOpen className="w-5 h-5 text-primary" aria-hidden="true" />
                <h2>Digər bələdçilər</h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {relatedArticles.map((rel) => (
                  <Link
                    key={rel.slug}
                    href={`/blog/${rel.slug}`}
                    className="group flex flex-col justify-between rounded-2xl border border-outline-variant/60 bg-surface-container-lowest p-4 sm:p-5 hover:border-primary/50 hover:shadow-md transition-all"
                  >
                    <div className="space-y-2">
                      <span className="text-[11px] font-medium text-primary">
                        {rel.tags[0] || 'Bələdçi'}
                      </span>
                      <h3 className="font-serif font-bold text-sm sm:text-base text-on-background group-hover:text-primary transition-colors line-clamp-2">
                        {rel.title}
                      </h3>
                      <p className="text-xs text-on-surface-variant line-clamp-2">
                        {rel.description}
                      </p>
                    </div>

                    <div className="pt-4 mt-4 border-t border-outline-variant/30 flex items-center justify-between text-[11px] text-on-surface-variant">
                      <span>{rel.readTimeMinutes} dəqiqə</span>
                      <span className="inline-flex items-center text-primary font-semibold group-hover:translate-x-0.5 transition-transform">
                        Oxu <ArrowRight className="w-3 h-3 ml-0.5" aria-hidden="true" />
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </article>
      </main>

      <SiteFooter />
    </div>
  );
}

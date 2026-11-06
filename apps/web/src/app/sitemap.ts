import type { MetadataRoute } from "next";
import { BLOG_ARTICLES } from "@/lib/blog/articles";

/**
 * https://aisehr.com/sitemap.xml
 * Only the genuinely public, indexable pages belong here — anything behind a login
 * is excluded, matching the disallow list in robots.ts.
 *
 * Article lastModified dates derive from maintained article metadata rather than
 * a freshly fabricated current timestamp on every request.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://aisehr.com";
  // Stable release baseline for static marketing and policy documents
  const releaseDate = new Date("2026-10-20T00:00:00Z");

  const latestBlogUpdate = new Date(
    Math.max(...BLOG_ARTICLES.map((a) => new Date(a.updatedAt).getTime()))
  );

  const staticRoutes: {
    path: string;
    priority: number;
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
    lastModified?: Date;
  }[] = [
    { path: "/", priority: 1.0, changeFrequency: "weekly", lastModified: releaseDate },
    { path: "/jobs", priority: 0.9, changeFrequency: "daily", lastModified: releaseDate },
    { path: "/institutions", priority: 0.8, changeFrequency: "monthly", lastModified: releaseDate },
    { path: "/companies", priority: 0.7, changeFrequency: "daily", lastModified: releaseDate },
    { path: "/pricing", priority: 0.9, changeFrequency: "weekly", lastModified: releaseDate },
    { path: "/blog", priority: 0.8, changeFrequency: "weekly", lastModified: latestBlogUpdate },
    ...BLOG_ARTICLES.map((article) => ({
      path: `/blog/${article.slug}`,
      priority: 0.8,
      changeFrequency: "monthly" as const,
      lastModified: new Date(article.updatedAt),
    })),
    { path: "/about", priority: 0.7, changeFrequency: "monthly", lastModified: releaseDate },
    { path: "/contact", priority: 0.7, changeFrequency: "monthly", lastModified: releaseDate },
    { path: "/legal", priority: 0.5, changeFrequency: "yearly", lastModified: releaseDate },
    { path: "/terms", priority: 0.4, changeFrequency: "yearly", lastModified: releaseDate },
    { path: "/privacy", priority: 0.4, changeFrequency: "yearly", lastModified: releaseDate },
    { path: "/cookies", priority: 0.3, changeFrequency: "yearly", lastModified: releaseDate },
    { path: "/refund", priority: 0.4, changeFrequency: "yearly", lastModified: releaseDate },
    { path: "/application-authorization", priority: 0.4, changeFrequency: "yearly", lastModified: releaseDate },
    { path: "/employer-terms", priority: 0.4, changeFrequency: "yearly", lastModified: releaseDate },
    { path: "/acceptable-use", priority: 0.3, changeFrequency: "yearly", lastModified: releaseDate },
    { path: "/service-providers", priority: 0.3, changeFrequency: "yearly", lastModified: releaseDate },
    { path: "/privacy/requests", priority: 0.3, changeFrequency: "yearly", lastModified: releaseDate },
  ];

  return staticRoutes.map(({ path, priority, changeFrequency, lastModified }) => ({
    url: `${base}${path}`,
    lastModified: lastModified || releaseDate,
    changeFrequency,
    priority,
  }));
}

import type { MetadataRoute } from "next";

/**
 * Previously there was no robots.ts, so the live site served Cloudflare's
 * managed default — which allowed everything, including /admin and the
 * signed-in areas. Those pages have no business in a search index: they are
 * login walls at best and a map of the app's internals at worst.
 */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://aisehr.com";

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/dashboard",
          "/business/dashboard",
          "/business/applications",
          "/business/vacancies",
          "/business/company",
          "/business/settings",
          "/business/volunteering",
          "/api/",
          // Password-reset and verification links carry single-use tokens in
          // the query string; there is nothing to index and everything to
          // leak if one ends up in a crawler's logs.
          "/reset-password",
          "/verify-email",
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}

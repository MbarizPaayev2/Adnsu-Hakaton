import type { NextConfig } from "next";

/**
 * Origins the browser is allowed to talk to, derived from configuration rather
 * than hardcoded, because the API lives on a different host in production than
 * it does locally.
 */
const apiOrigin = (() => {
  const raw = process.env.NEXT_PUBLIC_API_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
})();

/**
 * Content-Security-Policy.
 *
 * Read this before tightening it. An earlier revision set only
 * `default-src 'self'`, which looks stricter and is in fact unusable: with no
 * `script-src` or `style-src`, both fall back to default-src, and that blocks
 * Next.js's inline hydration bootstrap and every React `style={{...}}` prop.
 * The result was a page that served, failed to hydrate, and rendered no
 * client components at all. Verified in the browser — the console filled with
 * "Executing inline script violates..." and hydration never completed.
 *
 * So `'unsafe-inline'` is present for scripts and styles, and it should be
 * read honestly: it means this policy is NOT meaningful XSS protection.
 * Getting there needs per-request nonces threaded through the middleware and
 * every inline style replaced, which is real work and easy to half-do.
 *
 * What this policy does buy today, none of which needs nonces:
 *   - frame-ancestors: clickjacking protection that current browsers honour
 *     (X-Frame-Options below is the legacy fallback)
 *   - object-src 'none': removes legacy plugin vectors
 *   - base-uri 'self': stops an injected <base> re-pointing every relative URL
 *   - form-action: limits where a form can post credentials
 *   - connect-src / img-src / font-src: bounds exfiltration to known hosts
 */
const csp = [
  "default-src 'self'",
  // 'unsafe-inline' is required by Next.js's hydration bootstrap. See above.
  // 'unsafe-eval' is added in development only: React's dev build uses eval()
  // to reconstruct call stacks, and without it the dev overlay errors out on
  // every load. Production never needs it, so it is never granted there.
  // The Google tag is only injected after analytics consent (components/google-analytics.tsx).
  `script-src 'self' 'unsafe-inline' https://www.googletagmanager.com${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  // React inline styles, plus the Google Fonts stylesheet.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  // blob: covers client-side previews of a file the user just picked.
  "img-src 'self' data: blob: https://www.googletagmanager.com https://*.google-analytics.com",
  [
    "connect-src 'self'",
    apiOrigin,
    // Analytics, only reached after consent.
    "https://*.posthog.com",
    "https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com",
  ]
    .filter(Boolean)
    .join(" "),
  // No frame-src here: frames fall back to default-src 'self'. The provider's checkout is allowed only on the checkout routes (see checkoutCsp below).
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // Only meaningful (and only safe) once the site is actually served over
  // HTTPS. In dev, localhost is plain HTTP — Chromium honours this directive
  // regardless of how the *page itself* was delivered, so shipping it there
  // silently rewrites every same-origin navigation and fetch (including
  // client-side router.push and RSC data requests) to https://localhost,
  // which has no TLS listener and fails with ERR_SSL_PROTOCOL_ERROR. That
  // took down in-app navigation entirely, most visibly the onboarding
  // wizard's finish button: the redirect to /dashboard would silently die
  // mid-flight, leaving the button disabled with nothing happening.
  ...(process.env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : []),
].join("; ");

/**
 * apps/api sets these via helmet, but nothing set them for the web app, so
 * production served the whole site with no HSTS, no framing protection and no
 * MIME-sniffing protection — verified against https://aisehr.com, which
 * returned none of them.
 */
const securityHeaders = [
  // Two years, subdomains included, preload-eligible. This is what stops the
  // *next* visit being attempted over plain HTTP, which matters because
  // http://aisehr.com currently answers 200 instead of redirecting. Only sent
  // in production: HSTS pins the browser to HTTPS-only for this host, and
  // localhost in dev has no TLS listener at all — a browser that honours it
  // (Chromium does, even though the spec says it shouldn't apply to a
  // non-TLS response) then upgrades every later same-origin request to
  // https://localhost and fails outright, breaking in-app navigation.
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Legacy counterpart to frame-ancestors, for browsers predating CSP.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    // Deny hardware the app never asks for, so an injected script cannot
    // request it either.
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Content-Security-Policy", value: csp },
];

/**
 * The embedded (inline) checkout: Dodo Payments' page in an iframe, plus its wallet script for Apple Pay on the page itself. Hosts are the provider's
 * own documented ones (checkout, sdk, api for test and live). Applied ONLY to the pages that embed it; every other page keeps the strict policy above.
 *
 *  - payment: the iframe is created with allow="payment", which a Permissions-Policy of payment=() would silently cancel (no Google Pay, no Apple Pay).
 *  - script-src / connect-src / frame-src: the provider SDK script, its API, and the checkout frame.
 */
const dodoCheckout = ["https://checkout.dodopayments.com", "https://test.checkout.dodopayments.com"];
const dodoSdk = ["https://sdk-v2.hs.dodopayments.com", "https://sdk-v2.custom.hs.dodopayments.com"];
const dodoApi = ["https://api.hs.dodopayments.com", "https://api.custom.hs.dodopayments.com"];
const checkoutCsp = csp
  .replace("script-src 'self'", `script-src 'self' ${dodoSdk.join(" ")} https://applepay.cdn-apple.com`)
  .replace("connect-src 'self'", `connect-src 'self' ${[...dodoApi, ...dodoSdk, ...dodoCheckout].join(" ")}`)
  .replace("frame-ancestors 'self'", `frame-src 'self' ${[...dodoCheckout, ...dodoSdk].join(" ")}; frame-ancestors 'self'`)
  .replace("img-src 'self'", "img-src 'self' https://*.dodopayments.com");
const checkoutPermissions = `camera=(), microphone=(), geolocation=(), payment=(self ${[...dodoCheckout, ...dodoSdk].map((o) => `"${o}"`).join(" ")})`;
const checkoutHeaders = securityHeaders.map((h) =>
  h.key === "Content-Security-Policy" ? { ...h, value: checkoutCsp } : h.key === "Permissions-Policy" ? { ...h, value: checkoutPermissions } : h,
);

const nextConfig: NextConfig = {
  // Traces the real dependency graph (including the @aise/shared-types
  // workspace package) into .next/standalone, so the Docker runtime image
  // can ship that folder alone instead of the whole monorepo node_modules.
  output: process.env.VERCEL ? undefined : 'standalone',

  // Don't advertise the framework and version to scanners.
  poweredByHeader: false,

  async headers() {
    // A later rule overrides an earlier one for the same header, so the two embedding routes replace the strict CSP and Permissions-Policy.
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/checkout", headers: checkoutHeaders },
      { source: "/business/billing", headers: checkoutHeaders },
    ];
  },
};

export default nextConfig;

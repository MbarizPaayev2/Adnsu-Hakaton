import type { Metadata } from "next";

/**
 * Metadata for the sibling page, which is a client component and therefore
 * cannot export it. Every route on the live site shared the root layout's
 * single title — "AISE — İş səni tapsın" — so tabs, bookmarks and search
 * results were indistinguishable from one another.
 */
export const metadata: Metadata = {
  title: "E-poçtu təsdiqlə — AISE",
  description: "E-poçt ünvanınızı təsdiqləyin.",
  // Reached only through a single-use token in the query string: nothing to
  // index, and a crawled URL is a leaked token.
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

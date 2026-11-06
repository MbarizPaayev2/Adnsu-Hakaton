import type { Metadata } from "next";

/**
 * Signed-in area: never indexed. The live robots.txt was Cloudflare's managed
 * default (Allow: /), so these routes and /admin were crawlable.
 */
export const metadata: Metadata = {
  title: "Admin paneli — AISE",
  description: "AISE admin paneli.",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <div className="workspace-main p-0!">{children}</div>;
}

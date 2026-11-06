import type { Metadata } from "next";

/**
 * Metadata for the sibling page, which is a client component and therefore
 * cannot export it. Every route on the live site shared the root layout's
 * single title — "AISE — İş səni tapsın" — so tabs, bookmarks and search
 * results were indistinguishable from one another.
 */
export const metadata: Metadata = {
  title: "Daxil ol — AISE",
  description: "AISE hesabınıza daxil olun və sizə uyğun iş fürsətlərini görün.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

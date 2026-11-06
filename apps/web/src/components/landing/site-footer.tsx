import Link from "next/link";
import { BrandLogo } from "./brand-logo";

/**
 * Shared marketing/legal footer.
 *
 * Extracted from the landing page so the link set has one home: the footer
 * previously listed six dead `href="#"` anchors (Haqqımızda, Karyera, Mətbuat,
 * Yardım Mərkəzi, Məxfilik, Şərtlər), and duplicating it per page would let
 * those drift again. Every entry below resolves to a real route.
 */

const COLUMNS: { heading: string; links: { href: string; label: string }[] }[] = [
  {
    heading: "Məhsul",
    links: [
      { href: "/jobs", label: "Bütün vakansiyalar" },
      { href: "/blog", label: "Karyera bələdçisi" },
      { href: "/#how-it-works", label: "Necə işləyir" },
      { href: "/#features", label: "Xüsusiyyətlər" },
      { href: "/pricing", label: "Planlar" },
    ],
  },
  {
    heading: "Şirkət",
    links: [
      { href: "/about", label: "Haqqımızda" },
      { href: "/contact", label: "Əlaqə və dəstək" },
      { href: "/business/register", label: "İşəgötürənlər üçün" },
      { href: "/institutions", label: "Akademiyalar və universitetlər üçün" },
    ],
  },
  {
    // The full document set lives at /legal; these are the ones a visitor is
    // most likely to want directly. Every document cross-links to the rest
    // from its own footer index, so nothing is more than two clicks away.
    heading: "Hüquqi",
    links: [
      { href: "/legal", label: "Hüquqi məlumatlar" },
      { href: "/terms", label: "İstifadə şərtləri" },
      { href: "/privacy", label: "Məxfilik bildirişi" },
      { href: "/refund", label: "Abunəlik və geri ödəniş" },
      { href: "/application-authorization", label: "Müraciət səlahiyyəti" },
      { href: "/cookies", label: "Kuki və analitika" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="bg-background border-t border-outline-variant/30">
      <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-10 md:gap-12 px-gutter md:px-6 py-12">
        <div className="col-span-2 md:col-span-1">
          <BrandLogo className="mb-5" />
          <p className="text-sm text-on-surface-variant leading-relaxed">
            Vakansiyalar bir yerdə. Növbəti addım sənindir.
          </p>
        </div>

        {COLUMNS.map((col) => (
          <div key={col.heading}>
            <h2 className="font-label-md text-label-md font-bold mb-4 uppercase tracking-wider">
              {col.heading}
            </h2>
            <ul className="space-y-3 text-sm text-on-surface-variant">
              {col.links.map((link) => (
                <li key={link.href + link.label}>
                  <Link
                    className="tap-inline hover:text-accent transition-colors"
                    href={link.href}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="max-w-7xl mx-auto px-gutter md:px-6 py-8 border-t border-outline-variant/30 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <p className="font-label-sm text-label-sm text-on-surface-variant">
          © {new Date().getFullYear()} AISE Career Discovery. Bütün hüquqları
          qorunur.
        </p>
        <div className="flex gap-5 font-label-sm text-label-sm text-on-surface-variant">
          <Link href="/login" className="tap-inline hover:text-accent transition-colors">
            Daxil ol
          </Link>
          <Link href="/register" className="tap-inline hover:text-accent transition-colors">
            Qeydiyyat
          </Link>
        </div>
      </div>
    </footer>
  );
}

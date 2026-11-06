"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { BrandLogo } from "./brand-logo";

const LINKS = [
  { href: "/jobs", label: "Vakansiyalar" },
  { href: "/#how-it-works", label: "Necə işləyir" },
  { href: "/#features", label: "Xüsusiyyətlər" },
  { href: "/pricing", label: "Planlar" },
  { href: "/blog", label: "Məqalələr" },
  { href: "/business/register", label: "İşəgötürənlər" },
];

/**
 * Landing-page navigation.
 *
 * The previous version rendered its links as `hidden md:flex` with no
 * alternative, so on any viewport under 768px the nav collapsed to just the
 * logo and the two auth buttons — every navigation target on the page was
 * unreachable on a phone. This adds the missing mobile menu.
 */
export function SiteNav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Close on Escape, and lock background scrolling while the sheet is open so
  // the page behind it doesn't move under the user's thumb.
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Tighten the nav's shadow once the page has scrolled off the top, so the
  // floating pill reads as lifted above content rather than painted on it.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav aria-label="Əsas naviqasiya" className="fixed top-0 left-0 right-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div
          className={`h-20 border-b border-outline-variant bg-background/95 backdrop-blur-xl flex items-center justify-between px-4 sm:px-6 transition-shadow duration-300 ${
            scrolled ? "shadow-sm" : "shadow-none"
          }`}
        >
          <BrandLogo />

          <div className="hidden xl:flex items-center gap-6 text-sm">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="tap inline-block py-2 text-on-surface-variant hover:text-accent transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/login"
              className="tap hidden sm:block px-4 py-2 rounded-xl text-sm hover:bg-surface-container transition-colors"
            >
              Daxil ol
            </Link>
            <Link
              href="/register"
              className="bg-highlight text-primary px-4 sm:px-5 py-3 rounded-full text-sm font-medium hover:bg-surface-container transition-colors"
            >
              Ödənişsiz başla
            </Link>

            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="tap xl:hidden w-10 h-10 -mr-1 grid place-items-center rounded-xl hover:bg-surface-container transition-colors"
              aria-label={open ? "Menyunu bağla" : "Menyunu aç"}
              aria-expanded={open}
              aria-controls="aise-mobile-menu"
            >
              {open ? (
                <X aria-hidden="true" className="h-6 w-6 text-on-background" />
              ) : (
                <Menu aria-hidden="true" className="h-6 w-6 text-on-background" />
              )}
            </button>
          </div>
        </div>

        {open && (
          <div
            id="aise-mobile-menu"
            className="xl:hidden mt-2 rounded-2xl border border-outline-variant/30 bg-background/95 backdrop-blur-xl shadow-lg p-2"
          >
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="block px-4 py-3 rounded-xl text-on-background hover:bg-surface-container transition-colors"
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="block sm:hidden px-4 py-3 rounded-xl text-on-background hover:bg-surface-container transition-colors"
            >
              Daxil ol
            </Link>
          </div>
        )}
      </div>
    </nav>
  );
}

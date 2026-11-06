import type { ReactNode } from "react";
import Link from "next/link";
import { SiteNav } from "@/components/landing/site-nav";
import { SiteFooter } from "@/components/landing/site-footer";
import { formatDate } from "@/lib/format";
import { LEGAL } from "@/lib/legal-config";

/**
 * Shell for every legal document.
 *
 * Each document carries its version and effective date in the header, because
 * a legal notice that cannot be identified by version is not much use as
 * evidence of what someone agreed to — and because the pages cross-reference
 * each other, so they have to be in step.
 *
 * The `Placeholder` and `ReviewNotice` helpers that used to live here are gone.
 * They existed to render "[şirkətin adı]" style gaps as visible highlights so
 * nothing read as a factual claim before the company details were known. The
 * documents now state what is actually true, so there is nothing to mark.
 */
export const LEGAL_DOCUMENTS = [
  { href: "/legal", label: "Hüquqi məlumatlar" },
  { href: "/terms", label: "İstifadə şərtləri" },
  { href: "/privacy", label: "Məxfilik bildirişi" },
  { href: "/application-authorization", label: "Müraciət səlahiyyəti" },
  { href: "/refund", label: "Abunəlik və geri ödəniş" },
  { href: "/cookies", label: "Kuki və analitika" },
  { href: "/employer-terms", label: "İşəgötürən şərtləri" },
  { href: "/acceptable-use", label: "İstifadə qaydaları" },
  { href: "/service-providers", label: "Xidmət təminatçıları" },
  { href: "/privacy/requests", label: "Məlumat müraciətləri" },
] as const;

export function LegalPage({
  title,
  intro,
  /** Defaults to the shared document version so pages stay in step. */
  version = LEGAL.version,
  effectiveDate = LEGAL.effectiveDate,
  /** Set when this document changed after the shared effective date. */
  updatedAt,
  children,
}: {
  title: string;
  intro?: string;
  version?: string;
  effectiveDate?: string;
  updatedAt?: string;
  children: ReactNode;
}) {
  return (
    <div className="grow bg-background font-body-md text-body-md text-on-background">
      <SiteNav />

      <header className="relative overflow-hidden pt-32 pb-12 md:pt-40 md:pb-16 px-gutter md:px-landing-xl">
        <div className="absolute inset-0 aise-glow -z-10" />
        <div className="max-w-3xl mx-auto">
          <h1 className="product-page-title font-display-lg-mobile text-display-lg-mobile leading-tight mb-4">
            {title}
          </h1>
          {intro && (
            <p className="text-lg text-on-surface-variant leading-relaxed">
              {intro}
            </p>
          )}
          <p className="mt-6 text-label-md font-label-md text-on-surface-variant">
            Versiya {version} — qüvvəyə minmə tarixi: {formatDate(effectiveDate)}
            {updatedAt && updatedAt !== effectiveDate && (
              <> · son yenilənmə: {formatDate(updatedAt)}</>
            )}
          </p>
        </div>
      </header>

      <main
        className="
          px-gutter md:px-landing-xl pb-24
          [&>div]:max-w-3xl [&>div]:mx-auto
        "
      >
        <div
          className="
            space-y-10
            [&_h2]:text-headline-md [&_h2]:font-headline-md [&_h2]:font-semibold
            [&_h2]:mt-12 [&_h2]:mb-4 [&_h2]:scroll-mt-28
            [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2
            [&_p]:text-on-surface-variant [&_p]:leading-relaxed [&_p]:mb-4
            [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-2 [&_ul]:mb-4
            [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:space-y-2 [&_ol]:mb-4
            [&_li]:text-on-surface-variant [&_li]:leading-relaxed
            [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2
            [&_strong]:text-on-background [&_strong]:font-semibold
            [&_table]:w-full [&_table]:text-left [&_table]:border-collapse
            [&_th]:border-b [&_th]:border-outline-variant [&_th]:py-2 [&_th]:pr-4 [&_th]:font-semibold
            [&_td]:border-b [&_td]:border-outline-variant/50 [&_td]:py-2 [&_td]:pr-4
            [&_td]:text-on-surface-variant [&_td]:align-top
          "
        >
          {children}

          <LegalIndex current={title} />
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

/**
 * Cross-links at the foot of every document.
 *
 * The documents incorporate one another by reference — the terms rely on the
 * refund policy and the application authorization, the privacy notice relies
 * on the provider register — so each one has to be reachable from any other,
 * not just from the footer.
 */
function LegalIndex({ current }: { current: string }) {
  return (
    <nav
      aria-label="Digər hüquqi sənədlər"
      className="mt-16 rounded-2xl border border-outline-variant/40 bg-surface-container-low p-6 not-prose"
    >
      <h2 className="!mt-0 !mb-3 !text-lg">Digər sənədlər</h2>
      <ul className="!list-none !pl-0 grid sm:grid-cols-2 gap-x-6 gap-y-2 !mb-0">
        {LEGAL_DOCUMENTS.filter((d) => d.label !== current).map((d) => (
          <li key={d.href} className="!leading-normal">
            <Link href={d.href} className="tap-inline !no-underline hover:!underline">
              {d.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * "Who operates AISE" block, shared by /legal, /terms and /privacy so the
 * operator description can never differ between them.
 *
 * Renders the registration details only once they exist. Until then it names
 * the trading name and says plainly that registration is not complete, rather
 * than implying a registered company or printing an empty field.
 */
export function OperatorIdentity() {
  const r = LEGAL.registration;

  if (!r) {
    return (
      <p>
        AISE — <strong>{LEGAL.domain}</strong> ünvanında fəaliyyət göstərən
        karyera platformasıdır. Xidmət <strong>{LEGAL.operator}</strong> adı
        altında təqdim olunur. Bizimlə{" "}
        <a href={`mailto:${LEGAL.email.support}`}>{LEGAL.email.support}</a>{" "}
        ünvanı vasitəsilə əlaqə saxlaya bilərsiniz.
      </p>
    );
  }

  return (
    <p>
      AISE xidmətini <strong>{r.legalName}</strong> ({r.legalForm}) təqdim edir.
      Qeydiyyat nömrəsi: {r.registrationNumber}. VÖEN: {r.voen}. Qeydiyyat
      ünvanı: {r.registeredAddress}. Veb saytımız: {LEGAL.domain}.
    </p>
  );
}

/** Contact block, identical everywhere it appears. */
export function ContactBlock() {
  return (
    <ul>
      <li>
        Dəstək və ümumi suallar:{" "}
        <a href={`mailto:${LEGAL.email.support}`}>{LEGAL.email.support}</a>
      </li>
      <li>
        Məxfilik və məlumat müraciətləri:{" "}
        <a href={`mailto:${LEGAL.email.privacy}`}>{LEGAL.email.privacy}</a>
      </li>
      <li>
        Ödəniş və abunəlik:{" "}
        <a href={`mailto:${LEGAL.email.billing}`}>{LEGAL.email.billing}</a>
      </li>
      <li>
        Şübhəli elan və sui-istifadə bildirişləri:{" "}
        <a href={`mailto:${LEGAL.email.abuse}`}>{LEGAL.email.abuse}</a>
      </li>
    </ul>
  );
}

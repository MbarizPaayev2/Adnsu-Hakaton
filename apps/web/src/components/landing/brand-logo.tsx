import Link from "next/link";

/** The brand mark (rounded green square with the open A, from the brand package) and wordmark, shared by public and signed-in navigation. */
export function BrandWordmark({ className = "" }: { className?: string }) {
  return <span className={`aise-wordmark ${className}`}>
    {/* Fixed dimensions avoid layout shift; this small local asset needs no resize service. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src="/logo-mark.svg" alt="" width={32} height={32} aria-hidden="true" className="aise-brand-mark w-8 h-8" />
    <span>AISE</span>
  </span>;
}

export function BrandLogo({ className = "", showWordmark = true, href = "/", label = "AISE — ana səhifə" }: {
  className?: string; showWordmark?: boolean; href?: string; label?: string;
}) {
  return <Link href={href} className={`inline-flex min-h-11 min-w-11 shrink-0 items-center ${className}`} aria-label={label}>
    {showWordmark ? <BrandWordmark className="text-2xl" /> :
      /* eslint-disable-next-line @next/next/no-img-element */
      <img src="/logo-mark.svg" alt="" width={32} height={32} aria-hidden="true" className="aise-brand-mark w-8 h-8" />}
  </Link>;
}

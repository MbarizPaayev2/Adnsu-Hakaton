"use client";

import { useEffect, useRef, useState, type ElementType, type ReactNode } from "react";
import { formatNumber } from "@/lib/format";

/**
 * Reveal-on-scroll, built so content can never end up permanently hidden.
 *
 * The first version hid every `.reveal` in CSS and relied solely on an
 * IntersectionObserver to bring it back. That inverts the safe default: any
 * condition that stops intersections from being delivered leaves the page
 * blank below the fold. It reproduced immediately in a background tab — 35 of
 * 36 elements stayed at opacity 0, because a tab that isn't being painted
 * doesn't compute intersections.
 *
 * Two changes fix it:
 *
 *  1. The hidden state lives under `html.js-reveal` (see globals.css), a class
 *     set by a blocking inline script in layout.tsx. No script, no hiding.
 *  2. Visibility is decided by measuring rects directly in one shared sweep,
 *     driven by scroll/resize/visibilitychange plus a short backstop timer,
 *     instead of waiting to be told. A sweep can be run at any moment, so
 *     there is no event that must arrive for content to appear.
 *
 * The sweep is O(n) over the not-yet-revealed nodes only, shrinks to zero as
 * the page is read, and detaches its listeners once everything has shown.
 */

let installed = false;
let frame = 0;

/**
 * Shows every `.reveal` immediately and unconditionally.
 *
 * Adds `reveal-shown` as well as `is-visible`, which cancels the animation
 * outright (see globals.css). `is-visible` on its own is not sufficient: an
 * animation that started and then froze — the tab was backgrounded partway
 * through — keeps reporting its current value, and at 0% that is opacity 0,
 * which beats the declared opacity: 1. The only reliable way to guarantee the
 * element paints is to take the animation off it.
 */
function revealAll(): void {
  document
    .querySelectorAll<HTMLElement>(".reveal:not(.reveal-shown)")
    .forEach((el) => el.classList.add("is-visible", "reveal-shown"));
}

/** Hard-shows only what should already be on screen, leaving the rest to animate. */
function revealOnscreen(): void {
  const viewportHeight = window.innerHeight;
  document
    .querySelectorAll<HTMLElement>(".reveal:not(.reveal-shown)")
    .forEach((el) => {
      if (el.getBoundingClientRect().top < viewportHeight) {
        el.classList.add("is-visible", "reveal-shown");
      }
    });
}

/** Reveals anything at or above the viewport bottom. Returns what's left. */
function sweep(): number {
  const pending = document.querySelectorAll<HTMLElement>(".reveal:not(.is-visible)");
  if (pending.length === 0) return 0;

  const viewportHeight = window.innerHeight;

  // A zero-height viewport makes every geometry test meaningless: the limit
  // below becomes 0, no element can satisfy `top < 0`, and the page stays
  // blank. It happens for real — a hidden or collapsed container, a
  // prerender, a thumbnail capture — so treat an unmeasurable viewport as
  // "show everything" rather than "show nothing".
  if (!viewportHeight) {
    revealAll();
    return 0;
  }

  // Slightly inside the viewport so an element animates as it arrives rather
  // than after it has already been read.
  const limit = viewportHeight * 0.92;

  pending.forEach((el) => {
    const rect = el.getBoundingClientRect();
    // `top < limit` also covers everything scrolled past above the viewport,
    // which is what makes a deep-link or restored scroll position correct.
    if (rect.top < limit) el.classList.add("is-visible");
  });

  return document.querySelectorAll(".reveal:not(.is-visible)").length;
}

function scheduleSweep() {
  if (frame) return;
  // rAF coalesces scroll bursts into one measurement per frame. It does not
  // run at all in a background tab, which is why the backstop above is a
  // timer rather than another frame request.
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (sweep() === 0) teardown();
  });
}

function onVisibility() {
  if (document.hidden) return;
  // A tab restored from the background may have scrolled or resized while it
  // was throttled; re-measure rather than trusting the last sweep.
  scheduleSweep();
  // Anything that should be on screen but froze mid-animation while the tab
  // was hidden gets shown outright, so returning to the tab never lands on a
  // blank stretch of page.
  revealOnscreen();
}

function teardown() {
  if (!installed) return;
  installed = false;
  window.removeEventListener("scroll", scheduleSweep);
  window.removeEventListener("resize", scheduleSweep);
  document.removeEventListener("visibilitychange", onVisibility);
}

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("scroll", scheduleSweep, { passive: true });
  window.addEventListener("resize", scheduleSweep, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);

  scheduleSweep();

  // Backstop, scoped to actual failure rather than fired blindly.
  //
  // A timer, not another frame request: requestAnimationFrame does not run in
  // a background tab, so scheduleSweep's callback may never fire there.
  //
  // The two cases are genuinely different:
  //
  //  - Nobody is looking (hidden tab) or the viewport is unmeasurable (a
  //    collapsed container, a prerender, a thumbnail capture). Geometry means
  //    nothing and no animation will run, so show everything outright. When
  //    the tab is brought forward the content is simply already there.
  //  - Somebody is looking. Only force what should already be on screen but
  //    is not — that catches an element whose animation started and froze, or
  //    a post-mount layout shift — and leave everything below the fold to
  //    animate on scroll as intended. Forcing the whole page here would
  //    silently disable the scroll reveal for every real visitor.
  window.setTimeout(() => {
    if (document.hidden || !window.innerHeight) revealAll();
    else revealOnscreen();
    scheduleSweep();
  }, 1500);
}

type RevealProps = {
  children: ReactNode;
  /** Stagger in ms, applied as animation-delay. */
  delay?: number;
  variant?: "rise" | "fade" | "scale";
  as?: ElementType;
  className?: string;
};

export function Reveal({
  children,
  delay = 0,
  variant = "rise",
  as: Tag = "div",
  className = "",
}: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    install();
    // This instance may have mounted after the last sweep (route change,
    // conditional render), so ask for one covering it.
    scheduleSweep();
  }, []);

  const variantClass =
    variant === "fade" ? "reveal-fade" : variant === "scale" ? "reveal-scale" : "";

  return (
    <Tag
      ref={ref}
      className={`reveal ${variantClass} ${className}`.trim()}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}

/**
 * Counts from 0 up to `to` once scrolled into view.
 *
 * Driven by requestAnimationFrame against a wall-clock start rather than a
 * fixed per-frame increment, so the duration holds regardless of refresh rate
 * (a +1-per-frame counter finishes twice as fast on a 120Hz display).
 *
 * Like Reveal, it must never be able to sit at 0 forever: the observer is only
 * a trigger for *when* to animate, and a backstop settles on the final value
 * if that trigger never arrives.
 */
export function CountUp({
  to,
  duration = 1600,
  suffix = "",
  prefix = "",
  className = "",
}: {
  to: number;
  duration?: number;
  suffix?: string;
  prefix?: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [value, setValue] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const prefersReduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (prefersReduced) {
      setValue(to);
      return;
    }

    let raf = 0;
    let start = 0;
    let done = false;

    const step = (now: number) => {
      if (!start) start = now;
      const progress = Math.min((now - start) / duration, 1);
      // easeOutCubic — fast out of the gate, settles gently on the final value.
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * to));
      if (progress < 1) raf = requestAnimationFrame(step);
      else done = true;
    };

    const run = () => {
      if (done || raf) return;
      raf = requestAnimationFrame(step);
    };

    const check = () => {
      if (!ref.current) return;
      if (ref.current.getBoundingClientRect().top < window.innerHeight * 0.92) {
        run();
        window.removeEventListener("scroll", check);
      }
    };

    window.addEventListener("scroll", check, { passive: true });
    check();

    // Backstop: land on the real number even if the scroll trigger never
    // fires, so the stat can't read as a permanent "0".
    const backstop = window.setTimeout(run, 2500);

    return () => {
      window.removeEventListener("scroll", check);
      window.clearTimeout(backstop);
      cancelAnimationFrame(raf);
    };
  }, [to, duration]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {formatNumber(value)}
      {suffix}
    </span>
  );
}

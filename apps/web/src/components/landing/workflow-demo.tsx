"use client";

import { useEffect, useRef, useState } from "react";
import { Brain, CheckCircle2, FileText, FileUp, SearchCheck, Star, Zap, type LucideIcon } from "lucide-react";
import { ScoreRing } from "./score-ring";

/**
 * One-time animated walkthrough of the whole product flow, beside the hero
 * headline.
 *
 * Runs the five stages a real user goes through — upload a CV, AISE scans
 * vacancies, each one is scored, the matches come back, apply in one click —
 * once, then holds on the final "applied" state. One pass is 7s. It used to
 * loop indefinitely, which meant a card in the hero — the first thing anyone
 * sees, sitting right next to the actual headline and CTA — kept moving for
 * as long as the tab stayed open; that's motion competing for attention
 * against the page's actual job, not a demo anyone asked to watch twice.
 *
 * Built as a component rather than a rendered GIF: it stays sharp at every
 * viewport, costs no multi-megabyte asset on first paint, inherits the brand
 * tokens (so it can never drift from the palette), and can drop straight to
 * its final frame under prefers-reduced-motion, which a looping GIF cannot.
 *
 * All stages are mounted at once inside a fixed-height frame and cross-faded,
 * so the card never changes size between stages.
 */

type Stage = {
  key: string;
  ms: number;
  label: string;
  icon: LucideIcon;
};

const STAGES: Stage[] = [
  { key: "upload", ms: 1500, label: "CV yüklənir", icon: FileUp },
  { key: "scan", ms: 1600, label: "Vakansiyalar axtarılır", icon: SearchCheck },
  { key: "score", ms: 1700, label: "Uyğunluq hesablanır", icon: Brain },
  { key: "result", ms: 1400, label: "Uyğun işlər hazırdır", icon: Star },
  { key: "apply", ms: 900, label: "Müraciət AISE işəgötürəninə göndərildi", icon: CheckCircle2 },
];

const TOTAL_MS = STAGES.reduce((sum, s) => sum + s.ms, 0); // 7000

const SCAN_CHIPS = [
  "Mühasib",
  "Frontend Developer",
  "Satış Meneceri",
  "Data Analyst",
  "Anbardar",
  "Product Designer",
];

const MATCHES = [
  { role: "Frontend Developer", meta: "Bakı · Uzaqdan", score: 94 },
  { role: "Product Designer", meta: "Bakı · Hibrid", score: 88 },
  { role: "Data Analyst", meta: "Sumqayıt · Ofisdə", score: 81 },
];

export function WorkflowDemo() {
  // -1 means "reduced motion": every stage renders in its finished state and
  // the timer never starts.
  const [index, setIndex] = useState(0);
  const [reduced, setReduced] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setReduced(true);
      setIndex(STAGES.length - 1);
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    // Set once the single pass reaches its last stage, so scrolling this
    // card out of view and back never restarts it from stage 0.
    let finished = false;

    const advance = (i: number) => {
      const next = i + 1;
      if (next >= STAGES.length) {
        finished = true;
        return;
      }
      timer = setTimeout(() => {
        setIndex(next);
        advance(next);
      }, STAGES[i].ms);
    };

    const start = () => {
      if (running || finished) return;
      running = true;
      advance(index);
    };

    const stop = () => {
      running = false;
      if (timer) clearTimeout(timer);
      timer = undefined;
    };

    // Pause when the card scrolls out of view or the tab is backgrounded, so
    // the (one-time) pass isn't spending timers and composites nobody can
    // see, and it still plays out fully whenever the visitor actually
    // scrolls to it rather than firing and finishing before they arrive.
    const el = ref.current;
    const io =
      el && typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(
            ([entry]) => (entry.isIntersecting && !document.hidden ? start() : stop()),
            { threshold: 0.2 },
          )
        : null;

    if (io && el) io.observe(el);
    else start(); // no observer available: just run it

    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // `index` is intentionally not a dependency: it changes every stage, and
    // re-running this effect each time would tear down the loop it drives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stage = STAGES[index];
  const at = (key: string) => stage.key === key;
  // Stages are cumulative: once scoring has happened the matches stay on
  // screen for the rest of the pass rather than disappearing.
  const reachedResult = reduced || index >= 3;

  return (
    <div ref={ref} className="relative w-full max-w-[440px] mx-auto">
      {/* No blur filter here: .aise-glow is already a soft radial gradient, and
            stacking a 40px blur on an element this size makes the browser
            re-rasterise the blur on every composite. */}
        <div className="absolute -inset-8 aise-glow rounded-full -z-10" />

      <div className="relative rounded-[28px] bg-surface-container-lowest border border-outline-variant/40 shadow-2xl shadow-neutral-dark/10 overflow-hidden">
        {/* Header: current stage, and a timeline of the five steps. */}
        <div className="px-6 py-5 border-b border-outline-variant/30">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-on-surface-variant">AISE necə işləyir · nümunə, real məlumat deyil</p>
              <h2
                key={stage.key}
                className="text-base sm:text-lg font-semibold text-on-background leading-snug reveal reveal-fade is-visible"
              >
                {stage.label}
              </h2>
            </div>
            <div className="relative w-11 h-11 shrink-0 rounded-full bg-primary/10 grid place-items-center">
              {/* Only while the pass is still in progress — once it settles
                  on the final stage there's nothing left to indicate as
                  "ongoing", so the pulse stops with it. */}
              {!reduced && index < STAGES.length - 1 && (
                <span className="absolute inset-0 rounded-full bg-primary/20 aise-pulse-ring" />
              )}
              <stage.icon aria-hidden="true" className="relative h-6 w-6 text-primary" />
            </div>
          </div>

          {/* Continuous progress across the whole 7s pass, animated by CSS so
              it advances at display refresh rate without a re-render per
              frame. The ticks above it mark the five stage boundaries. */}
          <div className="mt-4">
            <div className="relative h-1 rounded-full bg-outline-variant/40 overflow-hidden">
              {/* Duration comes from TOTAL_MS rather than the stylesheet so the
                  bar and the stage timings can never drift apart — editing a
                  stage's `ms` above is enough to keep them in step. */}
              <div
                className={`absolute inset-0 rounded-full bg-primary ${
                  reduced ? "" : "aise-progress-bar"
                }`}
                style={
                  reduced
                    ? { transform: "scaleX(1)" }
                    : { animationDuration: `${TOTAL_MS}ms` }
                }
              />
            </div>
            <ol className="mt-2 flex gap-1.5" aria-hidden="true">
              {STAGES.map((s, i) => (
                <li
                  key={s.key}
                  className={`h-0.5 flex-1 rounded-full transition-colors duration-500 ${
                    i <= index ? "bg-primary/60" : "bg-outline-variant/30"
                  }`}
                />
              ))}
            </ol>
          </div>
        </div>

        {/* Fixed-height stage frame — every stage is absolutely positioned in
            here so swapping them can't resize the card. */}
        <div className="relative h-[268px]">
          {/* 1. CV upload */}
          <div
            className="absolute inset-0 p-6 flex flex-col justify-center transition-all duration-700 ease-out"
            style={{
              opacity: at("upload") ? 1 : 0,
              transform: at("upload") ? "translateY(0)" : "translateY(6px)",
            }}
          >
            <div className="rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 p-6 text-center">
              <FileText aria-hidden="true" className="mx-auto h-9 w-9 text-primary" />
              <p className="mt-2 font-medium text-on-background">CV.pdf</p>
              <div className="mt-4 h-1.5 rounded-full bg-outline-variant/40 overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-[width] ease-out"
                  style={{
                    width: at("upload") ? "100%" : "0%",
                    transitionDuration: "1200ms",
                  }}
                />
              </div>
              <p className="mt-3 text-sm text-on-surface-variant">
                Bir dəfə yükləyin — 30 saniyə
              </p>
            </div>
          </div>

          {/* 2. Scanning vacancies */}
          <div
            className="absolute inset-0 p-6 overflow-hidden transition-all duration-700 ease-out"
            style={{
              opacity: at("scan") ? 1 : 0,
              transform: at("scan") ? "translateY(0)" : "translateY(6px)",
            }}
          >
            <div className="relative h-full rounded-2xl border border-outline-variant/40 overflow-hidden">
              {at("scan") && !reduced && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 left-0 w-1/3 aise-scan-beam"
                  style={{
                    background:
                      "linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--color-primary) 22%, transparent) 70%, transparent 100%)",
                    animationDuration: "1.6s",
                  }}
                />
              )}
              <div className="relative grid grid-cols-2 gap-2 p-3">
                {SCAN_CHIPS.map((c) => (
                  <div
                    key={c}
                    className="truncate rounded-lg border border-outline-variant/50 px-2.5 py-2 text-xs text-on-surface-variant"
                  >
                    {c}
                  </div>
                ))}
              </div>
              <p className="absolute bottom-3 left-0 right-0 text-center text-sm text-on-surface-variant">
                Minlərlə elan yoxlanılır
              </p>
            </div>
          </div>

          {/* 3. Scoring — the breakdown behind one score. */}
          <div
            className="absolute inset-0 p-6 flex flex-col justify-center gap-4 transition-all duration-700 ease-out"
            style={{
              opacity: at("score") ? 1 : 0,
              transform: at("score") ? "translateY(0)" : "translateY(6px)",
            }}
          >
            {[
              { label: "Bacarıqlar", v: 96 },
              { label: "Təcrübə", v: 91 },
              { label: "Yerləşmə", v: 88 },
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-sm font-medium">
                  {row.label}
                </span>
                <div className="flex-1 h-2 rounded-full bg-outline-variant/40 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] ease-out"
                    style={{
                      width: at("score") ? `${row.v}%` : "0%",
                      transitionDuration: "1100ms",
                    }}
                  />
                </div>
                <span className="w-8 text-right text-sm font-semibold text-primary-strong tabular-nums">
                  {row.v}
                </span>
              </div>
            ))}
          </div>

          {/* 4 + 5. Matches, then the apply confirmation over them. */}
          <div
            className="absolute inset-0 p-4 space-y-2.5 transition-all duration-700 ease-out"
            style={{
              opacity: reachedResult ? 1 : 0,
              transform: reachedResult ? "translateY(0)" : "translateY(6px)",
            }}
          >
            {MATCHES.map((m, i) => (
              <div
                key={m.role}
                className="flex items-center gap-3 rounded-2xl border border-outline-variant/30 p-3"
              >
                <ScoreRing
                  key={m.role}
                  score={m.score}
                  size={44}
                  delay={reachedResult ? i * 160 : 0}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-on-background truncate text-sm">
                    {m.role}
                  </p>
                  <p className="text-xs text-on-surface-variant truncate">
                    {m.meta}
                  </p>
                </div>
                {at("apply") && (
                  <CheckCircle2 aria-hidden="true" className="h-5 w-5 shrink-0 text-primary" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Footer doubles as the final call to action once the loop lands. */}
        <div className="px-6 py-4 border-t border-outline-variant/30 flex items-center gap-2 text-sm">
          {at("apply") ? (
            <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />
          ) : (
            <Zap aria-hidden="true" className="h-4 w-4 shrink-0 text-on-surface-variant" />
          )}
          <span
            className={
              at("apply")
                ? "font-medium text-on-background"
                : "text-on-surface-variant"
            }
          >
            {at("apply") ? "Müraciət göndərildi" : "AISE daxilində müraciət"}
          </span>
          <span className="ml-auto shrink-0 rounded-full bg-primary-strong px-2 py-0.5 text-label-sm font-label-sm uppercase tracking-wider text-white">
            Platforma daxilində
          </span>
        </div>
      </div>

      {/* Screen readers get the flow as a plain list; the visual loop is
          decorative sequencing of the same five steps. */}
      <p className="sr-only">
        AISE necə işləyir (nümunə animasiya, real məlumat deyil): {STAGES.map((s) => s.label).join(", ")}.
      </p>
    </div>
  );
}

export { TOTAL_MS as WORKFLOW_DEMO_MS };

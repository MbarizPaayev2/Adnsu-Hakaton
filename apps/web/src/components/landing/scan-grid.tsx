"use client";

import { Briefcase, CheckCircle2 } from "lucide-react";
/**
 * Text-free visual for "AISE scans every vacancy and surfaces yours".
 *
 * A beam sweeps left-to-right across a grid of vacancy chips; the chips that
 * are a "match" light up as the beam reaches them. The sync is done with
 * animation-delay derived from each chip's column against the same 5s period
 * as the beam, so there are no JS timers and nothing to keep in step at
 * runtime — the compositor runs the whole thing.
 */

const COLUMNS = 6;

// `match: true` chips are the ones that light up. Kept deliberately sparse so
// the visual reads as "a few of these are for you", not "everything matches".
const CHIPS: { label: string; match?: boolean }[] = [
  { label: "Mühasib" },
  { label: "Frontend Developer", match: true },
  { label: "Satış Meneceri" },
  { label: "HR Partner" },
  { label: "Data Analyst", match: true },
  { label: "Logist" },
  { label: "Qrafik Dizayner" },
  { label: "Backend Developer", match: true },
  { label: "Kassir" },
  { label: "Layihə Meneceri" },
  { label: "Marketinq Mütəxəssisi", match: true },
  { label: "Anbardar" },
  { label: "Product Designer", match: true },
  { label: "Sürücü" },
  { label: "DevOps Engineer", match: true },
  { label: "Tərcüməçi" },
  { label: "Hüquqşünas" },
  { label: "QA Engineer", match: true },
];

const PERIOD_MS = 5000;

export function ScanGrid() {
  return (
    <div className="relative overflow-hidden rounded-[28px] border border-outline-variant/40 bg-surface-container-lowest p-5 sm:p-7 shadow-xl shadow-neutral-dark/5">
      {/* The sweeping beam. Sits above the chips but ignores pointer events. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-1/4 aise-scan-beam"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--color-primary) 14%, transparent) 55%, color-mix(in srgb, var(--color-primary) 28%, transparent) 82%, transparent 100%)",
        }}
      />

      <div className="relative grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {CHIPS.map((chip, i) => {
          const column = i % COLUMNS;
          // Spread the chips' pop across the beam's travel time.
          const delay = (column / COLUMNS) * PERIOD_MS;

          return (
            <div
              key={chip.label}
              className={`flex items-center gap-2 rounded-xl border border-outline-variant/60 bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface-variant ${
                chip.match ? "aise-chip-match" : ""
              }`}
              style={chip.match ? { animationDelay: `${delay}ms` } : undefined}
            >
              {chip.match ? (
                <CheckCircle2 aria-hidden="true" className="h-[18px] w-[18px] shrink-0" />
              ) : (
                <Briefcase aria-hidden="true" className="h-[18px] w-[18px] shrink-0" />
              )}
              <span className="truncate">{chip.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

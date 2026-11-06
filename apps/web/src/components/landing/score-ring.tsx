"use client";

import { useEffect, useState } from "react";

/**
 * Circular match-score dial.
 *
 * The sweep is a conic-gradient driven by the registered custom property
 * `--aise-score` (declared with @property in globals.css so it interpolates
 * instead of snapping). The value is applied one frame after mount, which is
 * what gives the ring something to animate *from* — setting it during the
 * initial render would paint the final state with no transition.
 */
export function ScoreRing({
  score,
  size = 56,
  delay = 0,
  className = "",
}: {
  score: number;
  size?: number;
  delay?: number;
  className?: string;
}) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setActive(true), delay + 60);
    return () => clearTimeout(timer);
  }, [delay]);

  return (
    <div
      className={`aise-score-ring relative shrink-0 rounded-full grid place-items-center ${className}`}
      style={
        {
          width: size,
          height: size,
          "--aise-score": active ? score : 0,
        } as React.CSSProperties
      }
      role="img"
      aria-label={`Uyğunluq balı: ${score} faiz`}
    >
      {/* Punches the centre out of the conic sweep, leaving a ring. */}
      <div
        className="absolute rounded-full bg-surface-container-lowest"
        style={{ inset: Math.max(4, size * 0.11) }}
      />
      <span
        className="relative font-semibold text-primary-strong tabular-nums"
        style={{ fontSize: size * 0.29 }}
      >
        {score}
      </span>
    </div>
  );
}

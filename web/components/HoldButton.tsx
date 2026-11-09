"use client";

// Knopf, den man gedrückt halten muss (Maus, Finger oder Leertaste/Enter), bevor etwas unwiderruflich passiert.
import { useEffect, useRef, useState } from "react";

export const HOLD_MS = 2500;

export function HoldButton({ onConfirm, children, disabled = false }: {
  onConfirm: () => void; children: React.ReactNode; disabled?: boolean;
}) {
  const [progress, setProgress] = useState(0);
  const start = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  const done = useRef(false);

  const stop = () => {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = null;
    start.current = null;
    if (!done.current) setProgress(0);
  };
  const tick = () => {
    if (start.current === null) return;
    const p = Math.min(1, (performance.now() - start.current) / HOLD_MS);
    setProgress(p);
    if (p >= 1) {
      done.current = true;
      stop();
      onConfirm();
      return;
    }
    frame.current = requestAnimationFrame(tick);
  };
  const begin = () => {
    if (disabled || start.current !== null || done.current) return;
    start.current = performance.now();
    frame.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <button type="button" disabled={disabled}
      onPointerDown={begin} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      onKeyDown={(e) => (e.key === " " || e.key === "Enter") && (e.preventDefault(), begin())}
      onKeyUp={(e) => (e.key === " " || e.key === "Enter") && stop()}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={`${typeof children === "string" ? children : "Confirm"} – press and hold for ${HOLD_MS / 1000} seconds`}
      className="relative h-11 w-full touch-none overflow-hidden rounded-[var(--radius-control)] border border-down font-semibold text-down select-none disabled:opacity-50">
      <span aria-hidden className="absolute inset-y-0 left-0 bg-down" style={{ width: `${progress * 100}%` }} />
      <span className={`relative ${progress > 0.5 ? "text-white" : ""}`}>
        {progress > 0 && progress < 1 ? "Keep holding…" : children}
      </span>
    </button>
  );
}

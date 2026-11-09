"use client";

// Kasten mit Überschrift und bis zu 50 Einträgen, innerhalb des Kastens scrollbar.
import type { ReactNode } from "react";
import { LANG_SHORT } from "@/lib/format";
import type { Game } from "@/lib/games";
import type { Lang, Period } from "@/lib/types";

export const PERIODS: { value: Period; label: string }[] = [
  { value: "1d", label: "1D" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "1y", label: "1Y" },
];
/** Sprachauswahl eines Spiels: "All" + seine Sprachen. */
export const langOptions = (game: Game): { value: Lang | "all"; label: string }[] => [
  { value: "all", label: "All" },
  ...game.langs.map((l) => ({ value: l, label: LANG_SHORT[l] })),
];

export function ListBox({ title, count, empty, children }: {
  title: string;
  count: number;
  empty: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-[var(--radius-panel)] bg-surface ring-1 ring-line">
      <h3 className="flex items-baseline justify-between border-b border-line px-4 py-3 font-semibold">
        {title}
        {count > 0 && <span className="num text-sm font-normal text-slate">{count}</span>}
      </h3>
      {count > 0 ? (
        <ul className="max-h-[440px] overflow-y-auto px-4 py-1" tabIndex={0} aria-label={title}>
          {children}
        </ul>
      ) : (
        <p className="px-4 py-6 text-sm text-slate">{empty}</p>
      )}
    </div>
  );
}

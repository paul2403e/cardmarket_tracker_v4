"use client";

// Spiele zum Ankreuzen (Portfolio): jede Kombination, mindestens eins. Wird im Konto gespeichert.
import { useCallback } from "react";
import { GAMES } from "@/lib/games";
import { useSettings } from "@/lib/settings";

export function useGameFilter() {
  const { portfolioGames } = useSettings();
  const key = portfolioGames.join(",");
  return useCallback((game: string) => !key || key.split(",").includes(game), [key]);
}

export function GameFilter() {
  const { portfolioGames, setPortfolioGames } = useSettings();
  const all = portfolioGames.length === 0;
  const on = (key: string) => all || portfolioGames.includes(key);
  function toggle(key: string) {
    const current = all ? GAMES.map((g) => g.key) : portfolioGames;
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    if (next.length === 0) return; // mindestens ein Spiel bleibt angekreuzt
    setPortfolioGames(next.length === GAMES.length ? [] : next); // alle angekreuzt = "alle"
  }
  return (
    <div role="group" aria-label="Games shown" className="flex flex-wrap gap-1.5">
      {GAMES.map((g) => (
        <button key={g.key} type="button" aria-pressed={on(g.key)} onClick={() => toggle(g.key)}
          className={`flex items-center gap-1.5 rounded-[var(--radius-control)] px-3.5 py-1.5 text-sm ring-1 ${
            on(g.key) ? "bg-cobalt-soft font-semibold text-cobalt ring-cobalt/40" : "text-slate ring-line hover:text-ink"
          }`}>
          <span aria-hidden className="w-3 text-xs leading-none">{on(g.key) ? "✓" : "+"}</span>
          {g.name}
        </button>
      ))}
    </div>
  );
}

/** Eine beschriftete Filterzeile (Portfolio, Spiele) – Beschriftung links, auf dem Handy darüber. */
export function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
      <span className="w-20 shrink-0 text-sm text-slate">{label}</span>
      {children}
    </div>
  );
}

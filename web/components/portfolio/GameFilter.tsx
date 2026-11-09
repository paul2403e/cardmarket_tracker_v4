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
    <div role="group" aria-label="Games shown" className="flex flex-wrap gap-2">
      {GAMES.map((g) => (
        <button key={g.key} type="button" aria-pressed={on(g.key)} onClick={() => toggle(g.key)}
          className={`flex items-center gap-2 rounded-[var(--radius-control)] px-3 py-1.5 text-sm ring-1 ${
            on(g.key) ? "bg-surface font-semibold text-ink ring-ink" : "text-slate ring-line hover:text-ink"
          }`}>
          <span aria-hidden className={`grid h-4 w-4 place-items-center rounded-[4px] text-[11px] leading-none ${
            on(g.key) ? "bg-ink text-white" : "ring-1 ring-line"
          }`}>{on(g.key) ? "✓" : ""}</span>
          {g.name}
        </button>
      ))}
    </div>
  );
}

"use client";

// Neu hinzugefügtes Spiel ohne Daten: Hinweis statt leerer Seiten.
import { notYet, useStatus } from "@/lib/data";
import { useGame } from "@/lib/games";

export function GameGate({ children }: { children: React.ReactNode }) {
  const game = useGame();
  const { error } = useStatus();
  if (!notYet(error)) return <>{children}</>;
  return (
    <section className="mx-auto max-w-xl py-16 text-center">
      <h1 className="display text-3xl">{game.name} is coming</h1>
      <p className="mt-3 text-slate">
        Tracking for {game.name} has just started. Prices appear here after the first daily run, usually later today.
      </p>
    </section>
  );
}

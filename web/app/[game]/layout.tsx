import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GameGate } from "@/components/GameGate";
import { GAMES, gameOf } from "@/lib/gameList";

export function generateStaticParams() {
  return GAMES.map((g) => ({ game: g.key }));
}

export async function generateMetadata({ params }: { params: Promise<{ game: string }> }): Promise<Metadata> {
  const game = gameOf((await params).game);
  return game ? { title: { default: game.name, template: `%s – ${game.name}` } } : {};
}

export default async function GameLayout({ children, params }: {
  children: React.ReactNode;
  params: Promise<{ game: string }>;
}) {
  if (!gameOf((await params).game)) notFound();
  return <GameGate>{children}</GameGate>;
}

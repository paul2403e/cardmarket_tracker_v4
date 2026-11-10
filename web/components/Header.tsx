"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { GAMES, gameHref, rememberGame, useGame, type Game } from "@/lib/games";
import { SITE_NAME } from "@/lib/site";
import { useSettings } from "@/lib/settings";
import { Search } from "./Search";
import { Switch } from "./Switch";

/** Beim Wechsel des Spiels: Browse bleibt Browse, alles andere führt zur Markt-Seite des Spiels. */
function switchHref(path: string, from: Game, to: Game): string {
  return path.startsWith(gameHref(from, "/browse")) ? gameHref(to, "/browse") : gameHref(to);
}

function AccountLink() {
  const { enabled, user, loading } = useAuth();
  const path = usePathname();
  if (!enabled || loading) return null;
  if (!user) {
    const next = path.startsWith("/login") || path.startsWith("/signup") ? "" : `?next=${encodeURIComponent(path)}`;
    return (
      <Link href={`/login${next}`}
        className="rounded-[var(--radius-control)] px-4 py-1.5 text-[15px] font-semibold ring-1 ring-line hover:ring-ink">
        Sign in
      </Link>
    );
  }
  const initial = (user.email ?? "?").slice(0, 1).toUpperCase();
  return (
    <Link href="/account" aria-label={`Account (${user.email})`} title={user.email ?? "Account"}
      className={`grid h-9 w-9 place-items-center rounded-full text-sm font-semibold ${
        path.startsWith("/account") ? "bg-ink text-white" : "bg-cobalt-soft text-cobalt hover:bg-ink hover:text-white"
      }`}>
      {initial}
    </Link>
  );
}

export function Header() {
  const { euOnly, setEuOnly } = useSettings();
  const game = useGame();
  const path = usePathname();
  const market = path === gameHref(game);
  const browse = path.startsWith(gameHref(game, "/browse"));
  const { enabled } = useAuth();
  const onGamePage = GAMES.some((g) => path === gameHref(g) || path.startsWith(`${gameHref(g)}/`));
  const nav = [
    { href: gameHref(game), label: "Market", active: market },
    { href: gameHref(game, "/browse"), label: "Browse", active: browse },
    ...(enabled ? [
      { href: "/portfolio", label: "Portfolio", active: path.startsWith("/portfolio") },
      { href: "/watchlist", label: "Watchlist", active: path.startsWith("/watchlist") },
    ] : []),
  ];
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-8 gap-y-2 px-4 pt-3 pb-3 sm:px-6">
        <Link href={gameHref(game)} className="flex items-center gap-2.5" aria-label={`${SITE_NAME} home`}>
          <span className="h-6 w-6 rounded-[5px]" style={{ background: "var(--holo)" }} aria-hidden />
          <span className="display text-lg">{SITE_NAME}</span>
        </Link>
        <nav aria-label="Game" className="no-scrollbar -mx-1 flex max-w-full gap-1 overflow-x-auto overflow-y-hidden">
          {GAMES.map((g) => {
            const active = onGamePage && g.key === game.key;
            return (
              <Link key={g.key} href={switchHref(path, game, g)} onClick={() => rememberGame(g.key)}
                aria-current={active ? "true" : undefined}
                className={`relative shrink-0 whitespace-nowrap px-2 pt-1.5 pb-2 text-[15px] ${
                  active ? "font-semibold text-ink" : "text-slate hover:text-ink"
                }`}>
                {g.name}
                <span aria-hidden className="absolute inset-x-2 bottom-0 h-[3px] rounded-full"
                  style={{ background: active ? "var(--holo)" : "transparent" }} />
              </Link>
            );
          })}
        </nav>
        <nav aria-label="Main" className="no-scrollbar -mx-1 flex max-w-full gap-1 overflow-x-auto overflow-y-hidden px-1">
          {nav.map((n) => (
            <Link key={n.label} href={n.href} aria-current={n.active ? "page" : undefined}
              className={`shrink-0 whitespace-nowrap rounded-[var(--radius-control)] px-4 py-1.5 text-[15px] font-semibold ${
                n.active ? "bg-ink text-white" : "text-ink hover:bg-cobalt-soft"
              }`}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-4">
          <Switch label="EU only" checked={euOnly} onChange={setEuOnly}
            hint="Prices only from sellers in the EU (no customs). Items listed always count all countries." />
          <AccountLink />
        </div>
      </div>
      {!market && (
        <div className="border-t border-line bg-paper">
          <div className="mx-auto max-w-[1200px] px-4 py-3 sm:px-6">
            <div className="max-w-2xl">
              <Search key={game.key} />
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

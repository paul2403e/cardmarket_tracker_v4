"use client";

// Aktuelles Spiel (aus der Adresse) und das zuletzt gewählte Spiel dieses Browsers.
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { DEFAULT_GAME, gameOf, type Game } from "./gameList";

export { DEFAULT_GAME, GAMES, gameHref, gameOf, type Game } from "./gameList";
const STORE_KEY = "cmtracker.game";

/** Zuletzt gewähltes Spiel (nur in diesem Browser). */
export function rememberedGame(): Game {
  try {
    return gameOf(window.localStorage.getItem(STORE_KEY)) ?? DEFAULT_GAME;
  } catch {
    return DEFAULT_GAME;
  }
}

export function rememberGame(key: string) {
  try {
    if (window.localStorage.getItem(STORE_KEY) === key) return;
    window.localStorage.setItem(STORE_KEY, key);
  } catch {
    // privates Fenster o. Ä.: dann eben nicht merken
  }
  // für angemeldete Nutzer im Konto speichern (lib/settings.tsx hört darauf)
  window.dispatchEvent(new CustomEvent(GAME_EVENT, { detail: key }));
}

export const GAME_EVENT = "cmtracker:game";

/** Aktuelles Spiel: aus der Adresse (/one-piece/…), sonst das zuletzt gewählte (z. B. auf /how-prices-work). */
export function useGame(): Game {
  const params = useParams<{ game?: string }>();
  const fromUrl = gameOf(params?.game);
  const [remembered, setRemembered] = useState<Game>(DEFAULT_GAME);
  useEffect(() => {
    if (fromUrl) rememberGame(fromUrl.key);
    else setRemembered(rememberedGame());
  }, [fromUrl]);
  return fromUrl ?? remembered;
}


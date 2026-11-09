// Die Spiele der Website. Schlüssel = Ordner der Daten in R2 (public/<schlüssel>/…) und Teil der Adresse.
// Sprachen in der Reihenfolge der Auswahlknöpfe (wie in scraper/config/games/*.yaml).
import type { Lang } from "./types";

export type Game = { key: string; name: string; langs: Lang[] };

export const GAMES: Game[] = [
  { key: "pokemon", name: "Pokémon", langs: ["en", "de", "ja"] },
  { key: "one-piece", name: "One Piece", langs: ["en", "ja"] },
  { key: "flesh-and-blood", name: "Flesh and Blood", langs: ["en", "de", "ja"] },
];
export const DEFAULT_GAME = GAMES[0];

export const gameOf = (key: string | null | undefined) => GAMES.find((g) => g.key === key) ?? null;

/** Adresse innerhalb eines Spiels, z. B. gameHref(game, "/browse") -> "/one-piece/browse". */
export const gameHref = (game: Game, path = "") => `/${game.key}${path}`;

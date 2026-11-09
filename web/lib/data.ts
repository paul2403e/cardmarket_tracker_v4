"use client";

// Daten laden: erst status.json (kurz gecacht), dann alle anderen Dateien mit ?v=<version>.
// Neue Daten am nächsten Morgen = neue Version = neue Adressen, alte bleiben dauerhaft im CDN-Cache.
import useSWR from "swr";
import { useGame } from "./games";
import type { Catalog, MarketIndex, ProductDetail, Spark, Status } from "./types";

export class DataError extends Error {
  constructor(public status: number, url: string) {
    super(`${status} ${url}`);
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new DataError(res.status, url);
  return res.json() as Promise<T>;
}

/** Für dieses Spiel gibt es noch keine Daten (z. B. neu hinzugefügt, erster Lauf steht aus). */
export const notYet = (error: unknown) => error instanceof DataError && error.status === 404;

export function useStatus() {
  const game = useGame();
  return useSWR<Status>(`/api/data/${game.key}/status.json`, fetchJson, {
    revalidateOnFocus: true,
    dedupingInterval: 60_000,
  });
}

function useVersioned<T>(file: string | null) {
  const game = useGame();
  const { data: status } = useStatus();
  const key = status && file ? `/api/data/${game.key}/${file}?v=${status.version}` : null;
  return useSWR<T>(key, fetchJson, { revalidateOnFocus: false });
}

export const useCatalog = () => useVersioned<Catalog>("catalog.json");
export const useMarketIndex = () => useVersioned<MarketIndex>("index.json");
export const useSpark = () => useVersioned<Spark>("spark.json");
export const useProduct = (id: number | null) => useVersioned<ProductDetail>(id ? `products/${id}.json` : null);

/** Alter der Daten in Stunden (für den Hinweis bei veralteten Daten). */
export function ageHours(status: Status | undefined): number | null {
  if (!status) return null;
  return (Date.now() - new Date(status.updatedAt).getTime()) / 3_600_000;
}

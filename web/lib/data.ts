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

/** Stand eines Spiels (Standard: das Spiel aus der Adresse bzw. das zuletzt gewählte). */
export function useStatusFor(gameKey: string | null) {
  return useSWR<Status>(gameKey ? `/api/data/${gameKey}/status.json` : null, fetchJson, {
    revalidateOnFocus: true,
    dedupingInterval: 60_000,
  });
}

export function useStatus() {
  return useStatusFor(useGame().key);
}

function useVersionedFor<T>(gameKey: string | null, file: string | null) {
  const { data: status } = useStatusFor(gameKey);
  const key = status && file && gameKey ? `/api/data/${gameKey}/${file}?v=${status.version}` : null;
  return useSWR<T>(key, fetchJson, { revalidateOnFocus: false });
}

function useVersioned<T>(file: string | null) {
  return useVersionedFor<T>(useGame().key, file);
}

/** Katalog eines bestimmten Spiels (Portfolio: Spiele unabhängig von der Adresse). */
export const useCatalogFor = (gameKey: string | null) => useVersionedFor<Catalog>(gameKey, "catalog.json");

export const useCatalog = () => useVersioned<Catalog>("catalog.json");
export const useMarketIndex = () => useVersioned<MarketIndex>("index.json");
export const useSpark = () => useVersioned<Spark>("spark.json");
export const useProduct = (id: number | null) => useVersioned<ProductDetail>(id ? `products/${id}.json` : null);

/** Alter der Daten in Stunden (für den Hinweis bei veralteten Daten). */
export function ageHours(status: Status | undefined): number | null {
  if (!status) return null;
  return (Date.now() - new Date(status.updatedAt).getTime()) / 3_600_000;
}

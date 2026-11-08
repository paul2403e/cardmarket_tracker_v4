"use client";

// Daten laden: erst status.json (kurz gecacht), dann alle anderen Dateien mit ?v=<version>.
// Neue Daten am nächsten Morgen = neue Version = neue Adressen, alte bleiben dauerhaft im CDN-Cache.
import useSWR from "swr";
import type { Catalog, MarketIndex, ProductDetail, Spark, Status } from "./types";

export const GAME = "pokemon";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json() as Promise<T>;
}

export function useStatus() {
  return useSWR<Status>(`/api/data/${GAME}/status.json`, fetchJson, {
    revalidateOnFocus: true,
    dedupingInterval: 60_000,
  });
}

function useVersioned<T>(file: string | null) {
  const { data: status } = useStatus();
  const key = status && file ? `/api/data/${GAME}/${file}?v=${status.version}` : null;
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

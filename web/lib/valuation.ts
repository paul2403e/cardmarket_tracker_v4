"use client";

// Bewertung der Positionen mit dem fairen Preis "nur Artikel" (heute, sonst letzter bekannter).
import { useCatalogFor } from "./data";
import { GAMES } from "./games";
import type { Position } from "./portfolio";
import type { Catalog, ProductSummary, Region } from "./types";

/** Kataloge aller Spiele, die im Portfolio vorkommen (feste Anzahl Hooks: eins je Spiel). */
export function useCatalogs(games: Set<string>): Record<string, Catalog | undefined> {
  const out: Record<string, Catalog | undefined> = {};
  for (const g of GAMES) {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- GAMES ist fest, die Reihenfolge ändert sich nie
    out[g.key] = useCatalogFor(games.has(g.key) ? g.key : null).data;
  }
  return out;
}

export interface Valued extends Position {
  product: ProductSummary | null;
  priceCents: number | null; // fairer Preis "nur Artikel" pro Stück
  priceDay: string | null; // gesetzt, wenn es nicht der heutige Preis ist
  valueCents: number | null;
}

export function valuate(p: Position, catalogs: Record<string, Catalog | undefined>, region: Region): Valued {
  const product = catalogs[p.game]?.products.find((x) => x.id === p.productId) ?? null;
  const v = product?.languages[p.language];
  const today = v?.price?.[region]?.excl ?? null;
  const last = today === null ? v?.last?.[region] ?? null : null;
  const euro = today ?? last?.excl ?? null;
  const priceCents = euro === null ? null : Math.round(euro * 100);
  return {
    ...p, product, priceCents, priceDay: last?.day ?? null,
    valueCents: priceCents === null ? null : priceCents * p.quantity,
  };
}

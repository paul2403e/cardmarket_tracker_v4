"use client";

// Bewertung der Positionen mit dem fairen Preis "nur Artikel" (heute, sonst letzter bekannter).
import { useCatalogFor, useStatusFor } from "./data";
import { GAMES } from "./games";
import type { Position } from "./portfolio";
import type { Catalog, ProductSummary, Region } from "./types";

/** Kataloge aller Spiele, die im Portfolio vorkommen (feste Anzahl Hooks: eins je Spiel). */
export function useCatalogs(games: Set<string>): Record<string, Catalog | undefined> {
  return useCatalogsState(games).catalogs;
}

/** Wie useCatalogs, dazu `ready`: alle angefragten Spiele geladen oder ohne Daten (z. B. noch kein Lauf). */
export function useCatalogsState(games: Set<string>) {
  const catalogs: Record<string, Catalog | undefined> = {};
  let ready = true;
  for (const g of GAMES) {
    const want = games.has(g.key);
    // eslint-disable-next-line react-hooks/rules-of-hooks -- GAMES ist fest, die Reihenfolge ändert sich nie
    const status = useStatusFor(want ? g.key : null);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const cat = useCatalogFor(want ? g.key : null);
    catalogs[g.key] = cat.data;
    if (want && !cat.data && !status.error && !cat.error) ready = false;
  }
  return { catalogs, ready };
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

/** Zusammengefasste Position: dasselbe Produkt (Sprache) aus mehreren Portfolios als eine Zeile. */
export type MergedValued = Valued & { depotIds: string[]; parts: Valued[] };

/** Positionen je Produkt + Sprache zusammenfassen (Stück, Einstand, Wert, realisiert addiert; Kaufposten nach Datum). */
export function mergeValued(rows: Valued[]): MergedValued[] {
  const by = new Map<string, MergedValued>();
  for (const r of rows) {
    const k = `${r.game}|${r.productId}|${r.language}`;
    const m = by.get(k);
    if (!m) {
      by.set(k, { ...r, key: k, lots: [...r.lots], depotIds: [r.depotId], parts: [r] });
      continue;
    }
    m.quantity += r.quantity;
    m.costCents += r.costCents;
    m.realizedCents += r.realizedCents;
    m.soldQuantity += r.soldQuantity;
    m.oversold += r.oversold;
    m.valueCents = m.valueCents === null && r.valueCents === null ? null : (m.valueCents ?? 0) + (r.valueCents ?? 0);
    m.lots = [...m.lots, ...r.lots].sort((a, b) => a.date.localeCompare(b.date));
    m.depotIds.push(r.depotId);
    m.parts.push(r);
  }
  return [...by.values()];
}

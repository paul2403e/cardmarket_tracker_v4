// Hilfsfunktionen für Listen auf Start- und Browse-Seite: Produkte × Sprachen ("Varianten").
import type { Catalog, Lang, Period, ProductSummary, Region, VariantNow } from "./types";

export interface Variant {
  product: ProductSummary;
  lang: Lang;
  v: VariantNow;
}

/** Schwellen für Top Movers: sonst stehen dort nur Kleinstmärkte mit 2 Angeboten. */
export const MOVER_MIN_ITEMS = 5;
export const MOVER_MIN_PRICE = 10;

export function variants(catalog: Catalog | undefined, lang: Lang | "all" = "all"): Variant[] {
  if (!catalog) return [];
  const out: Variant[] = [];
  for (const product of catalog.products) {
    for (const [l, v] of Object.entries(product.languages) as [Lang, VariantNow][]) {
      if (v && (lang === "all" || lang === l)) out.push({ product, lang: l, v });
    }
  }
  return out;
}

export function priceOf(v: VariantNow, region: Region, incl: boolean): number | null {
  return v.price?.[region]?.[incl ? "incl" : "excl"] ?? null;
}

/** Veränderung des fairen Preises (inkl. Versand) – nur vorhanden, wenn es am Anfang und Ende einen Preis gab. */
export function changeOf(v: VariantNow, period: Period, region: Region): number | null {
  return v.change?.[period]?.[region] ?? null;
}

export function movers(list: Variant[], period: Period, region: Region, incl: boolean) {
  const eligible = list.filter(({ v }) => {
    const p = priceOf(v, region, incl);
    return (
      v.status === "ok" && p !== null && p >= MOVER_MIN_PRICE && (v.items ?? 0) >= MOVER_MIN_ITEMS &&
      changeOf(v, period, region) !== null
    );
  });
  const sorted = [...eligible].sort((a, b) => changeOf(b.v, period, region)! - changeOf(a.v, period, region)!);
  return {
    gainers: sorted.filter((x) => changeOf(x.v, period, region)! > 0).slice(0, 6),
    losers: sorted.filter((x) => changeOf(x.v, period, region)! < 0).reverse().slice(0, 6),
  };
}

/** Bestand schrumpft: stärkster Rückgang der gelisteten Stück in 7 Tagen (noch mindestens 3 Stück am Markt). */
export function stockDrops(list: Variant[], period: Period = "7d") {
  return list
    .filter(({ v }) => (v.items ?? 0) >= 3 && (v.change?.[period]?.items ?? 0) <= -10)
    .sort((a, b) => a.v.change[period].items! - b.v.change[period].items!)
    .slice(0, 6);
}

export function newest(catalog: Catalog | undefined, n = 6): ProductSummary[] {
  if (!catalog) return [];
  return catalog.products
    .filter((p) => p.active && p.added && Object.values(p.languages).some((v) => v?.status === "ok"))
    .sort((a, b) => (b.added ?? "").localeCompare(a.added ?? ""))
    .slice(0, n);
}

/** Günstigster Preis über alle Sprachen (für Listen, in denen das Produkt als Ganzes steht). */
export function lowestPrice(p: ProductSummary, region: Region, incl: boolean): number | null {
  const prices = Object.values(p.languages)
    .map((v) => (v ? priceOf(v, region, incl) : null))
    .filter((x): x is number => x !== null);
  return prices.length ? Math.min(...prices) : null;
}

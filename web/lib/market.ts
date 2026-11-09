// Hilfsfunktionen für Listen auf Start- und Browse-Seite: Produkte × Sprachen ("Varianten").
import type { Catalog, Lang, Period, ProductSummary, Region, VariantNow } from "./types";

export interface Variant {
  product: ProductSummary;
  lang: Lang;
  v: VariantNow;
}

/** Einstellungen der Startseiten-Listen. Mindestbestand und -preis: sonst stehen bei Top Movers und Supply
 *  nur Kleinstmärkte mit 2 Angeboten, deren Prozente Zufall sind. */
export interface ListPrefs {
  minItems: number;
  minPrice: number;
  listSize: number;
}
export const LIST_DEFAULTS: ListPrefs = { minItems: 10, minPrice: 10, listSize: 50 };
export const LIST_SIZES = [10, 25, 50, 100];

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

export function movers(list: Variant[], period: Period, region: Region, incl: boolean, prefs = LIST_DEFAULTS) {
  const eligible = list.filter(({ v }) => {
    const p = priceOf(v, region, incl);
    return (
      v.status === "ok" && p !== null && p >= prefs.minPrice && (v.items ?? 0) >= prefs.minItems &&
      changeOf(v, period, region) !== null
    );
  });
  const sorted = [...eligible].sort((a, b) => changeOf(b.v, period, region)! - changeOf(a.v, period, region)!);
  return {
    gainers: sorted.filter((x) => changeOf(x.v, period, region)! > 0).slice(0, prefs.listSize),
    losers: sorted.filter((x) => changeOf(x.v, period, region)! < 0).reverse().slice(0, prefs.listSize),
  };
}

/** Gelistete Stück zu Beginn des Zeitraums (aus heutigem Bestand und Veränderung in %). */
export function itemsAtStart(v: VariantNow, period: Period): number | null {
  const c = v.change?.[period]?.items;
  if (c === null || c === undefined || v.items === null) return null;
  return Math.round(v.items / (1 + c / 100));
}

/** Bestand wächst/schrumpft: Veränderung der gelisteten Stück in %. Gleiche Regel wie bei Top Movers:
 *  Mindestbestand zu Beginn des Zeitraums und Mindestpreis – sonst sind Prozente Zufall. */
export function supplyMovers(list: Variant[], period: Period, region: Region, prefs = LIST_DEFAULTS) {
  const eligible = list.filter(({ v }) => {
    const start = itemsAtStart(v, period);
    const p = priceOf(v, region, true);
    return start !== null && start >= prefs.minItems && p !== null && p >= prefs.minPrice;
  });
  const sorted = [...eligible].sort((a, b) => b.v.change[period].items! - a.v.change[period].items!);
  return {
    growing: sorted.filter((x) => x.v.change[period].items! > 0).slice(0, prefs.listSize),
    shrinking: sorted.filter((x) => x.v.change[period].items! < 0).reverse().slice(0, prefs.listSize),
  };
}

export function newest(catalog: Catalog | undefined, n = LIST_DEFAULTS.listSize): ProductSummary[] {
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

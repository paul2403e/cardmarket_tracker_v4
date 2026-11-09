"use client";

// Portfolio-Performance (Meilenstein 7). Grundlage sind die gekauften Posten nach FIFO ("Chunks"):
// – Standard: nur was du heute hältst, jeder Posten ab seinem Kaufdatum (am Kauftag mit dem bezahlten Preis, danach
//   mit dem fairen Preis "nur Artikel").
// – "Include sold items": verkaufte Posten bis zum Verkaufstag zum fairen Preis, am Verkaufstag zum tatsächlichen
//   Verkaufspreis, danach bleibt der Erlös als fester Betrag stehen.
// Vor dem ersten Preis (Trackingbeginn) wird linear vom Kaufpreis zum ersten fairen Preis geschätzt.
// Performance in % ist zeitgewichtet: pro Tag zählt nur die Preisbewegung von Posten, die gestern und heute dabei waren –
// Käufe und Verkäufe verschieben die Kurve nicht. Beträge in Cent.
import useSWR from "swr";
import { useStatusFor } from "./data";
import { GAMES } from "./games";
import type { Txn } from "./portfolio";
import type { Lang, ProductDetail, Region } from "./types";

export interface Chunk {
  key: string; // game|id|lang
  depotId: string;
  game: string;
  productId: number;
  language: Lang;
  qty: number;
  unitCost: number;
  buyDate: string;
  sellDate?: string;
  sellUnit?: number;
  sellId?: string; // Verkaufs-Transaktion
}

const byDate = (a: Txn, b: Txn) =>
  a.trade_date.localeCompare(b.trade_date) || (a.kind === b.kind ? 0 : a.kind === "buy" ? -1 : 1) ||
  a.created_at.localeCompare(b.created_at);

/** Käufe in Posten zerlegen: verkaufte Teile (mit Verkaufsdatum/-preis) und noch gehaltene Teile, nach FIFO. */
export function chunks(txns: Txn[]): Chunk[] {
  const groups = new Map<string, Txn[]>();
  for (const t of txns) {
    const g = `${t.depot_id}|${t.game}|${t.product_id}|${t.language}`;
    (groups.get(g) ?? groups.set(g, []).get(g)!).push(t);
  }
  const out: Chunk[] = [];
  for (const list of groups.values()) {
    list.sort(byDate);
    const lots: Chunk[] = [];
    for (const t of list) {
      const base = { key: `${t.game}|${t.product_id}|${t.language}`, depotId: t.depot_id, game: t.game, productId: t.product_id, language: t.language };
      if (t.kind === "buy") {
        lots.push({ ...base, qty: t.quantity, unitCost: t.unit_price_cents, buyDate: t.trade_date });
        continue;
      }
      let left = t.quantity;
      while (left > 0 && lots.length) {
        const lot = lots[0];
        const take = Math.min(left, lot.qty);
        out.push({ ...lot, qty: take, sellDate: t.trade_date, sellUnit: t.unit_price_cents, sellId: t.id });
        lot.qty -= take;
        left -= take;
        if (lot.qty === 0) lots.shift();
      }
    }
    out.push(...lots);
  }
  return out;
}

// --- Preisverläufe -----------------------------------------------------------------------------
export interface Series {
  days: string[];
  cents: (number | null)[];
  firstIdx: number; // erster Tag mit Preis (-1 = nie)
}

function makeSeries(days: string[], euros: (number | null)[]): Series {
  const cents = euros.map((v) => (v === null || v === undefined ? null : Math.round(v * 100)));
  return { days, cents, firstIdx: cents.findIndex((c) => c !== null) };
}

/** Letzter bekannter Preis am oder vor `day` (null vor dem ersten Preis). */
function priceOn(s: Series, day: string): number | null {
  let lo = 0;
  let hi = s.days.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (s.days[mid] <= day) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  for (let i = idx; i >= 0; i--) if (s.cents[i] !== null) return s.cents[i];
  return null;
}

const DAY = 86_400_000;
const toTime = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const toIso = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => toIso(toTime(iso) + n * DAY);
export const daysBetween = (a: string, b: string) => Math.round((toTime(b) - toTime(a)) / DAY);

/** Wert eines Stücks an einem Tag. estimated = vor dem ersten fairen Preis (oder nie ein Preis). */
function unitValue(c: Chunk, s: Series | undefined, day: string, includeSold: boolean):
  { v: number; estimated: boolean } | null {
  if (day < c.buyDate) return null;
  if (c.sellDate && day >= c.sellDate) return includeSold ? { v: c.sellUnit!, estimated: false } : null;
  // Kauftag: zum bezahlten Preis – ab dem nächsten Tag zählt der Markt (wie bei Trade Republic: Kaufkurs = Einstieg)
  if (day === c.buyDate) return { v: c.unitCost, estimated: false };
  if (!s || s.firstIdx < 0) return { v: c.unitCost, estimated: true };
  const first = s.days[s.firstIdx];
  if (day >= first) return { v: priceOn(s, day)!, estimated: false };
  // vor Trackingbeginn: linear vom Kaufpreis zum ersten fairen Preis
  const span = daysBetween(c.buyDate, first);
  const share = span > 0 ? daysBetween(c.buyDate, day) / span : 1;
  return { v: Math.round(c.unitCost + (s.cents[s.firstIdx]! - c.unitCost) * share), estimated: true };
}

export interface DayPoint {
  day: string;
  value: number;
  invested: number;
  factor: number; // Tagesrendite + 1 (zeitgewichtet)
  gain: number; // Wertänderung der Posten, die gestern und heute dabei waren
  estimated: boolean;
  buys: number;
  sells: number;
}

/** Tagesverlauf vom ersten Kauf bis `today`. */
export function timeline(cs: Chunk[], txns: Txn[], series: Map<string, Series>, today: string, includeSold: boolean): DayPoint[] {
  const relevant = cs.filter((c) => includeSold || !c.sellDate);
  if (!relevant.length) return [];
  const start = relevant.reduce((m, c) => (c.buyDate < m ? c.buyDate : m), today);
  const counts = new Map<string, { buys: number; sells: number }>();
  for (const t of txns) {
    const e = counts.get(t.trade_date) ?? { buys: 0, sells: 0 };
    if (t.kind === "buy") e.buys++;
    else e.sells++;
    counts.set(t.trade_date, e);
  }
  const out: DayPoint[] = [];
  let prev: (number | null)[] = relevant.map(() => null);
  for (let day = start; day <= today; day = addDays(day, 1)) {
    let value = 0, invested = 0, same = 0, samePrev = 0, estimated = false;
    const cur = relevant.map((c, i) => {
      const u = unitValue(c, series.get(c.key), day, includeSold);
      if (!u) return null;
      const v = u.v * c.qty;
      value += v;
      invested += c.unitCost * c.qty;
      if (u.estimated) estimated = true;
      if (prev[i] !== null) {
        same += v;
        samePrev += prev[i]!;
      }
      return v;
    });
    const n = counts.get(day);
    out.push({
      day, value, invested, estimated, buys: n?.buys ?? 0, sells: n?.sells ?? 0,
      factor: samePrev > 0 ? same / samePrev : 1, gain: same - samePrev,
    });
    prev = cur;
  }
  return out;
}

/** Performance seit `from` (exklusive) bis zum letzten Tag: % zeitgewichtet, € als Summe der Wertänderungen. */
export function performance(points: DayPoint[], from: string): { pct: number; cents: number; estimated: boolean; complete: boolean } | null {
  if (!points.length) return null;
  let f = 1, cents = 0, estimated = false;
  for (const p of points) {
    if (p.day <= from) continue;
    f *= p.factor;
    cents += p.gain;
    if (p.estimated) estimated = true;
  }
  const startPoint = points.find((p) => p.day >= from);
  if (startPoint?.estimated) estimated = true;
  return { pct: (f - 1) * 100, cents, estimated, complete: points[0].day <= from };
}

/** Verlauf für den Graphen ab `from`: Performance in % (Start 0 %), Wert und Einstand in €. */
export function chartSeries(points: DayPoint[], from: string) {
  const out: (DayPoint & { pct: number })[] = [];
  let f = 1;
  for (const p of points) {
    if (p.day < from) continue;
    if (out.length) f *= p.factor;
    out.push({ ...p, pct: (f - 1) * 100 });
  }
  return out;
}

/** Veränderung einer Position im Zeitraum (nur gehaltene Posten): € und % bezogen auf den Wert am Start
 *  (bzw. am Kaufdatum, wenn später gekauft). period = "all": Gewinn gegenüber dem Einstand. */
export function positionChange(cs: Chunk[], series: Map<string, Series>, today: string, from: string | "all"):
  { cents: number; base: number; estimated: boolean } {
  let cents = 0, base = 0, estimated = false;
  for (const c of cs) {
    if (c.sellDate) continue;
    const end = unitValue(c, series.get(c.key), today, false);
    if (!end) continue;
    if (end.estimated) estimated = true;
    if (from === "all") {
      cents += (end.v - c.unitCost) * c.qty;
      base += c.unitCost * c.qty;
      continue;
    }
    const startDay = c.buyDate > from ? c.buyDate : from;
    const start = unitValue(c, series.get(c.key), startDay, false);
    if (!start) continue;
    if (start.estimated) estimated = true;
    cents += (end.v - start.v) * c.qty;
    base += start.v * c.qty;
  }
  return { cents, base, estimated };
}

// --- Laden der Preisverläufe (Produktdateien) ------------------------------------------------
async function fetchAll(urls: { key: string; url: string }[]): Promise<Record<string, ProductDetail | null>> {
  const out: Record<string, ProductDetail | null> = {};
  let i = 0;
  const worker = async () => {
    while (i < urls.length) {
      const { key, url } = urls[i++];
      try {
        const res = await fetch(url);
        out[key] = res.ok ? ((await res.json()) as ProductDetail) : null;
      } catch {
        out[key] = null;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, urls.length) }, worker));
  return out;
}

/** Preisverläufe ("nur Artikel", nach Region) aller Produkte in den Transaktionen. */
export function usePriceSeries(txns: Txn[], region: Region) {
  const versions: Record<string, string | undefined> = {};
  for (const g of GAMES) {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- GAMES ist fest
    versions[g.key] = useStatusFor(txns.some((t) => t.game === g.key) ? g.key : null).data?.version;
  }
  const wanted = [...new Set(txns.map((t) => `${t.game}|${t.product_id}`))].sort();
  const urls = wanted.flatMap((k) => {
    const [game, id] = k.split("|");
    const v = versions[game];
    return v ? [{ key: k, url: `/api/data/${game}/products/${id}.json?v=${v}` }] : [];
  });
  const ready = urls.length === wanted.length;
  const swr = useSWR(ready && urls.length ? ["series", ...urls.map((u) => u.url)] : null, () => fetchAll(urls),
    { revalidateOnFocus: false });
  const map = new Map<string, Series>();
  if (swr.data) {
    for (const [k, detail] of Object.entries(swr.data)) {
      if (!detail) continue;
      for (const [lang, v] of Object.entries(detail.languages)) {
        if (!v) continue;
        map.set(`${k}|${lang}`, makeSeries(v.series.days, v.series[`${region}_excl`]));
      }
    }
  }
  const lastDay = swr.data
    ? Object.values(swr.data).reduce((m, d) => {
      const days = d ? Object.values(d.languages).map((v) => v?.series.days.at(-1) ?? "") : [];
      return days.reduce((a, b) => (b > a ? b : a), m);
    }, "")
    : "";
  return { series: map, loading: !txns.length ? false : !swr.data, lastDay: lastDay || null };
}

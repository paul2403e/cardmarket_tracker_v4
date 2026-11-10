"use client";

// Produktvergleich: bis zu 6 Produkte (Spiel + Produkt + Sprache) in einem Graphen übereinander – Veränderung in %
// (alle starten bei 0 %) oder Preis in €, dazu eine Tabelle. Auswahl steht in der Adresse (?items=spiel:id:sprache,…),
// wird gemerkt und kann unter einem Namen gespeichert werden (Einstellungen, angemeldet auch im Konto).
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { LangBadge } from "@/components/LangBadge";
import { Thumb } from "@/components/ProductRow";
import { ReliabilityBadge } from "@/components/ReliabilityBadge";
import { Segmented } from "@/components/Segmented";
import { CustomRange, customDefault, resolveCustom, type CustomValue } from "@/components/CustomRange";
import { SortTh, nextSort, type Sort } from "@/components/portfolio/SortTh";
import { HoldConfirm } from "@/components/watch/Dialog";
import { useAuth } from "@/lib/auth";
import { useCatalogFor, useProductFor } from "@/lib/data";
import { LANG_SHORT, count, money, pct, trendClass } from "@/lib/format";
import { GAMES, gameHref, gameOf } from "@/lib/games";
import { ownedKey, useOwned } from "@/lib/portfolio";
import { confidence, points, range as rangeOf } from "@/lib/series";
import { COMPARE_MAX, cleanCompareItems, useSettings } from "@/lib/settings";
import type { Lang, ProductDetail, ProductSummary } from "@/lib/types";

const COLORS = ["#2147c9", "#e0a020", "#0e8a5c", "#c53d2b", "#7a4cc2", "#1aa3b8"];
const SLOTS = Array.from({ length: COMPARE_MAX }, (_, i) => i);

type View = "pct" | "eur" | "rel";
type Metric = "incl" | "excl" | "items";
type Range = "7" | "30" | "90" | "365" | "all" | "custom";
const RANGES: { value: Range; label: string }[] = [
  { value: "7", label: "7D" }, { value: "30", label: "30D" }, { value: "90", label: "90D" },
  { value: "365", label: "1Y" }, { value: "all", label: "All" }, { value: "custom", label: "Custom" },
];

interface Item { key: string; game: string; id: number; lang: Lang }
const parse = (key: string): Item => {
  const [game, id, lang] = key.split(":");
  return { key, game, id: Number(id), lang: lang as Lang };
};
const shiftDay = (iso: string, n: number) =>
  iso ? new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10) : "";
const fmtDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const tickDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const tickMonth = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
const ptsText = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1).replace(".", ",")} pts`;
const signedPct = (v: number | null) => (v === null ? "–" : `${v > 0 ? "+" : ""}${v.toFixed(1).replace(".", ",")} %`);

/** Suche über alle Spiele: Treffer mit Sprachen zum Hinzufügen. */
function Search({ items, onAdd, onAddMany }: { items: string[]; onAdd: (key: string) => void; onAddMany: (keys: string[]) => void }) {
  const [q, setQ] = useState("");
  const catalogs = GAMES.map((g) => useCatalogFor(g.key).data); // feste Zahl Spiele: Hooks in fester Reihenfolge
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = useMemo(() => {
    if (!words.length) return [];
    const out: { game: string; p: ProductSummary }[] = [];
    GAMES.forEach((g, i) => {
      for (const p of catalogs[i]?.products ?? []) {
        const text = `${p.name ?? ""} ${p.nameDe ?? ""} ${p.category ?? ""} ${p.id}`.toLowerCase();
        if (words.every((w) => text.includes(w)) && Object.keys(p.languages).length) out.push({ game: g.key, p });
      }
    });
    return out.sort((a, b) => Number(b.p.active) - Number(a.p.active)).slice(0, 8);
  }, [words.join(" "), ...catalogs]); // eslint-disable-line react-hooks/exhaustive-deps
  const full = items.length >= COMPARE_MAX;
  return (
    <div className="relative">
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} disabled={full}
        placeholder={full ? `Up to ${COMPARE_MAX} products – remove one to add another` : "Add a product – e.g. 151 booster box"}
        aria-label="Search products to compare"
        className="h-11 w-full rounded-[var(--radius-control)] border border-line bg-surface px-4 outline-none focus:border-cobalt disabled:opacity-60" />
      {hits.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg bg-surface shadow-xl ring-1 ring-line">
          {hits.map(({ game, p }) => (
            <li key={`${game}-${p.id}`} className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2 last:border-0">
              <Thumb src={p.image} category={p.category} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{p.name}</span>
                <span className="text-xs text-slate">{gameOf(game)?.name} · {p.category}</span>
              </span>
              <span className="flex gap-1">
                {Object.keys(p.languages).length > 1 && (() => {
                  const keys = (Object.keys(p.languages) as Lang[]).map((l) => `${game}:${p.id}:${l}`).filter((k) => !items.includes(k));
                  const fits = keys.length > 0 && items.length + keys.length <= COMPARE_MAX;
                  return (
                    <button type="button" disabled={!fits} onClick={() => { onAddMany(keys); setQ(""); }}
                      title={fits ? "Add all languages" : `Not enough room – up to ${COMPARE_MAX} products`}
                      className="rounded-[var(--radius-control)] px-2.5 py-1 text-xs font-semibold ring-1 ring-line hover:bg-cobalt hover:text-white hover:ring-cobalt disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-inherit">
                      + All
                    </button>
                  );
                })()}
                {(Object.keys(p.languages) as Lang[]).map((l) => {
                  const key = `${game}:${p.id}:${l}`;
                  const added = items.includes(key);
                  return (
                    <button key={l} type="button" disabled={added || full}
                      onClick={() => { onAdd(key); setQ(""); }}
                      className="rounded-[var(--radius-control)] px-2.5 py-1 text-xs font-semibold ring-1 ring-line hover:bg-cobalt hover:text-white hover:ring-cobalt disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-inherit">
                      {added ? "✓ " : "+ "}{LANG_SHORT[l]}
                    </button>
                  );
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Compare() {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const { region, compare, setCompare, ready } = useSettings();
  const { enabled, user } = useAuth();
  const owned = useOwned();
  const [view, setView] = useState<View>("pct");
  const [refPick, setRefPick] = useState<string | null>(null); // Bezugsprodukt für "Relative" (Standard: das erste)
  useEffect(() => {
    if (view === "rel" && compare.items.length < 2) setView("pct"); // Relative braucht mindestens zwei Produkte
  }, [view, compare.items.length]);
  const [metric, setMetric] = useState<Metric>("incl");
  const [range, setRange] = useState<Range>("90");
  const [custom, setCustom] = useState<CustomValue>(customDefault);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort<"order" | "name" | "price" | "7d" | "30d" | "1y" | "items">>({ key: "order", dir: 1 });

  // Adresse -> Auswahl (einmal, sobald die gespeicherten Einstellungen geladen sind), danach Auswahl -> Adresse
  const fromUrl = params.get("items");
  const [synced, setSynced] = useState(false);
  useEffect(() => {
    if (!ready || synced) return;
    if (fromUrl !== null) setCompare({ items: cleanCompareItems(fromUrl.split(",")) });
    setSynced(true);
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = synced ? compare.items : fromUrl !== null ? cleanCompareItems(fromUrl.split(",")) : compare.items;
  useEffect(() => {
    if (!synced) return;
    const want = compare.items.join(",");
    if ((params.get("items") ?? "") !== want) router.replace(want ? `${path}?items=${want}` : path, { scroll: false });
  }, [compare.items, synced]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = items.map(parse);
  const details: (ProductDetail | undefined)[] = SLOTS.map((i) => useProductFor(parsed[i]?.game ?? null, parsed[i]?.id ?? null).data); // eslint-disable-line react-hooks/rules-of-hooks
  const variants = parsed.map((it, i) => ({ it, color: COLORS[i], p: details[i], v: details[i]?.languages[it.lang] }));

  const setItems = (next: string[]) => setCompare({ items: next });
  const remove = (key: string) => setItems(items.filter((k) => k !== key));

  // gemeinsame Tage und Werte je Produkt
  const col = metric === "items" ? "items" : `${region}_${metric}` as const;
  const allDays = useMemo(() => [...new Set(variants.flatMap((x) => x.v?.series.days ?? []))].sort(), [variants]);
  const lastDay = allDays.at(-1) ?? "";
  const firstDay = allDays[0] ?? "";
  const refKey = refPick && items.includes(refPick) ? refPick : items[0];
  const refIndex = Math.max(0, items.indexOf(refKey));
  const eff = resolveCustom(custom, lastDay);
  const from = range === "all" ? firstDay : range === "custom" ? eff.from : shiftDay(lastDay, -Number(range));
  const to = range === "custom" ? eff.to : lastDay;
  const rows = useMemo(() => {
    const maps = variants.map((x) => {
      const m = new Map<string, number>();
      const s = x.v?.series;
      if (s) s.days.forEach((d, i) => { const val = (s[col] as (number | null)[])[i]; if (val !== null && val !== undefined) m.set(d, val); });
      return m;
    });
    const days = allDays.filter((d) => d >= from && d <= to);
    const base = maps.map((m) => { const d = days.find((x) => m.has(x)); return d ? m.get(d)! : null; });
    const refMap = maps[refIndex];
    // Relative: Preis in % des Bezugsprodukts am selben Tag; Veränderung in Punkten seit dem ersten Tag im Zeitraum
    const ratio = (m: Map<string, number>, d: string) => {
      const a = m.get(d), b = refMap?.get(d);
      return a !== undefined && b ? (a / b) * 100 : null;
    };
    const relBase = maps.map((m) => { const d = days.find((x) => ratio(m, x) !== null); return d ? ratio(m, d) : null; });
    return days.map((day) => {
      const r: Record<string, number | string | null> = { day };
      maps.forEach((m, i) => {
        const val = m.get(day) ?? null;
        r[`raw${i}`] = val;
        if (view === "rel") {
          const q = ratio(m, day);
          r[`k${i}`] = q;
          r[`d${i}`] = q !== null && relBase[i] !== null ? q - relBase[i]! : null;
        } else {
          r[`k${i}`] = val === null ? null : view === "pct" ? (base[i] ? (val / base[i]! - 1) * 100 : null) : val;
        }
      });
      return r;
    });
  }, [variants, col, allDays, from, to, view, refIndex]);
  const longRange = rows.length > 1 && Date.parse(String(rows.at(-1)!.day)) - Date.parse(String(rows[0].day)) > 120 * 86_400_000;
  const fmtVal = (v: number | null) => (v === null ? "–" : metric === "items" ? count(v) : money(v));

  // Tabelle
  const table = useMemo(() => {
    const list = variants.map((x, i) => {
      const s = x.v?.series;
      const vals = s ? (s[`${region}_incl`] as (number | null)[]) : [];
      const ext = s ? rangeOf(points(s.days, vals), s.days.at(-1) ?? "") : null;
      return {
        ...x, i,
        name: x.p?.name ?? `#${x.it.id}`,
        price: x.v?.price?.[region]?.incl ?? null,
        c7: x.v?.change?.["7d"]?.[region] ?? null,
        c30: x.v?.change?.["30d"]?.[region] ?? null,
        c1y: x.v?.change?.["1y"]?.[region] ?? null,
        ath: ext?.high ?? null, atl: ext?.low ?? null,
        conf: confidence(x.v, region),
        own: owned.total.get(ownedKey(x.it.game, x.it.id, x.it.lang)) ?? 0,
      };
    });
    if (sort.key === "order") return sort.dir === 1 ? list : [...list].reverse();
    const val = (r: (typeof list)[number]) => ({
      name: r.name.toLowerCase(), price: r.price, "7d": r.c7, "30d": r.c30, "1y": r.c1y, items: r.v?.items ?? null,
    } as Record<string, string | number | null>)[sort.key];
    return [...list].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      return (typeof x === "string" ? x.localeCompare(y as string) : x - (y as number)) * sort.dir;
    });
  }, [variants, region, owned, sort]);
  const onSort = (k: typeof sort.key) => setSort((s) => nextSort(s, k, ["order", "name"]));

  const saveCurrent = (name: string) => {
    const clean = name.trim().slice(0, 60);
    if (!clean || !items.length) return;
    setCompare({ saved: [{ name: clean, items }, ...compare.saved.filter((s) => s.name !== clean)] });
    setSaving(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="display text-4xl">Compare</h1>
        <p className="max-w-2xl text-sm text-slate">
          Put up to {COMPARE_MAX} products on top of each other – also across games and languages. &ldquo;Change %&rdquo; starts
          every line at 0 % so products at different price levels compare fairly.
        </p>
      </div>

      {/* gespeicherte Vergleiche */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-20 shrink-0 text-sm text-slate">Saved</span>
        {compare.saved.length === 0 && <span className="text-sm text-slate">No saved comparisons yet.</span>}
        {compare.saved.map((s) => {
          const active = s.items.join(",") === items.join(",");
          return (
            <span key={s.name} className={`inline-flex items-center rounded-[var(--radius-control)] text-sm ring-1 ${active ? "bg-ink text-white ring-ink" : "ring-line"}`}>
              <button type="button" onClick={() => { setItems(s.items); setHidden(new Set()); }} className="py-1.5 pl-3.5 pr-1.5">
                {s.name} <span className={`num text-xs ${active ? "text-white/70" : "text-slate"}`}>{s.items.length}</span>
              </button>
              <button type="button" onClick={() => setDeleting(s.name)} aria-label={`Delete saved comparison ${s.name}`}
                className={`mr-1 grid h-6 w-6 place-items-center rounded-full ${active ? "text-white/70 hover:bg-white/15" : "text-slate hover:text-down"}`}>×</button>
            </span>
          );
        })}
        {items.length > 0 && (saving === null ? (
          <button type="button" onClick={() => setSaving("")}
            className="rounded-[var(--radius-control)] px-3.5 py-1.5 text-sm font-semibold text-cobalt ring-1 ring-line hover:ring-cobalt">
            + Save this comparison
          </button>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); saveCurrent(saving); }} className="flex items-center gap-2">
            <input autoFocus value={saving} onChange={(e) => setSaving(e.target.value)} placeholder="Name, e.g. Displays EN vs JP"
              maxLength={60} aria-label="Name of the comparison"
              className="h-9 w-64 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm outline-none focus:border-cobalt" />
            <button type="submit" className="h-9 rounded-[var(--radius-control)] bg-ink px-4 text-sm font-semibold text-white hover:bg-cobalt">Save</button>
            <button type="button" onClick={() => setSaving(null)} className="text-sm text-slate hover:text-ink">Cancel</button>
          </form>
        ))}
      </div>
      {enabled && !user && compare.saved.length > 0 && (
        <p className="-mt-4 text-xs text-slate">Saved in this browser. <Link href="/login?next=/compare" className="text-cobalt hover:underline">Sign in</Link> to have them on all devices.</p>
      )}

      <Search items={items} onAdd={(k) => setItems([...items, k])} onAddMany={(ks) => setItems([...items, ...ks])} />

      {items.length === 0 ? (
        <section className="rounded-[var(--radius-panel)] bg-surface p-6 ring-1 ring-line">
          <p className="font-semibold">Nothing to compare yet.</p>
          <p className="mt-1 text-sm text-slate">Search above, or press <strong>Compare</strong> on a product page or on your watchlist.</p>
        </section>
      ) : (
        <>
          {/* Legende: Klick blendet aus/ein */}
          <ul className="flex flex-wrap gap-2">
            {variants.map((x) => {
              const off = hidden.has(x.it.key);
              return (
                <li key={x.it.key} className={`flex max-w-full items-center gap-2 rounded-lg py-1.5 pl-2 pr-1 ring-1 ring-line ${off ? "opacity-50" : ""}`}>
                  <button type="button" aria-pressed={!off} title={off ? "Show line" : "Hide line"}
                    onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(x.it.key)) n.delete(x.it.key); else n.add(x.it.key); return n; })}
                    className="flex min-w-0 items-center gap-2">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: x.color }} aria-hidden />
                    <Thumb src={x.p?.image ?? null} category={x.p?.category} size={28} />
                    <span className="max-w-[150px] truncate text-sm font-medium sm:max-w-[220px]">{x.p?.name ?? "Loading…"}</span>
                    <LangBadge lang={x.it.lang} />
                  </button>
                  <button type="button" onClick={() => remove(x.it.key)} aria-label={`Remove ${x.p?.name ?? x.it.key}`}
                    className="grid h-6 w-6 place-items-center rounded-full text-slate hover:text-down">×</button>
                </li>
              );
            })}
          </ul>

          <section className="rounded-[var(--radius-panel)] bg-surface p-5 ring-1 ring-line">
            <div className="flex flex-wrap items-center gap-2">
              <Segmented label="View" value={view} onChange={setView}
                options={[{ value: "pct", label: "Change %" }, { value: "eur", label: metric === "items" ? "Count" : "Price €" },
                  ...(items.length > 1 ? [{ value: "rel" as const, label: "Relative" }] : [])]} />
              {view === "rel" && items.length > 1 && (
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-slate">to</span>
                  <select value={refKey} onChange={(e) => setRefPick(e.target.value)} aria-label="Reference product"
                    className="h-9 max-w-[260px] rounded-[var(--radius-control)] border border-line bg-surface px-2">
                    {variants.map((x) => <option key={x.it.key} value={x.it.key}>{x.p?.name ?? x.it.key} {LANG_SHORT[x.it.lang]}</option>)}
                  </select>
                </label>
              )}
              <Segmented label="Value" value={metric} onChange={setMetric}
                options={[{ value: "incl", label: "Incl. shipping" }, { value: "excl", label: "Item only" }, { value: "items", label: "Items listed" }]} />
              <span className="ml-auto"><Segmented label="Time range" value={range} onChange={setRange} options={RANGES} /></span>
            </div>
            {range === "custom" && <CustomRange value={custom} onChange={setCustom} first={firstDay} last={lastDay} />}
            {rows.length < 2 ? (
              <p className="grid h-80 place-items-center text-slate">{variants.some((x) => !x.p) ? "Loading…" : "Not enough days in this range yet."}</p>
            ) : (
              <div className="mt-4 h-96">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke="#e3e8ed" />
                    <XAxis dataKey="day" tickFormatter={longRange ? tickMonth : tickDay} tickLine={false} axisLine={false} minTickGap={48}
                      tick={{ fill: "#5b6772", fontSize: 12 }} />
                    <YAxis tickLine={false} axisLine={false} width={64} domain={["auto", "auto"]} tick={{ fill: "#5b6772", fontSize: 12 }}
                      tickFormatter={(v: number) => (view !== "eur" ? `${v.toFixed(0)} %` : metric === "items" ? count(v) : `€${Math.round(v).toLocaleString("en-GB")}`)} />
                    {view === "pct" && <ReferenceLine y={0} stroke="#c9d3dc" />}
                    {view === "rel" && <ReferenceLine y={100} stroke="#c9d3dc" />}
                    <Tooltip cursor={{ stroke: "#9aa6b1", strokeDasharray: "3 3" }} content={({ active, payload }) => {
                      const r = active ? (payload?.[0]?.payload as Record<string, number | string | null> | undefined) : undefined;
                      if (!r) return null;
                      return (
                        <div className="rounded-[10px] border border-line bg-surface px-3 py-2 text-sm shadow-[0_8px_24px_-12px_rgba(23,33,43,0.3)]">
                          <p className="mb-1 font-semibold">{fmtDay(String(r.day))}</p>
                          {variants.filter((x) => !hidden.has(x.it.key)).map((x, j) => {
                            const i = variants.indexOf(x);
                            return (
                              <p key={x.it.key + j} className="flex items-center justify-between gap-6">
                                <span className="flex min-w-0 items-center gap-2">
                                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: x.color }} aria-hidden />
                                  <span className="max-w-[200px] truncate text-slate">{x.p?.name} {LANG_SHORT[x.it.lang]}</span>
                                </span>
                                <span className="num font-semibold">
                                  {fmtVal(r[`raw${i}`] as number | null)}
                                  {view === "pct" && <span className={`ml-2 text-xs ${trendClass(r[`k${i}`] as number | null)}`}>{signedPct(r[`k${i}`] as number | null)}</span>}
                                  {view === "rel" && i !== refIndex && (
                                    <span className="ml-2 text-xs">
                                      {r[`k${i}`] === null ? "–" : `${(r[`k${i}`] as number).toFixed(0)} %`}
                                      {r[`d${i}`] !== null && <span className={`ml-1 ${trendClass(r[`d${i}`] as number)}`}>({ptsText(r[`d${i}`] as number)})</span>}
                                    </span>
                                  )}
                                </span>
                              </p>
                            );
                          })}
                        </div>
                      );
                    }} />
                    {variants.map((x, i) => !hidden.has(x.it.key) && (
                      <Line key={x.it.key} type="monotone" dataKey={`k${i}`} stroke={x.color} strokeWidth={2.25} dot={false}
                        isAnimationActive={false} connectNulls />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            <p className="mt-2 text-xs text-slate">
              {metric === "items" ? "Items listed on Cardmarket." : `Fair price ${metric === "incl" ? "incl. shipping" : "item only"}, ${region === "eu" ? "EU sellers" : "all countries"}.`}
              {view === "pct" && " Change % = compared with each product's first day in the range (0 %)."}
              {view === "rel" && ` Relative = ${metric === "items" ? "items listed" : "price"} as % of the reference product on the same day; in brackets the change in percentage points since the start of the range.`} Click a product above to hide its line.
            </p>
          </section>

          <section aria-labelledby="cmp-table">
            <h2 id="cmp-table" className="sr-only">Comparison table</h2>
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="text-left text-slate">
                  <tr className="border-b border-line">
                    <SortTh id="name" label="Product" sort={sort} onSort={onSort} />
                    <SortTh id="price" label="Fair price" sort={sort} onSort={onSort} right />
                    <SortTh id="7d" label="7D" sort={sort} onSort={onSort} right />
                    <SortTh id="30d" label="30D" sort={sort} onSort={onSort} right />
                    <SortTh id="1y" label="1Y" sort={sort} onSort={onSort} right />
                    <th className="py-2 text-right font-normal">All-time high</th>
                    <th className="py-2 text-right font-normal">All-time low</th>
                    <SortTh id="items" label="Items" sort={sort} onSort={onSort} right />
                    {view === "rel" && <th className="py-2 text-right font-normal">vs. reference</th>}
                    {user && <th className="py-2 text-right font-normal">Owned</th>}
                    <th className="py-2"><span className="sr-only">Remove</span></th>
                  </tr>
                </thead>
                <tbody>
                  {table.map((r) => {
                    const g = gameOf(r.it.game);
                    return (
                      <tr key={r.it.key} className="border-b border-line">
                        <td className="py-2 pr-3">
                          <Link href={g ? `${gameHref(g, `/product/${r.it.id}`)}?lang=${r.it.lang}` : "#"} className="flex min-w-0 items-center gap-3 hover:text-cobalt">
                            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: r.color }} aria-hidden />
                            <Thumb src={r.p?.image ?? null} category={r.p?.category} size={36} />
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{r.name}</span>
                              <span className="flex items-center gap-2 text-xs text-slate"><LangBadge lang={r.it.lang} /> {g?.name}</span>
                            </span>
                          </Link>
                        </td>
                        <td className="num py-2 text-right font-semibold whitespace-nowrap">
                          {r.v?.status === "ok" && <span className="mr-2 align-middle"><ReliabilityBadge level={r.conf.level} small /></span>}
                          {money(r.price)}
                        </td>
                        {[r.c7, r.c30, r.c1y].map((c, j) => <td key={j} className={`num py-2 text-right ${trendClass(c)}`}>{pct(c)}</td>)}
                        <td className="num py-2 text-right">{r.ath ? <>{money(r.ath.value)}<span className="block text-xs text-slate">{fmtDay(r.ath.day)}</span></> : "–"}</td>
                        <td className="num py-2 text-right">{r.atl ? <>{money(r.atl.value)}<span className="block text-xs text-slate">{fmtDay(r.atl.day)}</span></> : "–"}</td>
                        <td className="num py-2 text-right">{count(r.v?.items)}</td>
                        {view === "rel" && (
                          <td className="num py-2 text-right">
                            {r.i === refIndex ? <span className="text-xs text-slate">reference</span> : (() => {
                              const last = [...rows].reverse().find((x) => x[`k${r.i}`] !== null);
                              if (!last) return "–";
                              const d = last[`d${r.i}`] as number | null;
                              return <>{(last[`k${r.i}`] as number).toFixed(0)} %{d !== null && <span className={`block text-xs ${trendClass(d)}`}>{ptsText(d)}</span>}</>;
                            })()}
                          </td>
                        )}
                        {user && <td className="num py-2 text-right font-semibold">{r.own || ""}</td>}
                        <td className="py-2 pl-3 text-right">
                          <button type="button" onClick={() => remove(r.it.key)} aria-label={`Remove ${r.name}`}
                            className="grid h-8 w-8 place-items-center rounded-full text-lg leading-none text-slate ring-1 ring-line hover:text-down hover:ring-down">×</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate">Prices incl. shipping, {region === "eu" ? "EU sellers" : "all countries"}. All-time high/low from the tracked history.</p>
          </section>
        </>
      )}

      {deleting && (
        <HoldConfirm title="Delete saved comparison" action="Hold to delete" onClose={() => setDeleting(null)}
          text={<>&ldquo;{deleting}&rdquo; is removed from your saved comparisons. The products themselves stay where they are.</>}
          onConfirm={async () => setCompare({ saved: compare.saved.filter((s) => s.name !== deleting) })} />
      )}
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<p className="py-10 text-slate">Loading…</p>}>
      <Compare />
    </Suspense>
  );
}

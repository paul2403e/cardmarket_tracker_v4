"use client";

// Alle Produkte × Sprachen mit Filtern und Sortierung. Filter stehen in der Adresse (teilbar, Zurück-Taste).
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Thumb, shortCategory } from "@/components/ProductRow";
import { matches } from "@/components/Search";
import { Segmented } from "@/components/Segmented";
import { useCatalog } from "@/lib/data";
import { LangBadge } from "@/components/LangBadge";
import { AddButton } from "@/components/portfolio/AddButton";
import { WatchToggle } from "@/components/watch/WatchButton";
import { count, money, pct, trendClass } from "@/lib/format";
import { changeOf, priceOf, variants, type Variant } from "@/lib/market";
import { langOptions } from "@/components/home/ListBox";
import { gameHref, useGame } from "@/lib/games";
import { useSettings } from "@/lib/settings";
import type { Lang } from "@/lib/types";

type Sort = "name" | "price" | "1d" | "7d" | "30d" | "1y" | "items" | "added";
type Dir = "asc" | "desc";
const SORTS: { value: Sort; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "7d", label: "Change 7 days" },
  { value: "1d", label: "Change 1 day" },
  { value: "30d", label: "Change 30 days" },
  { value: "1y", label: "Change 1 year" },
  { value: "price", label: "Price" },
  { value: "items", label: "Items listed" },
  { value: "added", label: "Newest" },
];
const PAGE = 60;

function BrowseInner() {
  const game = useGame();
  const params = useSearchParams();
  const router = useRouter();
  const { data: catalog } = useCatalog();
  const { region } = useSettings();
  const [limit, setLimit] = useState(PAGE);

  const q = params.get("q") ?? "";
  const category = params.get("category") ?? "all";
  const lang = (params.get("lang") ?? "all") as Lang | "all";
  const sort = (params.get("sort") ?? "name") as Sort;
  // Standardrichtung: Name A→Z, alles andere absteigend (größte Veränderung, höchster Preis, neueste zuerst)
  const defaultDir: Dir = sort === "name" ? "asc" : "desc";
  const dir = (params.get("dir") === "asc" || params.get("dir") === "desc" ? params.get("dir") : defaultDir) as Dir;
  const withOffers = params.get("offers") !== "all";

  function set(key: string, value: string | null, also: Record<string, string | null> = {}) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries({ [key]: value, ...also })) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    router.replace(`${gameHref(game, "/browse")}?${next.toString()}`, { scroll: false });
    setLimit(PAGE);
  }

  const categories = useMemo(() => {
    const seen = new Map<string, string>();
    catalog?.products.forEach((p) => p.categoryId && seen.set(String(p.categoryId), p.category ?? ""));
    return [...seen.entries()];
  }, [catalog]);

  const list = useMemo(() => {
    const rows = variants(catalog, lang).filter(
      ({ product, v }) =>
        (category === "all" || String(product.categoryId) === category) &&
        (!q || matches(product, q)) &&
        (!withOffers || v.status === "ok"),
    );
    const key = (x: Variant): number | string | null => {
      switch (sort) {
        case "name": return x.product.name ?? "";
        case "price": return priceOf(x.v, region, true);
        case "items": return x.v.items;
        case "added": return x.product.added ?? "";
        default: return changeOf(x.v, sort, region);
      }
    };
    const sign = dir === "asc" ? 1 : -1;
    return rows.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      if (ka === null || ka === "") return kb === null || kb === "" ? 0 : 1; // ohne Wert immer ans Ende
      if (kb === null || kb === "") return -1;
      const c = typeof ka === "string" ? ka.localeCompare(kb as string) : ka - (kb as number);
      return sign * c;
    });
  }, [catalog, lang, category, q, withOffers, sort, dir, region]);

  return (
    <div>
      <h1 className="display text-3xl sm:text-4xl">{q ? `Results for “${q}”` : "All products"}</h1>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <input
          type="search"
          defaultValue={q}
          onChange={(e) => set("q", e.target.value.trim())}
          placeholder="Filter by name or ID"
          aria-label="Filter by name or ID"
          className="h-9 w-56 rounded-[var(--radius-control)] border border-line bg-surface px-4 text-sm outline-none focus:border-cobalt"
        />
        <select
          value={category}
          onChange={(e) => set("category", e.target.value === "all" ? null : e.target.value)}
          aria-label="Category"
          className="h-9 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm"
        >
          <option value="all">All types</option>
          {categories.map(([id, name]) => (
            <option key={id} value={id}>{shortCategory(name)}</option>
          ))}
        </select>
        <Segmented label="Language" value={lang} options={langOptions(game)} onChange={(v) => set("lang", v === "all" ? null : v)} />
        <select
          value={sort}
          onChange={(e) => set("sort", e.target.value === "name" ? null : e.target.value, { dir: null })}
          aria-label="Sort by"
          className="h-9 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>Sort: {s.label}</option>
          ))}
        </select>
        <button type="button" onClick={() => set("dir", dir === defaultDir ? (dir === "asc" ? "desc" : "asc") : null)}
          aria-label={dir === "asc" ? "Ascending – switch to descending" : "Descending – switch to ascending"}
          title={dir === "asc" ? "Ascending" : "Descending"}
          className="flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm hover:border-ink">
          <span aria-hidden className="text-base leading-none">{dir === "asc" ? "↑" : "↓"}</span>
          {sort === "name" ? (dir === "asc" ? "A–Z" : "Z–A") : sort === "added" ? (dir === "asc" ? "Oldest" : "Newest") : (dir === "asc" ? "Low–high" : "High–low")}
        </button>
        <label className="flex items-center gap-2 text-sm text-slate">
          <input type="checkbox" checked={!withOffers} onChange={(e) => set("offers", e.target.checked ? "all" : null)} className="accent-cobalt" />
          Include products without offers today
        </label>
      </div>

      <p className="mt-4 text-sm text-slate">{count(list.length)} results</p>

      <div className="relative mt-2 overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-slate">
            <tr className="border-b border-line">
              <th className="py-2 font-normal">Product</th>
              <th className="py-2 text-right font-normal">Fair price</th>
              <th className="py-2 text-right font-normal">Items</th>
              <th className="py-2 text-right font-normal">1D</th>
              <th className="py-2 text-right font-normal">7D</th>
              <th className="py-2 text-right font-normal">30D</th>
              <th className="py-2 text-right font-normal">1Y</th>
              <th className="py-2"><span className="sr-only">Watch and add to portfolio</span></th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, limit).map(({ product: p, lang: l, v }) => (
              <tr key={`${p.id}-${l}`} className="border-b border-line hover:bg-surface">
                <td className="py-2 pr-3">
                  <Link href={`${gameHref(game, `/product/${p.id}`)}?lang=${l}`} className="flex items-center gap-3">
                    <Thumb src={p.image} name={p.name} category={p.category} size={40} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="flex gap-2 text-xs text-slate">
                        <LangBadge lang={l} />
                        <span>{shortCategory(p.category)}</span>
                        <span className="num">#{p.id}</span>
                      </span>
                    </span>
                  </Link>
                </td>
                <td className="num py-2 text-right font-semibold">{money(priceOf(v, region, true))}</td>
                <td className="num py-2 text-right">{count(v.items)}</td>
                {(["1d", "7d", "30d", "1y"] as const).map((per) => (
                  <td key={per} className={`num py-2 text-right ${trendClass(changeOf(v, per, region))}`}>{pct(changeOf(v, per, region))}</td>
                ))}
                <td className="py-2 pl-4">
                  <span className="flex justify-end gap-1.5">
                    <WatchToggle game={game.key} productId={p.id} language={l} />
                    <AddButton game={game.key} productId={p.id} language={l} compact />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.length > limit && (
        <button type="button" onClick={() => setLimit((n) => n + PAGE)}
          className="mt-6 rounded-[var(--radius-control)] bg-ink px-5 py-2 text-sm text-white">
          Show {Math.min(PAGE, list.length - limit)} more
        </button>
      )}
      {catalog && list.length === 0 && (
        <p className="py-10 text-slate">No product matches these filters. Remove a filter or search for something else.</p>
      )}
    </div>
  );
}

export default function Browse() {
  return (
    <Suspense>
      <BrowseInner />
    </Suspense>
  );
}

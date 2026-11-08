"use client";

// Alle Produkte × Sprachen mit Filtern und Sortierung. Filter stehen in der Adresse (teilbar, Zurück-Taste).
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Thumb, shortCategory } from "@/components/ProductRow";
import { matches } from "@/components/Search";
import { Segmented } from "@/components/Segmented";
import { useCatalog, useSpark } from "@/lib/data";
import { LANG_SHORT, count, money, pct, trendClass } from "@/lib/format";
import { changeOf, priceOf, variants, type Variant } from "@/lib/market";
import { useSettings } from "@/lib/settings";
import type { Lang } from "@/lib/types";

type Sort = "name" | "price" | "1d" | "7d" | "30d" | "items" | "added";
const SORTS: { value: Sort; label: string }[] = [
  { value: "7d", label: "Change 7 days" },
  { value: "1d", label: "Change 1 day" },
  { value: "30d", label: "Change 30 days" },
  { value: "price", label: "Price" },
  { value: "items", label: "Items listed" },
  { value: "added", label: "Newest" },
  { value: "name", label: "Name" },
];
const LANG_OPTIONS: { value: Lang | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "en", label: "EN" },
  { value: "de", label: "DE" },
  { value: "ja", label: "JP" },
];
const PAGE = 60;

function Sparkline({ values }: { values: (number | null)[] | undefined }) {
  const pts = (values ?? []).map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] !== null);
  if (pts.length < 2) return <span className="inline-block h-6 w-20" aria-hidden />;
  const ys = pts.map((p) => p[1]);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const n = (values?.length ?? 1) - 1 || 1;
  const d = pts.map(([i, y]) => `${(i / n) * 80},${hi === lo ? 12 : 22 - ((y - lo) / (hi - lo)) * 20}`).join(" ");
  const up = pts.at(-1)![1] >= pts[0][1];
  return (
    <svg width="80" height="24" viewBox="0 0 80 24" aria-hidden className="inline-block">
      <polyline points={d} fill="none" stroke={up ? "var(--color-up)" : "var(--color-down)"} strokeWidth="1.5" />
    </svg>
  );
}

function BrowseInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { data: catalog } = useCatalog();
  const { data: spark } = useSpark();
  const { region, inclShipping } = useSettings();
  const [limit, setLimit] = useState(PAGE);

  const q = params.get("q") ?? "";
  const category = params.get("category") ?? "all";
  const lang = (params.get("lang") ?? "all") as Lang | "all";
  const sort = (params.get("sort") ?? "7d") as Sort;
  const withOffers = params.get("offers") !== "all";

  function set(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    router.replace(`/browse?${next.toString()}`, { scroll: false });
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
        case "price": return priceOf(x.v, region, inclShipping);
        case "items": return x.v.items;
        case "added": return x.product.added ?? "";
        default: return changeOf(x.v, sort, region);
      }
    };
    return rows.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      if (ka === null) return 1; // ohne Wert immer ans Ende
      if (kb === null) return -1;
      if (typeof ka === "string") return sort === "name" ? ka.localeCompare(kb as string) : (kb as string).localeCompare(ka);
      return (kb as number) - (ka as number);
    });
  }, [catalog, lang, category, q, withOffers, sort, region, inclShipping]);

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
        <Segmented label="Language" value={lang} options={LANG_OPTIONS} onChange={(v) => set("lang", v === "all" ? null : v)} />
        <select
          value={sort}
          onChange={(e) => set("sort", e.target.value)}
          aria-label="Sort by"
          className="h-9 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>Sort: {s.label}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate">
          <input type="checkbox" checked={!withOffers} onChange={(e) => set("offers", e.target.checked ? "all" : null)} className="accent-cobalt" />
          Include products without offers today
        </label>
      </div>

      <p className="mt-4 text-sm text-slate">{count(list.length)} results</p>

      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-slate">
            <tr className="border-b border-line">
              <th className="py-2 font-normal">Product</th>
              <th className="py-2 text-right font-normal">Fair price</th>
              <th className="py-2 text-right font-normal">1 day</th>
              <th className="py-2 text-right font-normal">7 days</th>
              <th className="py-2 text-right font-normal">30 days</th>
              <th className="py-2 text-right font-normal">Items</th>
              <th className="py-2 pl-4 font-normal">30 days</th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, limit).map(({ product: p, lang: l, v }) => (
              <tr key={`${p.id}-${l}`} className="border-b border-line hover:bg-surface">
                <td className="py-2 pr-3">
                  <Link href={`/product/${p.id}?lang=${l}`} className="flex items-center gap-3">
                    <Thumb src={p.image} name={p.name} size={40} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="flex gap-2 text-xs text-slate">
                        <span className="rounded bg-paper px-1.5 font-semibold text-ink ring-1 ring-line">{LANG_SHORT[l]}</span>
                        <span>{shortCategory(p.category)}</span>
                        <span className="num">#{p.id}</span>
                      </span>
                    </span>
                  </Link>
                </td>
                <td className="num py-2 text-right font-semibold">{money(priceOf(v, region, inclShipping))}</td>
                {(["1d", "7d", "30d"] as const).map((per) => (
                  <td key={per} className={`num py-2 text-right ${trendClass(changeOf(v, per, region))}`}>{pct(changeOf(v, per, region))}</td>
                ))}
                <td className="num py-2 text-right">{count(v.items)}</td>
                <td className="py-2 pl-4"><Sparkline values={spark?.[region][`${p.id}:${l}`]} /></td>
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

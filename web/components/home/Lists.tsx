"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ProductRow, shortCategory } from "@/components/ProductRow";
import { useCatalog, useMarketIndex } from "@/lib/data";
import { count, money, pct, trendClass } from "@/lib/format";
import { gameHref, useGame } from "@/lib/games";
import { LIST_SIZES, lowestPrice, newest } from "@/lib/market";
import { ListBox } from "./ListBox";
import { useSettings } from "@/lib/settings";

export function NewProducts() {
  const { data: catalog } = useCatalog();
  const { region, lists, setNewSize } = useSettings();
  const list = useMemo(() => newest(catalog, lists.newSize), [catalog, lists.newSize]);
  return (
    <section aria-labelledby="new-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="new-title" className="display text-2xl">New on Cardmarket</h2>
        <label className="flex items-center gap-2 text-sm text-slate">
          Show
          <select value={lists.newSize} onChange={(e) => setNewSize(Number(e.target.value))}
            className="h-[34px] rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm text-ink">
            {LIST_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <p className="mt-1 mb-4 text-sm text-slate">Most recently added products that already have offers.</p>
      <ListBox title="Newest first" count={list.length} empty="No new products yet.">
        {list.map((p) => (
          <ProductRow key={p.id} id={p.id} name={p.name} image={p.image} category={p.category}
            value={money(lowestPrice(p, region, true))}
            note={p.added ? `added ${new Date(p.added).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : undefined} />
        ))}
      </ListBox>
    </section>
  );
}

export function Categories() {
  const game = useGame();
  const { data: catalog } = useCatalog();
  const { data: index } = useMarketIndex();
  const { region } = useSettings();
  const tiles = useMemo(() => {
    if (!index) return [];
    return Object.entries(index.categories).map(([id, name]) => {
      const series = (index[region][id] ?? []) as number[];
      const last = series.at(-1);
      const weekAgo = series.length > 7 ? series.at(-8) : undefined;
      const change = last !== undefined && weekAgo ? (last / weekAgo - 1) * 100 : null;
      const products = catalog?.products.filter((p) => String(p.categoryId) === id && p.active).length ?? 0;
      return { id, name: shortCategory(name), change, products };
    });
  }, [index, catalog, region]);

  return (
    <section aria-labelledby="cat-title">
      <h2 id="cat-title" className="display text-2xl">Browse by type</h2>
      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <li key={t.id}>
            <Link href={gameHref(game, `/browse?category=${t.id}`)}
              className="block rounded-[var(--radius-panel)] bg-surface p-4 ring-1 ring-line hover:ring-cobalt">
              <span className="block font-semibold">{t.name}</span>
              <span className="mt-3 flex items-baseline justify-between">
                <span className="num text-sm text-slate">{count(t.products)} products</span>
                <span className={`num text-sm font-semibold ${trendClass(t.change)}`} title="Index change over 7 days">
                  {pct(t.change)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

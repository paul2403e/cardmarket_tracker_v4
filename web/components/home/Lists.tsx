"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ProductRow, shortCategory } from "@/components/ProductRow";
import { useCatalog, useMarketIndex } from "@/lib/data";
import { count, money, pct, trendClass } from "@/lib/format";
import { lowestPrice, newest, stockDrops, variants } from "@/lib/market";
import { useSettings } from "@/lib/settings";

export function StockDrops() {
  const { data: catalog } = useCatalog();
  const list = useMemo(() => stockDrops(variants(catalog)), [catalog]);
  return (
    <section aria-labelledby="stock-title">
      <h2 id="stock-title" className="display text-2xl">Supply shrinking</h2>
      <p className="mt-1 text-sm text-slate">Biggest drop in listed items over 7 days. Less supply often comes before higher prices.</p>
      {list.length ? (
        <ul className="mt-3">
          {list.map(({ product, lang, v }) => (
            <ProductRow key={`${product.id}-${lang}`} id={product.id} name={product.name} image={product.image}
              category={product.category} lang={lang} value={`${count(v.items)} left`} change={v.change["7d"].items} />
          ))}
        </ul>
      ) : (
        <p className="py-6 text-sm text-slate">No product lost more than 10% of its supply this week.</p>
      )}
    </section>
  );
}

export function NewProducts() {
  const { data: catalog } = useCatalog();
  const { region, inclShipping } = useSettings();
  const list = useMemo(() => newest(catalog), [catalog]);
  return (
    <section aria-labelledby="new-title">
      <h2 id="new-title" className="display text-2xl">New on Cardmarket</h2>
      <p className="mt-1 text-sm text-slate">Most recently added products that already have offers.</p>
      <ul className="mt-3">
        {list.map((p) => (
          <ProductRow key={p.id} id={p.id} name={p.name} image={p.image} category={p.category}
            value={money(lowestPrice(p, region, inclShipping))}
            note={p.added ? `added ${new Date(p.added).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : undefined} />
        ))}
      </ul>
    </section>
  );
}

export function Categories() {
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
            <Link href={`/browse?category=${t.id}`}
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

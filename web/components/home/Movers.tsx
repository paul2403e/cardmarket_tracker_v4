"use client";

import { useMemo, useState } from "react";
import { ProductRow } from "@/components/ProductRow";
import { Segmented } from "@/components/Segmented";
import { useCatalog } from "@/lib/data";
import { money } from "@/lib/format";
import { MOVER_MIN_ITEMS, MOVER_MIN_PRICE, changeOf, movers, priceOf, variants } from "@/lib/market";
import { useSettings } from "@/lib/settings";
import type { Lang, Period } from "@/lib/types";

const PERIODS: { value: Period; label: string }[] = [
  { value: "1d", label: "1D" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
];
const LANG_OPTIONS: { value: Lang | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "en", label: "EN" },
  { value: "de", label: "DE" },
  { value: "ja", label: "JP" },
];

export function Movers() {
  const { data: catalog } = useCatalog();
  const { region, inclShipping } = useSettings();
  const [period, setPeriod] = useState<Period>("1d");
  const [lang, setLang] = useState<Lang | "all">("all");
  const { gainers, losers } = useMemo(
    () => movers(variants(catalog, lang), period, region, inclShipping),
    [catalog, lang, period, region, inclShipping],
  );

  const column = (title: string, list: typeof gainers) => (
    <div>
      <h3 className="mb-2 font-semibold">{title}</h3>
      {list.length ? (
        <ul>
          {list.map(({ product, lang: l, v }) => (
            <ProductRow key={`${product.id}-${l}`} id={product.id} name={product.name} image={product.image}
              category={product.category} lang={l} value={money(priceOf(v, region, inclShipping))}
              change={changeOf(v, period, region)} />
          ))}
        </ul>
      ) : (
        <p className="py-6 text-sm text-slate">
          No product moved this way yet. Changes appear once a price exists at the start and the end of the period.
        </p>
      )}
    </div>
  );

  return (
    <section aria-labelledby="movers-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="movers-title" className="display text-2xl">Top movers</h2>
        <div className="flex flex-wrap gap-2">
          <Segmented label="Period" value={period} options={PERIODS} onChange={setPeriod} />
          <Segmented label="Language" value={lang} options={LANG_OPTIONS} onChange={setLang} />
        </div>
      </div>
      <p className="mt-1 text-sm text-slate">
        Fair price incl. shipping. Only products with at least {MOVER_MIN_ITEMS} listed and a price of €{MOVER_MIN_PRICE} or more.
      </p>
      <div className="mt-4 grid gap-8 md:grid-cols-2">
        {column("Rising", gainers)}
        {column("Falling", losers)}
      </div>
    </section>
  );
}

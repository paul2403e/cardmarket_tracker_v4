"use client";

import { useMemo, useState } from "react";
import { ProductRow } from "@/components/ProductRow";
import { Segmented } from "@/components/Segmented";
import { useCatalog } from "@/lib/data";
import { count, money } from "@/lib/format";
import { MOVER_MIN_ITEMS, MOVER_MIN_PRICE, changeOf, itemsAtStart, movers, priceOf, supplyMovers, variants } from "@/lib/market";
import { useSettings } from "@/lib/settings";
import type { Lang, Period } from "@/lib/types";
import { LANG_OPTIONS, ListBox, PERIODS } from "./ListBox";

function useControls() {
  const [period, setPeriod] = useState<Period>("1d");
  const [lang, setLang] = useState<Lang | "all">("all");
  const controls = (
    <div className="flex flex-wrap gap-2">
      <Segmented label="Period" value={period} options={PERIODS} onChange={setPeriod} />
      <Segmented label="Language" value={lang} options={LANG_OPTIONS} onChange={setLang} />
    </div>
  );
  return { period, lang, controls };
}

const RULE = `Only products with at least ${MOVER_MIN_ITEMS} items listed and a price of €${MOVER_MIN_PRICE} or more.`;

export function Movers() {
  const { data: catalog } = useCatalog();
  const { region } = useSettings();
  const { period, lang, controls } = useControls();
  const { gainers, losers } = useMemo(
    () => movers(variants(catalog, lang), period, region, true),
    [catalog, lang, period, region],
  );
  const empty = "No product moved this way yet. Changes appear once a price exists at the start and the end of the period.";

  const rows = (list: typeof gainers) =>
    list.map(({ product, lang: l, v }) => (
      <ProductRow key={`${product.id}-${l}`} id={product.id} name={product.name} image={product.image}
        category={product.category} lang={l} value={money(priceOf(v, region, true))} change={changeOf(v, period, region)} />
    ));

  return (
    <section aria-labelledby="movers-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="movers-title" className="display text-2xl">Top movers</h2>
        {controls}
      </div>
      <p className="mt-1 text-sm text-slate">Fair price incl. shipping. {RULE}</p>
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <ListBox title="Rising" count={gainers.length} empty={empty}>{rows(gainers)}</ListBox>
        <ListBox title="Falling" count={losers.length} empty={empty}>{rows(losers)}</ListBox>
      </div>
    </section>
  );
}

export function Supply() {
  const { data: catalog } = useCatalog();
  const { region } = useSettings();
  const { period, lang, controls } = useControls();
  const { growing, shrinking } = useMemo(
    () => supplyMovers(variants(catalog, lang), period, region),
    [catalog, lang, period, region],
  );
  const empty = "No change in supply yet for this period.";

  const rows = (list: typeof growing) =>
    list.map(({ product, lang: l, v }) => {
      const start = itemsAtStart(v, period);
      const diff = start !== null && v.items !== null ? v.items - start : null;
      return (
        <ProductRow key={`${product.id}-${l}`} id={product.id} name={product.name} image={product.image}
          category={product.category} lang={l} value={`${count(v.items)} listed`} change={v.change[period].items}
          changeNote={diff !== null ? `${diff > 0 ? "+" : "−"}${count(Math.abs(diff))} items` : undefined} />
      );
    });

  return (
    <section aria-labelledby="supply-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="supply-title" className="display text-2xl">Supply</h2>
        {controls}
      </div>
      <p className="mt-1 text-sm text-slate">Change in items listed, all countries. {RULE.replace("items listed", "items listed at the start")}</p>
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <ListBox title="Supply growing" count={growing.length} empty={empty}>{rows(growing)}</ListBox>
        <ListBox title="Supply shrinking" count={shrinking.length} empty={empty}>{rows(shrinking)}</ListBox>
      </div>
    </section>
  );
}

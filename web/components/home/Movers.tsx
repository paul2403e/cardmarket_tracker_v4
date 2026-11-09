"use client";

import { useEffect, useMemo, useState } from "react";
import { ProductRow } from "@/components/ProductRow";
import { Segmented } from "@/components/Segmented";
import { useCatalog } from "@/lib/data";
import { count, money } from "@/lib/format";
import { changeOf, itemsAtStart, movers, priceOf, supplyMovers, variants } from "@/lib/market";
import { useGame } from "@/lib/games";
import { useSettings } from "@/lib/settings";
import type { Lang, Period } from "@/lib/types";
import { ListBox, PERIODS, langOptions } from "./ListBox";
import { ListSettings, SettingsButton } from "./ListSettings";

function useControls() {
  const game = useGame();
  const [period, setPeriod] = useState<Period>("1d");
  const [lang, setLang] = useState<Lang | "all">("all");
  useEffect(() => setLang("all"), [game.key]);
  const controls = (
    <div className="flex flex-wrap gap-2">
      <Segmented label="Period" value={period} options={PERIODS} onChange={setPeriod} />
      <Segmented label="Language" value={lang} options={langOptions(game)} onChange={setLang} />
    </div>
  );
  return { period, lang, controls };
}

const rule = (minItems: number, minPrice: number, atStart = false) =>
  `Only products with at least ${count(minItems)} items listed${atStart ? " at the start" : ""} and a price of €${count(minPrice)} or more.`;

export function Movers() {
  const { data: catalog } = useCatalog();
  const { region, lists: { movers: lists } } = useSettings();
  const { period, lang, controls } = useControls();
  const [showSettings, setShowSettings] = useState(false);
  const { gainers, losers } = useMemo(
    () => movers(variants(catalog, lang), period, region, true, lists),
    [catalog, lang, period, region, lists],
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
        <div className="flex flex-wrap items-center gap-2">
          {controls}
          <SettingsButton open={showSettings} onClick={() => setShowSettings((s) => !s)} controls="movers-settings" />
        </div>
      </div>
      <p className="mt-1 text-sm text-slate">Fair price incl. shipping. {rule(lists.minItems, lists.minPrice)}</p>
      {showSettings && <ListSettings id="movers-settings" list="movers" />}
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <ListBox title="Rising" count={gainers.length} empty={empty}>{rows(gainers)}</ListBox>
        <ListBox title="Falling" count={losers.length} empty={empty}>{rows(losers)}</ListBox>
      </div>
    </section>
  );
}

export function Supply() {
  const { data: catalog } = useCatalog();
  const { region, lists: { supply: lists } } = useSettings();
  const { period, lang, controls } = useControls();
  const [showSettings, setShowSettings] = useState(false);
  const { growing, shrinking } = useMemo(
    () => supplyMovers(variants(catalog, lang), period, region, lists),
    [catalog, lang, period, region, lists],
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
        <div className="flex flex-wrap items-center gap-2">
          {controls}
          <SettingsButton open={showSettings} onClick={() => setShowSettings((s) => !s)} controls="supply-settings" />
        </div>
      </div>
      <p className="mt-1 text-sm text-slate">Change in items listed, all countries. {rule(lists.minItems, lists.minPrice, true)}</p>
      {showSettings && <ListSettings id="supply-settings" list="supply" />}
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <ListBox title="Supply growing" count={growing.length} empty={empty}>{rows(growing)}</ListBox>
        <ListBox title="Supply shrinking" count={shrinking.length} empty={empty}>{rows(shrinking)}</ListBox>
      </div>
    </section>
  );
}

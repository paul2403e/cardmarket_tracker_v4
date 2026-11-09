"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, use, useMemo } from "react";
import { ProductRow, Thumb, shortCategory } from "@/components/ProductRow";
import { Offers } from "@/components/product/Offers";
import { PriceChart } from "@/components/product/PriceChart";
import { useCatalog, useProduct } from "@/lib/data";
import { LANG_LABEL, LANG_SHORT, LANGS, count, money, pct, trendClass } from "@/lib/format";
import { lowestPrice } from "@/lib/market";
import { changeOver, confidence, points, range } from "@/lib/series";
import { useSettings } from "@/lib/settings";
import type { Lang, ProductDetail, VariantFull } from "@/lib/types";

const PERIODS = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "1 year", days: 365 },
];

const CONFIDENCE_TEXT = {
  high: "Reliable: many offers close together",
  medium: "Fair: only a few offers",
  low: "Shaky: very few offers",
};

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-slate">{label}</dt>
      <dd className="num mt-0.5 text-lg font-semibold">{value}</dd>
      {sub && <dd className="text-xs text-slate">{sub}</dd>}
    </div>
  );
}

function Changes({ v, day, region, incl }: { v: VariantFull; day: string; region: "eu" | "all"; incl: boolean }) {
  const price = points(v.series.days, v.series[`${region}_${incl ? "incl" : "excl"}`]);
  const items = points(v.series.days, v.series.items);
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-slate">
        <tr className="border-b border-line">
          <th className="py-2 font-normal">Change</th>
          {PERIODS.map((p) => (
            <th key={p.days} className="py-2 text-right font-normal">{p.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {[
          ["Fair price", price],
          ["Items listed", items],
        ].map(([label, pts]) => (
          <tr key={label as string} className="border-b border-line">
            <td className="py-2">{label as string}</td>
            {PERIODS.map((p) => {
              const c = changeOver(pts as ReturnType<typeof points>, day, p.days);
              return (
                <td key={p.days} className={`num py-2 text-right font-semibold ${trendClass(c)}`}>
                  {pct(c)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LanguageCompare({ p, region, incl }: { p: ProductDetail; region: "eu" | "all"; incl: boolean }) {
  const langs = LANGS.filter((l) => p.languages[l]);
  const en = p.languages.en?.price?.[region]?.[incl ? "incl" : "excl"] ?? null;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-slate">
        <tr className="border-b border-line">
          <th className="py-2 font-normal">Language</th>
          <th className="py-2 text-right font-normal">Fair price</th>
          <th className="py-2 text-right font-normal">vs English</th>
          <th className="py-2 text-right font-normal">Items listed</th>
        </tr>
      </thead>
      <tbody>
        {langs.map((l) => {
          const v = p.languages[l]!;
          const price = v.price?.[region]?.[incl ? "incl" : "excl"] ?? null;
          const vsEn = l !== "en" && en && price ? ((price / en) - 1) * 100 : null;
          return (
            <tr key={l} className="border-b border-line">
              <td className="py-2">{LANG_LABEL[l]}</td>
              <td className="num py-2 text-right font-semibold">{money(price)}</td>
              <td className="num py-2 text-right">{l === "en" ? "" : pct(vsEn)}</td>
              <td className="num py-2 text-right">{count(v.items)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Related({ ids }: { ids: number[] }) {
  const { data: catalog } = useCatalog();
  const { region } = useSettings();
  const list = useMemo(
    () => (catalog?.products ?? []).filter((p) => ids.includes(p.id)).slice(0, 8),
    [catalog, ids],
  );
  if (!list.length) return null;
  return (
    <section aria-labelledby="related-title">
      <h2 id="related-title" className="display text-2xl">From the same set</h2>
      <ul className="mt-3 grid gap-x-8 md:grid-cols-2">
        {list.map((p) => (
          <ProductRow key={p.id} id={p.id} name={p.name} image={p.image} category={p.category}
            value={money(lowestPrice(p, region, true))} />
        ))}
      </ul>
    </section>
  );
}

function Product({ id }: { id: number }) {
  const { data: p, error } = useProduct(id);
  const { region } = useSettings();
  const params = useSearchParams();
  const router = useRouter();

  if (error) {
    return (
      <p className="py-10 text-slate">
        Product #{id} is not tracked. Use the search to find another one, or <Link href="/browse" className="text-cobalt underline">browse all products</Link>.
      </p>
    );
  }
  if (!p) return <p className="py-10 text-slate">Loading product…</p>;

  const available = LANGS.filter((l) => p.languages[l]);
  const wanted = params.get("lang") as Lang | null;
  const lang: Lang = wanted && p.languages[wanted] ? wanted : available[0];
  const v = p.languages[lang]!;
  const day = v.series.days.at(-1) ?? "";
  const conf = confidence(v.basket?.[region], v.items);
  const pts = points(v.series.days, v.series[`${region}_incl`]);
  const year = range(pts, day, 365);
  const ever = range(pts, day);

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <Thumb src={p.image} name={p.name} size={176} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap gap-x-4 text-sm text-slate">
            <Link href={`/browse?category=${p.categoryId}`} className="hover:text-cobalt">{shortCategory(p.category)}</Link>
            <span className="num">Cardmarket ID {p.id}</span>
            {p.added && <span>Added {new Date(p.added).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>}
          </p>
          <h1 className="display mt-2 text-3xl sm:text-4xl">{p.name}</h1>
          {p.nameDe && p.nameDe !== p.name && <p className="mt-1 text-slate">{p.nameDe}</p>}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <div role="tablist" aria-label="Language" className="inline-flex rounded-[var(--radius-control)] bg-surface p-0.5 ring-1 ring-line">
              {available.map((l) => (
                <button key={l} role="tab" aria-selected={l === lang} type="button"
                  onClick={() => router.replace(`/product/${p.id}?lang=${l}`, { scroll: false })}
                  className={`rounded-[var(--radius-control)] px-4 py-1.5 text-sm ${l === lang ? "bg-ink text-white" : "text-slate hover:text-ink"}`}>
                  {LANG_LABEL[l]}
                </button>
              ))}
            </div>
            {v.url && (
              <a href={v.url} target="_blank" rel="noreferrer" className="text-sm text-cobalt underline-offset-2 hover:underline">
                Open {LANG_SHORT[lang]} on Cardmarket
              </a>
            )}
          </div>

          <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4">
            <div>
              <dt className="text-sm text-slate">Fair price incl. shipping</dt>
              <dd className="display num mt-1 text-4xl">{money(v.price?.[region]?.incl)}</dd>
            </div>
            <div>
              <dt className="text-sm text-slate">Fair price item only</dt>
              <dd className="display num mt-1 text-4xl text-slate">{money(v.price?.[region]?.excl)}</dd>
            </div>
            <Stat label="Cheapest valid offer" value={money(v.cheapest?.[region])} sub="incl. shipping" />
            <Stat label="Items listed" value={count(v.items)} sub={`${count(v.offers)} offers, all countries`} />
          </dl>
          <p className="mt-2 text-xs text-slate">
            {CONFIDENCE_TEXT[conf]}
            <Link href="/how-prices-work" className="ml-2 text-cobalt hover:underline">How it&apos;s calculated</Link>
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            {["Add to portfolio", "Watch", "Price alert"].map((t) => (
              <button key={t} type="button" disabled title="Available once accounts are live"
                className="cursor-not-allowed rounded-[var(--radius-control)] px-4 py-1.5 text-sm text-slate ring-1 ring-line">
                {t}
              </button>
            ))}
          </div>
        </div>
      </header>

      {v.status === "no_offers" && (
        <p className="rounded-[var(--radius-panel)] bg-warn-soft px-4 py-3 text-warn">
          There are no {LANG_LABEL[lang]} offers on Cardmarket today. The history below shows earlier days.
        </p>
      )}

      <PriceChart v={v} region={region} />

      <div className="grid gap-10 lg:grid-cols-2">
        <section aria-labelledby="changes-title">
          <h2 id="changes-title" className="display text-2xl">Changes</h2>
          <div className="mt-3"><Changes v={v} day={day} region={region} incl /></div>
          <dl className="mt-5 grid grid-cols-2 gap-4">
            <Stat label="52-week range" value={year ? `${money(year.low.value)} – ${money(year.high.value)}` : "–"} />
            <Stat label="All-time high" value={ever ? money(ever.high.value) : "–"}
              sub={ever ? new Date(ever.high.day).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : undefined} />
          </dl>
        </section>
        <section aria-labelledby="langs-title">
          <h2 id="langs-title" className="display text-2xl">Languages compared</h2>
          <div className="mt-3"><LanguageCompare p={p} region={region} incl /></div>
        </section>
      </div>

      <Related ids={p.related} />
      <Offers offers={v.offersToday} region={region} incl />
    </div>
  );
}

export default function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<p className="py-10 text-slate">Loading product…</p>}>
      <Product id={Number(id)} />
    </Suspense>
  );
}

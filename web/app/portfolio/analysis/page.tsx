"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { NeedsAccounts } from "@/components/account/Form";
import { RequireUser } from "@/components/account/RequireUser";
import { LangBadge } from "@/components/LangBadge";
import { Thumb, shortCategory } from "@/components/ProductRow";
import { Segmented } from "@/components/Segmented";
import { ListBox } from "@/components/home/ListBox";
import { PortfolioShell, useScope, type Scope } from "@/components/portfolio/Shell";
import { Kpi, eur, fmtDate, signed, signedPct } from "@/components/portfolio/ui";
import { LANG_LABEL, trendClass } from "@/lib/format";
import { gameHref, gameOf } from "@/lib/games";
import { LIST_SIZES } from "@/lib/market";
import { chunks, daysBetween } from "@/lib/performance";
import { positions } from "@/lib/portfolio";
import { useSettings } from "@/lib/settings";
import type { Catalog } from "@/lib/types";
import { useCatalogs, valuate, type Valued } from "@/lib/valuation";

// Farben für den Kuchen (zuletzt "Other" in Grau)
const COLORS = ["#2147c9", "#ec5fb4", "#0e8a5c", "#e0a020", "#7b4fd6", "#1aa3c7", "#e8743b", "#5a6ad8", "#c2410c", "#0f766e"];
const OTHER = "#b7c1cb";

type Dim = "game" | "portfolio" | "type" | "language" | "set" | "product";
const DIMS: { value: Dim; label: string }[] = [
  { value: "game", label: "Game" }, { value: "portfolio", label: "Portfolio" }, { value: "type", label: "Product type" },
  { value: "language", label: "Language" }, { value: "set", label: "Set" }, { value: "product", label: "Product (top 10)" },
];

/** Set-Name aus den Produktnamen derselben Erweiterung: gemeinsamer Wortanfang, z. B. "151 Booster Box" + "151 Elite
 *  Trainer Box" -> "151". (Cardmarket liefert die Set-Namen nicht im Katalog.) */
function setNames(cat: Catalog | undefined): Map<number, string> {
  const by = new Map<number, string[]>();
  for (const p of cat?.products ?? []) {
    if (p.expansionId === null || !p.name) continue;
    (by.get(p.expansionId) ?? by.set(p.expansionId, []).get(p.expansionId)!).push(p.name);
  }
  const out = new Map<number, string>();
  for (const [id, names] of by) {
    let prefix = names[0].split(" ");
    for (const n of names.slice(1)) {
      const w = n.split(" ");
      let i = 0;
      while (i < prefix.length && i < w.length && prefix[i] === w[i]) i++;
      prefix = prefix.slice(0, i);
    }
    const name = prefix.join(" ").replace(/[\s:–-]+$/, "");
    out.set(id, name && (names.length > 1 || name.split(" ").length <= 4) ? name : names[0]);
  }
  return out;
}

function Allocation({ rows, scope, catalogs }: { rows: Valued[]; scope: Scope; catalogs: Record<string, Catalog | undefined> }) {
  const [dim, setDim] = useState<Dim>("game");
  const sets = useMemo(() => Object.fromEntries(Object.entries(catalogs).map(([g, c]) => [g, setNames(c)])), [catalogs]);
  const slices = useMemo(() => {
    const sums = new Map<string, number>();
    for (const r of rows) {
      if (!r.valueCents) continue;
      const label =
        dim === "game" ? gameOf(r.game)?.name ?? r.game
          : dim === "portfolio" ? scope.depotName(r.depotId)
            : dim === "type" ? shortCategory(r.product?.category ?? null) || "Other"
              : dim === "language" ? LANG_LABEL[r.language]
                : dim === "set" ? (r.product?.expansionId != null ? sets[r.game]?.get(r.product.expansionId) : null) ?? "Unknown set"
                  : `${r.product?.name ?? r.productName} · ${r.language.toUpperCase()}${scope.current === "all" && scope.depots.length > 1 ? ` · ${scope.depotName(r.depotId)}` : ""}`;
      sums.set(label, (sums.get(label) ?? 0) + r.valueCents);
    }
    const total = [...sums.values()].reduce((a, b) => a + b, 0);
    let list = [...sums.entries()].map(([name, cents]) => ({ name, cents, pct: total ? (cents / total) * 100 : 0 }))
      .sort((a, b) => b.cents - a.cents);
    // lesbar halten: Produkte = Top 10, sonst Anteile unter 3 % zusammenfassen
    const keep = dim === "product" ? list.slice(0, 10) : list.filter((x) => x.pct >= 3);
    const rest = list.filter((x) => !keep.includes(x));
    list = rest.length ? [...keep, { name: `Other (${rest.length})`, cents: rest.reduce((s, x) => s + x.cents, 0), pct: rest.reduce((s, x) => s + x.pct, 0) }] : keep;
    return list.map((x, i) => ({ ...x, color: x.name.startsWith("Other (") ? OTHER : COLORS[i % COLORS.length] }));
  }, [rows, dim, scope, sets]);

  return (
    <section aria-labelledby="alloc-title" className="rounded-[var(--radius-panel)] bg-surface p-5 ring-1 ring-line">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="alloc-title" className="display text-2xl">Allocation</h2>
        <Segmented label="Split by" value={dim} onChange={setDim} options={DIMS} />
      </div>
      {slices.length === 0 ? (
        <p className="py-10 text-center text-slate">No priced holdings here.</p>
      ) : (
        <div className="mt-4 grid items-center gap-6 md:grid-cols-[280px_1fr]">
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={slices} dataKey="cents" nameKey="name" innerRadius="58%" outerRadius="95%" paddingAngle={slices.length > 1 ? 1 : 0}
                  stroke="#ffffff" strokeWidth={slices.length > 1 ? 2 : 0} isAnimationActive={false}>
                  {slices.map((s) => <Cell key={s.name} fill={s.color} />)}
                </Pie>
                <Tooltip content={({ active, payload }) => {
                  const s = active ? (payload?.[0]?.payload as (typeof slices)[number] | undefined) : undefined;
                  if (!s) return null;
                  return (
                    <div className="rounded-[10px] border border-line bg-surface px-3 py-2 text-sm shadow-[0_8px_24px_-12px_rgba(23,33,43,0.3)]">
                      <p className="font-semibold">{s.name}</p>
                      <p className="num">{eur(s.cents)} · {s.pct.toFixed(1).replace(".", ",")} %</p>
                    </div>
                  );
                }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="grid gap-1.5 text-sm">
            {slices.map((s) => (
              <li key={s.name} className="flex items-center gap-3">
                <span aria-hidden className="h-3 w-3 shrink-0 rounded-sm" style={{ background: s.color }} />
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <span className="num text-slate">{eur(s.cents)}</span>
                <span className="num w-14 text-right font-semibold">{s.pct.toFixed(1).replace(".", ",")} %</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function TopPositions({ rows, scope }: { rows: Valued[]; scope: Scope }) {
  const { pview, setPview } = useSettings();
  const total = rows.reduce((s, r) => s + (r.valueCents ?? 0), 0);
  const top = [...rows].filter((r) => r.valueCents).sort((a, b) => b.valueCents! - a.valueCents!).slice(0, pview.topCount);
  const showDepot = scope.current === "all" && scope.depots.length > 1;
  return (
    <section aria-labelledby="top-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="top-title" className="display text-2xl">Top positions</h2>
        <label className="flex items-center gap-2 text-sm text-slate">
          Show
          <select value={pview.topCount} onChange={(e) => setPview({ topCount: Number(e.target.value) })}
            className="h-[34px] rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm text-ink">
            {LIST_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <p className="mt-1 text-sm text-slate">Your largest positions by value and their share of the total.</p>
      <div className="mt-4">
        <ListBox title="By value" count={top.length} empty="No priced holdings here.">
          {top.map((r) => {
            const game = gameOf(r.game);
            return (
              <li key={r.key}>
                <Link href={game ? `${gameHref(game, `/product/${r.productId}`)}?lang=${r.language}` : "#"}
                  className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-cobalt-soft">
                  <Thumb src={r.product?.image ?? null} category={r.product?.category} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{r.product?.name ?? r.productName}</span>
                    <span className="flex items-center gap-2 text-xs text-slate">
                      <LangBadge lang={r.language} /> {r.quantity} × · {showDepot ? scope.depotName(r.depotId) : game?.name}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="num block font-semibold">{eur(r.valueCents)}</span>
                    <span className="num block text-xs text-slate">{total ? ((r.valueCents! / total) * 100).toFixed(1).replace(".", ",") : "0"} %</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ListBox>
      </div>
    </section>
  );
}

function Sales({ scope, catalogs }: { scope: Scope; catalogs: Record<string, Catalog | undefined> }) {
  const sales = useMemo(() => {
    const by = new Map<string, { id: string; game: string; productId: number; language: string; date: string; qty: number; cost: number; proceeds: number; dayUnits: number }>();
    for (const c of chunks(scope.txns)) {
      if (!c.sellId) continue;
      const s = by.get(c.sellId) ?? { id: c.sellId, game: c.game, productId: c.productId, language: c.language, date: c.sellDate!, qty: 0, cost: 0, proceeds: 0, dayUnits: 0 };
      s.qty += c.qty;
      s.cost += c.qty * c.unitCost;
      s.proceeds += c.qty * c.sellUnit!;
      s.dayUnits += c.qty * daysBetween(c.buyDate, c.sellDate!);
      by.set(c.sellId, s);
    }
    return [...by.values()].map((s) => ({ ...s, profit: s.proceeds - s.cost, pct: s.cost ? ((s.proceeds - s.cost) / s.cost) * 100 : 0 }));
  }, [scope.txns]);
  const units = sales.reduce((a, s) => a + s.qty, 0);
  const realized = sales.reduce((a, s) => a + s.profit, 0);
  const avgPct = sales.length ? sales.reduce((a, s) => a + s.pct, 0) / sales.length : 0;
  const avgDays = units ? sales.reduce((a, s) => a + s.dayUnits, 0) / units : 0;
  const byYear = [...sales.reduce((m, s) => m.set(s.date.slice(0, 4), (m.get(s.date.slice(0, 4)) ?? 0) + s.profit), new Map<string, number>())]
    .sort((a, b) => b[0].localeCompare(a[0]));
  const best = [...sales].sort((a, b) => b.profit - a.profit).slice(0, 5);
  const hold = avgDays >= 60 ? `${(avgDays / 30.4).toFixed(1).replace(".", ",")} months` : `${Math.round(avgDays)} days`;

  return (
    <section aria-labelledby="sales-title">
      <h2 id="sales-title" className="display text-2xl">Sales</h2>
      {sales.length === 0 ? (
        <p className="mt-2 text-slate">No sales yet.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi small label="Realized profit" value={signed(realized)} tone={realized} />
            <Kpi small label="Sales" value={String(sales.length)} sub={`${units} item${units === 1 ? "" : "s"}`} />
            <Kpi small label="Avg. return per sale" value={signedPct(avgPct)} tone={avgPct} />
            <Kpi small label="Avg. holding time" value={hold} sub="purchase to sale" />
          </div>
          <div className="grid gap-6 md:grid-cols-[1fr_2fr]">
            <div className="rounded-[var(--radius-panel)] bg-surface p-4 ring-1 ring-line">
              <h3 className="font-semibold">Realized per year</h3>
              <ul className="mt-2 divide-y divide-line text-sm">
                {byYear.map(([y, c]) => (
                  <li key={y} className="flex justify-between py-1.5"><span>{y}</span><span className={`num font-semibold ${trendClass(c)}`}>{signed(c)}</span></li>
                ))}
              </ul>
            </div>
            <div className="rounded-[var(--radius-panel)] bg-surface p-4 ring-1 ring-line">
              <h3 className="font-semibold">Best sales</h3>
              <ul className="mt-2 divide-y divide-line text-sm">
                {best.map((s) => {
                  const p = catalogs[s.game]?.products.find((x) => x.id === s.productId);
                  const t = scope.txns.find((x) => x.id === s.id);
                  return (
                    <li key={s.id} className="flex items-center gap-3 py-2">
                      <Thumb src={p?.image ?? null} category={p?.category} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{p?.name ?? t?.product_name}</span>
                        <span className="text-xs text-slate">{fmtDate(s.date)} · {s.qty} × · {s.language.toUpperCase()}</span>
                      </span>
                      <span className="text-right">
                        <span className={`num block font-semibold ${trendClass(s.profit)}`}>{signed(s.profit)}</span>
                        <span className="num block text-xs text-slate">{signedPct(s.pct)}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Analysis() {
  const scope = useScope();
  const { region } = useSettings();
  const games = useMemo(() => new Set((scope?.allTxns ?? []).map((t) => t.game)), [scope?.allTxns]);
  const catalogs = useCatalogs(games);
  const rows = useMemo(
    () => positions(scope?.txns ?? []).filter((p) => p.quantity > 0).map((p) => valuate(p, catalogs, region)),
    [scope?.txns, catalogs, region],
  );
  if (!scope) return <p className="py-10 text-slate">Loading portfolio…</p>;
  return (
    <PortfolioShell scope={scope}>
      {scope.txns.length === 0 ? (
        <p className="text-slate">No transactions here yet.</p>
      ) : (
        <>
          <Allocation rows={rows} scope={scope} catalogs={catalogs} />
          <TopPositions rows={rows} scope={scope} />
          <Sales scope={scope} catalogs={catalogs} />
        </>
      )}
    </PortfolioShell>
  );
}

export default function AnalysisPage() {
  return (
    <NeedsAccounts>
      <RequireUser>{() => <Suspense><Analysis /></Suspense>}</RequireUser>
    </NeedsAccounts>
  );
}

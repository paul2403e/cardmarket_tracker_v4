"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { NeedsAccounts } from "@/components/account/Form";
import { RequireUser } from "@/components/account/RequireUser";
import { LangBadge } from "@/components/LangBadge";
import { Thumb } from "@/components/ProductRow";
import { Segmented } from "@/components/Segmented";
import { CustomRange, customDefault, resolveCustom, type CustomValue } from "@/components/CustomRange";
import { ListBox } from "@/components/home/ListBox";
import { SettingsButton } from "@/components/home/ListSettings";
import { usePortfolioTimeline } from "@/components/portfolio/PerformanceTiles";
import { PortfolioShell, useScope, type Scope } from "@/components/portfolio/Shell";
import { eur, fmtDate, signed, signedPct } from "@/components/portfolio/ui";
import { trendClass } from "@/lib/format";
import { gameOf } from "@/lib/games";
import { LIST_SIZES } from "@/lib/market";
import { addDays, chartSeries, chunks, daysBetween, performance, positionChange, type Chunk, type Series } from "@/lib/performance";
import { positionHref } from "@/lib/portfolio";
import { useSettings, type ListPeriod } from "@/lib/settings";
import { useCatalogs } from "@/lib/valuation";

type Range = "1d" | "7d" | "30d" | "1y" | "all" | "custom";
const RANGES: { value: Range; label: string }[] = [
  { value: "1d", label: "1D" }, { value: "7d", label: "7D" }, { value: "30d", label: "30D" },
  { value: "1y", label: "1Y" }, { value: "all", label: "All" }, { value: "custom", label: "Custom" },
];
const RANGE_DAYS: Record<string, number> = { "1d": 1, "7d": 7, "30d": 30, "1y": 365 };

const short = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const monthYear = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });

function Chart({ scope }: { scope: Scope }) {
  const { pview, setPview } = useSettings();
  const { points, loading, today } = usePortfolioTimeline(scope.txns, pview.includeSold);
  const [range, setRange] = useState<Range>("all");
  const [custom, setCustom] = useState<CustomValue>(customDefault);
  const first = points[0]?.day ?? today;
  const eff = resolveCustom(custom, today);
  const from = range === "all" ? first : range === "custom" ? eff.from : addDays(today, -RANGE_DAYS[range]);
  const end = range === "custom" ? eff.to : today;
  const start = from < first ? first : from;
  const shown = useMemo(() => (end < today ? points.filter((p) => p.day <= end) : points), [points, end, today]);
  const data = useMemo(() => {
    const rows = chartSeries(shown, start);
    // geschätzter Teil gestrichelt: zwei Reihen, die sich am Übergang berühren
    return rows.map((r, i) => {
      const est = r.estimated || (rows[i + 1]?.estimated ?? false);
      const y = pview.chartMode === "pct" ? r.pct : r.value / 100;
      return { ...r, yReal: r.estimated ? null : y, yEst: est ? y : null, invested: r.invested / 100 };
    });
  }, [shown, start, pview.chartMode]);
  const perf = performance(shown, start);
  const pctMode = pview.chartMode === "pct";
  const last = data.at(-1);
  const anyEstimated = data.some((d) => d.estimated);
  // lange Zeiträume: Monat + Jahr statt Tag + Monat
  const longRange = data.length > 1 && daysBetween(data[0].day, data[data.length - 1].day) > 120;

  return (
    <section className="rounded-[var(--radius-panel)] bg-surface p-5 ring-1 ring-line">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate">{pctMode ? "Performance" : "Value"} · {range === "all" ? "since first purchase" : end < today ? `${fmtDate(start)} – ${fmtDate(end)}` : `since ${fmtDate(start)}`}</p>
          {perf && last && (
            <p className={`display num mt-1 text-3xl ${pctMode ? trendClass(perf.pct) : ""}`}>
              {perf.estimated ? "≈ " : ""}{pctMode ? signedPct(perf.pct) : eur(last.value)}
              <span className={`ml-3 text-base ${trendClass(perf.cents)}`}>{signed(Math.round(perf.cents))}</span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="View" value={pview.chartMode} onChange={(v) => setPview({ chartMode: v })}
            options={[{ value: "pct", label: "Performance %" }, { value: "eur", label: "Total value" }]} />
          <Segmented label="Time range" value={range} onChange={setRange} options={RANGES} />
        </div>
      </div>
      {range === "custom" && <CustomRange value={custom} onChange={setCustom} first={first} last={today} />}

      {loading ? (
        <p className="grid h-72 place-items-center text-slate">Loading prices…</p>
      ) : data.length < 2 ? (
        <p className="grid h-72 place-items-center text-center text-slate">The chart starts once there are two days to compare.</p>
      ) : (
        <div className="mt-4 h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <XAxis dataKey="day" tickFormatter={longRange ? monthYear : short} tickLine={false} axisLine={false} minTickGap={48}
                tick={{ fill: "#5b6772", fontSize: 12 }} />
              <YAxis tickLine={false} axisLine={false} width={64} domain={["auto", "auto"]} tick={{ fill: "#5b6772", fontSize: 12 }}
                tickFormatter={(v: number) => (pctMode ? `${v.toFixed(0)} %` : `€${Math.round(v).toLocaleString("en-GB")}`)} />
              <Tooltip cursor={{ stroke: "#9aa6b1", strokeDasharray: "3 3" }} content={({ active, payload }) => {
                const r = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
                if (!r) return null;
                return (
                  <div className="rounded-[10px] border border-line bg-surface px-3 py-2 text-sm shadow-[0_8px_24px_-12px_rgba(23,33,43,0.3)]">
                    <p className="mb-1 font-semibold">{fmtDate(r.day)}{r.estimated && <span className="ml-2 text-xs font-normal text-slate">estimated</span>}</p>
                    {[
                      ["Performance", signedPct(r.pct)],
                      ["Value", eur(r.value)],
                      ["Invested", eur(r.invested * 100)],
                      ["Profit / loss", signed(Math.round(r.value - r.invested * 100))],
                    ].map(([k, v]) => (
                      <p key={k} className="flex justify-between gap-6"><span className="text-slate">{k}</span><span className="num font-semibold">{v}</span></p>
                    ))}
                    {(r.buys > 0 || r.sells > 0) && (
                      <p className="mt-1 text-xs text-slate">Purchases: {r.buys} · Sales: {r.sells}</p>
                    )}
                  </div>
                );
              }} />
              {!pctMode && (
                <Line type="monotone" dataKey="invested" stroke="#9aa6b1" strokeWidth={1.5} strokeDasharray="2 3"
                  dot={false} isAnimationActive={false} name="Invested" />
              )}
              <Area type="monotone" dataKey="yReal" stroke="#2147c9" strokeWidth={2.5} fill="#2147c9" fillOpacity={0.06}
                dot={false} isAnimationActive={false} connectNulls={false} />
              <Line type="monotone" dataKey="yEst" stroke="#2147c9" strokeWidth={2} strokeDasharray="5 5" strokeOpacity={0.6}
                dot={false} isAnimationActive={false} connectNulls={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate">
        <span>
          {pview.includeSold
            ? "Includes sold items: at the fair price until the sale, then at your sale price."
            : "Shows what you hold today, each item from its purchase date. Sold items: see Analysis."}
          {pctMode && " Performance = profit in the period ÷ money in it (value at the start plus purchases since)."}
          {anyEstimated && " Dashed = estimated: before tracking started there are no prices, so it is a straight line from your purchase price to the first tracked price."}
          {!pctMode && " Grey line = invested."}
        </span>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={pview.includeSold} onChange={(e) => setPview({ includeSold: e.target.checked })} className="accent-cobalt" />
          Include sold items
        </label>
      </div>
    </section>
  );
}

const LIST_PERIODS: { value: ListPeriod; label: string }[] = [
  { value: "1d", label: "1D" }, { value: "7d", label: "7D" }, { value: "30d", label: "30D" }, { value: "1y", label: "1Y" }, { value: "all", label: "All" },
];

function Movers({ scope }: { scope: Scope }) {
  const { pview, setPview } = useSettings();
  const { series, loading, today } = usePortfolioTimeline(scope.txns);
  const games = useMemo(() => new Set(scope.txns.map((t) => t.game)), [scope.txns]);
  const catalogs = useCatalogs(games);
  const [settings, setSettings] = useState(false);
  const rows = useMemo(() => {
    if (loading) return [];
    const groups = new Map<string, Chunk[]>();
    for (const c of chunks(scope.txns)) {
      if (c.sellDate) continue;
      const k = c.key; // dasselbe Produkt (Sprache) über alle Portfolios zusammen
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(c);
    }
    const from = pview.listPeriod === "all" ? "all" : addDays(today, -{ "1d": 1, "7d": 7, "30d": 30, "1y": 365 }[pview.listPeriod]);
    return [...groups.entries()].map(([k, cs]) => {
      const ch = positionChange(cs, series as Map<string, Series>, today, from);
      const c = cs[0];
      const product = catalogs[c.game]?.products.find((p) => p.id === c.productId) ?? null;
      const qty = cs.reduce((n, x) => n + x.qty, 0);
      const depots = [...new Set(cs.map((x) => x.depotId))];
      return { k, c, product, qty, depots, cents: ch.cents, pct: ch.base ? (ch.cents / ch.base) * 100 : 0, estimated: ch.estimated };
    }).filter((r) => r.cents !== 0);
  }, [loading, scope.txns, series, today, pview.listPeriod, catalogs]);
  const metric = (r: (typeof rows)[number]) => (pview.listMetric === "pct" ? r.pct : r.cents);
  const sorted = [...rows].sort((a, b) => metric(b) - metric(a));
  const winners = sorted.filter((r) => metric(r) > 0).slice(0, pview.listCount);
  const losers = sorted.filter((r) => metric(r) < 0).reverse().slice(0, pview.listCount);
  const showDepot = scope.current === "all" && scope.depots.length > 1;

  const item = (r: (typeof rows)[number]) => {
    const game = gameOf(r.c.game);
    return (
      <li key={r.k}>
        <Link href={positionHref(r.c.game, r.c.productId, r.c.language, scope.current)}
          className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-cobalt-soft">
          <Thumb src={r.product?.image ?? null} category={r.product?.category} size={40} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{r.product?.name ?? `#${r.c.productId}`}</span>
            <span className="flex items-center gap-2 text-xs text-slate">
              <LangBadge lang={r.c.language} />
              <span className="num font-semibold text-ink">{r.qty}×</span>
              <span>{showDepot ? r.depots.map(scope.depotName).join(", ") : game?.name}</span>
            </span>
          </span>
          <span className="text-right">
            <span className={`num block font-semibold ${trendClass(metric(r))}`}>
              {r.estimated ? "≈ " : ""}{pview.listMetric === "pct" ? signedPct(r.pct) : signed(r.cents)}
            </span>
            <span className="num block text-xs text-slate">{pview.listMetric === "pct" ? signed(r.cents) : signedPct(r.pct)}</span>
          </span>
        </Link>
      </li>
    );
  };

  return (
    <section aria-labelledby="pm-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="pm-title" className="display text-2xl">Winners and losers</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Period" value={pview.listPeriod} onChange={(v) => setPview({ listPeriod: v })} options={LIST_PERIODS} />
          <Segmented label="Measure" value={pview.listMetric} onChange={(v) => setPview({ listMetric: v })}
            options={[{ value: "pct", label: "%" }, { value: "eur", label: "€" }]} />
          <SettingsButton open={settings} onClick={() => setSettings((s) => !s)} controls="pm-settings" />
        </div>
      </div>
      <p className="mt-1 text-sm text-slate">
        {pview.listPeriod === "all" ? "Profit or loss against what you paid." : "Change of the fair price in this period, for what you hold today."}
      </p>
      {settings && (
        <div id="pm-settings" className="mt-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-panel)] bg-surface p-4 ring-1 ring-line">
          <span className="text-sm text-slate">Entries per list</span>
          <Segmented label="Entries per list" value={String(pview.listCount)} onChange={(v) => setPview({ listCount: Number(v) })}
            options={LIST_SIZES.map((n) => ({ value: String(n), label: String(n) }))} />
        </div>
      )}
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <ListBox title="Winners" count={winners.length} empty={loading ? "Loading prices…" : "No winners in this period."}>
          {winners.map(item)}
        </ListBox>
        <ListBox title="Losers" count={losers.length} empty={loading ? "Loading prices…" : "No losers in this period."}>
          {losers.map(item)}
        </ListBox>
      </div>
    </section>
  );
}

function Performance() {
  const scope = useScope();
  if (!scope) return <p className="py-10 text-slate">Loading portfolio…</p>;
  return (
    <PortfolioShell scope={scope}>
      {scope.txns.length === 0 ? (
        <p className="text-slate">No transactions here yet.</p>
      ) : (
        <>
          <Chart scope={scope} />
          <Movers scope={scope} />
        </>
      )}
    </PortfolioShell>
  );
}

export default function PerformancePage() {
  return (
    <NeedsAccounts>
      <RequireUser>{() => <Suspense><Performance /></Suspense>}</RequireUser>
    </NeedsAccounts>
  );
}


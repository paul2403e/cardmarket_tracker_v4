"use client";

// Historie je Position (Meilenstein 6d): ein Produkt in einer Sprache – bei "All portfolios" über alle Portfolios
// zusammen (mit Aufteilung), sonst nur im gewählten Portfolio. Graph Wert/Einstand oder Preis pro Stück,
// Käufe und Verkäufe als Punkte, alle Transaktionen mit Bearbeiten/Löschen.
import Link from "next/link";
import { Suspense, use, useMemo, useState } from "react";
import { Area, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { NeedsAccounts } from "@/components/account/Form";
import { RequireUser } from "@/components/account/RequireUser";
import { LangBadge } from "@/components/LangBadge";
import { Thumb } from "@/components/ProductRow";
import { Segmented } from "@/components/Segmented";
import { DeleteTxnDialog } from "@/components/portfolio/DeleteTxnDialog";
import { usePortfolioTimeline } from "@/components/portfolio/PerformanceTiles";
import { PortfolioShell, useScope } from "@/components/portfolio/Shell";
import { TxnDialog } from "@/components/portfolio/TxnDialog";
import { Kpi, eur, fmtDate, signed, signedPct } from "@/components/portfolio/ui";
import { money, pct, trendClass } from "@/lib/format";
import { gameHref, gameOf } from "@/lib/games";
import { addDays, chartSeries, daysBetween, performance, type Series } from "@/lib/performance";
import { positions, todayIso, type Txn } from "@/lib/portfolio";
import { useSettings } from "@/lib/settings";
import type { Lang } from "@/lib/types";
import { mergeValued, useCatalogs, valuate } from "@/lib/valuation";

type Range = "7d" | "30d" | "1y" | "all" | "custom";
const RANGES: { value: Range; label: string }[] = [
  { value: "7d", label: "7D" }, { value: "30d", label: "30D" }, { value: "1y", label: "1Y" },
  { value: "all", label: "All" }, { value: "custom", label: "Custom" },
];
const RANGE_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "1y": 365 };

const short = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const monthYear = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });

/** Fairer Preis (Cent) am Tag oder der letzte davor; null vor dem ersten Preis. */
function priceOn(s: Series | undefined, day: string): number | null {
  if (!s) return null;
  let out: number | null = null;
  for (let i = 0; i < s.days.length && s.days[i] <= day; i++) if (s.cents[i] !== null) out = s.cents[i];
  return out;
}

function Chart({ txns, game, productId, lang, held }: { txns: Txn[]; game: string; productId: number; lang: Lang; held: number }) {
  const { pview, setPview } = useSettings();
  // ganz verkauft: Verlauf nur mit den verkauften Stück sinnvoll
  const includeSold = held === 0 ? true : pview.includeSold;
  const { points, loading, today, series } = usePortfolioTimeline(txns, includeSold);
  const [mode, setMode] = useState<"value" | "price">("value");
  const [range, setRange] = useState<Range>("all");
  const [customFrom, setCustomFrom] = useState(addDays(todayIso(), -90));
  const [customDays, setCustomDays] = useState("");
  const first = points[0]?.day ?? today;
  const from = range === "all" ? first : range === "custom" ? (customDays ? addDays(today, -Number(customDays)) : customFrom)
    : addDays(today, -RANGE_DAYS[range]);
  const start = from < first ? first : from;
  const s = series.get(`${game}|${productId}|${lang}`);
  const avgCost = useMemo(() => {
    const buys = txns.filter((t) => t.kind === "buy");
    const q = buys.reduce((n, t) => n + t.quantity, 0);
    return q ? buys.reduce((n, t) => n + t.quantity * t.unit_price_cents, 0) / q / 100 : null;
  }, [txns]);

  const data = useMemo(() => chartSeries(points, start).map((r, i, rows) => {
    const est = r.estimated || (rows[i + 1]?.estimated ?? false);
    const p = priceOn(s, r.day);
    const y = mode === "value" ? r.value / 100 : p === null ? null : p / 100;
    return { ...r, y, yReal: r.estimated ? null : y, yEst: est ? y : null, invested: r.invested / 100, price: p };
  }), [points, start, mode, s]);
  const perf = performance(points, start);
  const longRange = data.length > 1 && daysBetween(data[0].day, data[data.length - 1].day) > 120;
  const visible = new Set(data.map((d) => d.day));
  // Käufe/Verkäufe als Punkte: im Preis-Modus beim bezahlten bzw. erzielten Preis, sonst auf der Wertlinie
  const marks = txns.filter((t) => visible.has(t.trade_date)).map((t) => {
    const row = data.find((d) => d.day === t.trade_date);
    return { t, y: mode === "price" ? t.unit_price_cents / 100 : row?.y ?? null };
  }).filter((m) => m.y !== null);
  const anyEstimated = data.some((d) => d.estimated);

  return (
    <section className="rounded-[var(--radius-panel)] bg-surface p-5 ring-1 ring-line">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate">Performance · {range === "all" ? "since first purchase" : `since ${fmtDate(start)}`}</p>
          {perf && (
            <p className={`display num mt-1 text-3xl ${trendClass(perf.pct)}`}>
              {perf.estimated ? "≈ " : ""}{signedPct(perf.pct)}
              <span className={`ml-3 text-base ${trendClass(perf.cents)}`}>{signed(Math.round(perf.cents))}</span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="View" value={mode} onChange={setMode}
            options={[{ value: "value", label: "Value" }, { value: "price", label: "Price per item" }]} />
          <Segmented label="Time range" value={range} onChange={setRange} options={RANGES} />
        </div>
      </div>
      {range === "custom" && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">From
            <input type="date" value={customDays ? addDays(today, -Number(customDays)) : customFrom} max={today}
              onChange={(e) => { setCustomFrom(e.target.value); setCustomDays(""); }}
              className="h-9 rounded-[var(--radius-control)] border border-line px-3" />
          </label>
          <span className="text-slate">or last</span>
          <input type="number" min={1} value={customDays} onChange={(e) => setCustomDays(e.target.value)} placeholder="N"
            aria-label="Number of days" className="num h-9 w-20 rounded-[var(--radius-control)] border border-line px-3" />
          <span className="text-slate">days</span>
        </div>
      )}
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
                tickFormatter={(v: number) => `€${Math.round(v).toLocaleString("en-GB")}`} />
              <Tooltip cursor={{ stroke: "#9aa6b1", strokeDasharray: "3 3" }} content={({ active, payload }) => {
                const r = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
                if (!r) return null;
                const dayTxns = txns.filter((t) => t.trade_date === r.day);
                return (
                  <div className="rounded-[10px] border border-line bg-surface px-3 py-2 text-sm shadow-[0_8px_24px_-12px_rgba(23,33,43,0.3)]">
                    <p className="mb-1 font-semibold">{fmtDate(r.day)}{r.estimated && <span className="ml-2 text-xs font-normal text-slate">estimated</span>}</p>
                    {[
                      ["Fair price item only", r.price === null ? "–" : eur(r.price)],
                      ["Value", eur(r.value)],
                      ["Invested", eur(r.invested * 100)],
                      ["Profit / loss", signed(Math.round(r.value - r.invested * 100))],
                    ].map(([k, v]) => (
                      <p key={k} className="flex justify-between gap-6"><span className="text-slate">{k}</span><span className="num font-semibold">{v}</span></p>
                    ))}
                    {dayTxns.map((t) => (
                      <p key={t.id} className="mt-1 text-xs">
                        <span className={t.kind === "buy" ? "text-cobalt" : "text-up"}>{t.kind === "buy" ? "Bought" : "Sold"}</span>{" "}
                        {t.quantity} × {money(t.unit_price_cents / 100)}
                      </p>
                    ))}
                  </div>
                );
              }} />
              {mode === "value" && (
                <Line type="stepAfter" dataKey="invested" stroke="#9aa6b1" strokeWidth={1.5} strokeDasharray="2 3"
                  dot={false} isAnimationActive={false} name="Invested" />
              )}
              {mode === "price" && avgCost !== null && (
                <ReferenceLine y={avgCost} stroke="#9aa6b1" strokeDasharray="2 3"
                  label={{ value: `Avg. purchase ${money(avgCost)}`, position: "insideBottomLeft", fill: "#5b6772", fontSize: 11 }} />
              )}
              <Area type="monotone" dataKey="yReal" stroke="#2147c9" strokeWidth={2.5} fill="#2147c9" fillOpacity={0.06}
                dot={false} isAnimationActive={false} connectNulls={false} />
              <Line type="monotone" dataKey="yEst" stroke="#2147c9" strokeWidth={2} strokeDasharray="5 5" strokeOpacity={0.6}
                dot={false} isAnimationActive={false} connectNulls={false} />
              {marks.map(({ t, y }) => (
                <ReferenceDot key={t.id} x={t.trade_date} y={y!} r={5} ifOverflow="extendDomain"
                  fill={t.kind === "buy" ? "#2147c9" : "#0e8a5c"} stroke="#ffffff" strokeWidth={2} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate">
        <span>
          <span className="mr-3"><span className="mr-1 inline-block h-2 w-2 rounded-full bg-cobalt" aria-hidden />Purchase</span>
          <span className="mr-3"><span className="mr-1 inline-block h-2 w-2 rounded-full bg-up" aria-hidden />Sale</span>
          {mode === "value" ? "Grey line = invested." : "Dots = your purchase and sale prices; grey line = average purchase price."}
          {anyEstimated && " Dashed = estimated (before tracking started)."}
        </span>
        {held > 0 && (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={pview.includeSold} onChange={(e) => setPview({ includeSold: e.target.checked })} className="accent-cobalt" />
            Include sold items
          </label>
        )}
      </div>
    </section>
  );
}

function Position({ game, productId, lang }: { game: string; productId: number; lang: Lang }) {
  const scope = useScope();
  const { region } = useSettings();
  const catalogs = useCatalogs(useMemo(() => new Set([game]), [game]));
  const [dialog, setDialog] = useState<{ editing?: Txn } | null>(null);
  const [deleting, setDeleting] = useState<Txn | null>(null);
  // nicht nach dem Spiele-Filter, nur nach Portfolio-Auswahl
  const txns = useMemo(() => (scope?.allTxns ?? []).filter((t) => t.game === game && t.product_id === productId &&
    t.language === lang && (scope?.current === "all" || t.depot_id === scope?.current)), [scope, game, productId, lang]);
  const parts = useMemo(() => positions(txns).map((p) => valuate(p, catalogs, region)), [txns, catalogs, region]);
  const pos = mergeValued(parts)[0];

  if (!scope) return <p className="py-10 text-slate">Loading portfolio…</p>;
  const g = gameOf(game);
  const product = catalogs[game]?.products.find((p) => p.id === productId) ?? null;
  const name = product?.name ?? txns[0]?.product_name ?? `#${productId}`;
  const q = scope.current === "all" ? "" : `?p=${scope.current}`;
  const pl = pos && pos.valueCents !== null ? pos.valueCents - pos.costCents : null;
  const sorted = [...txns].sort((a, b) => b.trade_date.localeCompare(a.trade_date) || b.created_at.localeCompare(a.created_at));
  const multi = parts.length > 1;

  return (
    <PortfolioShell scope={scope} showGames={false}>
      <Link href={`/portfolio${q}`} className="-mt-2 text-sm text-cobalt hover:underline">← Back to holdings</Link>
      <header className="flex flex-wrap items-center gap-4">
        <Thumb src={product?.image ?? null} name={name} category={product?.category ?? null} size={72} />
        <div className="min-w-0 flex-1">
          <h2 className="display text-3xl">{name}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate">
            <LangBadge lang={lang} /> <span>{g?.name}</span>
            {pos && <span>{pos.depotIds.map(scope.depotName).join(", ")}</span>}
          </p>
        </div>
        {g && (
          <Link href={`${gameHref(g, `/product/${productId}`)}?lang=${lang}`}
            className="flex h-10 items-center rounded-[var(--radius-control)] px-4 font-semibold ring-1 ring-line hover:ring-ink">
            Product page →
          </Link>
        )}
        <button type="button" onClick={() => setDialog({})}
          className="h-10 rounded-[var(--radius-control)] px-4 font-semibold text-cobalt ring-1 ring-line hover:bg-cobalt hover:text-white hover:ring-cobalt">
          +/− Buy or sell
        </button>
      </header>

      {!pos ? (
        <p className="text-slate">No transactions for this product{scope.current === "all" ? "" : " in this portfolio"}.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Value" value={eur(pos.valueCents)}
              sub={`${pos.quantity} × ${pos.priceCents === null ? "–" : eur(pos.priceCents)}${pos.priceDay ? ` (from ${fmtDate(pos.priceDay)})` : ""}`} />
            <Kpi label="Avg. cost" value={pos.quantity ? eur(Math.round(pos.costCents / pos.quantity)) : "–"}
              sub={`${eur(pos.costCents)} invested`} />
            <Kpi label="Unrealized" value={pl === null ? "–" : signed(pl)} tone={pl ?? undefined}
              sub={pl !== null && pos.costCents ? pct((pl / pos.costCents) * 100) : undefined} />
            <Kpi label="Realized" value={signed(pos.realizedCents)} tone={pos.realizedCents}
              sub={pos.soldQuantity ? `${pos.soldQuantity} sold` : "nothing sold yet"} />
          </div>
          <p className="-mt-3 text-xs text-slate">
            {pos.quantity > 0 && pos.lots[0] ? `Held since ${fmtDate(pos.lots[0].date)}. ` : pos.quantity === 0 ? "Sold completely. " : ""}
            Valued at the fair price, item only{region === "eu" ? " (EU sellers)" : ""}.
          </p>

          {multi && (
            <section aria-labelledby="split-title">
              <h3 id="split-title" className="display text-xl">By portfolio</h3>
              <div className="relative mt-2 overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="text-left text-slate">
                    <tr className="border-b border-line">
                      <th className="py-2 font-normal">Portfolio</th>
                      <th className="py-2 text-right font-normal">Qty</th>
                      <th className="py-2 text-right font-normal">Avg. cost</th>
                      <th className="py-2 text-right font-normal">Value</th>
                      <th className="py-2 text-right font-normal">Profit / loss</th>
                      <th className="py-2 text-right font-normal">Realized</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parts.map((r) => {
                      const rpl = r.valueCents === null ? null : r.valueCents - r.costCents;
                      return (
                        <tr key={r.depotId} className="border-b border-line">
                          <td className="py-2"><button type="button" onClick={() => scope.select(r.depotId)} className="text-cobalt hover:underline">{scope.depotName(r.depotId)}</button></td>
                          <td className="num py-2 text-right">{r.quantity}</td>
                          <td className="num py-2 text-right">{r.quantity ? eur(Math.round(r.costCents / r.quantity)) : "–"}</td>
                          <td className="num py-2 text-right font-semibold">{eur(r.valueCents)}</td>
                          <td className={`num py-2 text-right ${trendClass(rpl)}`}>{rpl === null ? "–" : signed(rpl)}</td>
                          <td className={`num py-2 text-right ${trendClass(r.realizedCents)}`}>{signed(r.realizedCents)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <Chart txns={txns} game={game} productId={productId} lang={lang} held={pos.quantity} />

          <section aria-labelledby="txn-title">
            <h3 id="txn-title" className="display text-xl">Transactions</h3>
            <div className="relative mt-2 overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-left text-slate">
                  <tr className="border-b border-line">
                    <th className="py-2 font-normal">Date</th>
                    <th className="py-2 font-normal">Type</th>
                    {multi && <th className="py-2 font-normal">Portfolio</th>}
                    <th className="py-2 text-right font-normal">Qty</th>
                    <th className="py-2 text-right font-normal">Per item</th>
                    <th className="py-2 text-right font-normal">Total</th>
                    <th className="py-2 pl-4 font-normal">Note</th>
                    <th className="py-2"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((t) => (
                    <tr key={t.id} className="border-b border-line align-top">
                      <td className="num py-2 pr-3 whitespace-nowrap">{fmtDate(t.trade_date)}</td>
                      <td className="py-2 pr-3">
                        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${t.kind === "buy" ? "bg-cobalt-soft text-cobalt" : "bg-up-soft text-up"}`}>
                          {t.kind === "buy" ? "Buy" : "Sell"}
                        </span>
                      </td>
                      {multi && <td className="py-2 pr-3">{scope.depotName(t.depot_id)}</td>}
                      <td className="num py-2 text-right">{t.quantity}</td>
                      <td className="num py-2 text-right">{money(t.unit_price_cents / 100)}</td>
                      <td className="num py-2 text-right font-semibold">{money((t.unit_price_cents * t.quantity) / 100)}</td>
                      <td className="max-w-[220px] py-2 pl-4 break-words text-slate">{t.note}</td>
                      <td className="py-2 pl-3">
                        <span className="flex justify-end gap-3">
                          <button type="button" onClick={() => setDialog({ editing: t })} className="text-sm text-cobalt hover:underline">Edit</button>
                          <button type="button" onClick={() => setDeleting(t)} className="text-sm text-slate hover:text-down">Delete</button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {dialog && (
        <TxnDialog editing={dialog.editing} onClose={() => setDialog(null)}
          prefill={dialog.editing ? undefined : { game, productId, language: lang, depotId: parts.length === 1 ? parts[0].depotId : undefined }} />
      )}
      {deleting && <DeleteTxnDialog txn={deleting} all={scope.allTxns} onClose={() => setDeleting(null)} />}
    </PortfolioShell>
  );
}

export default function PositionPage({ params }: { params: Promise<{ game: string; id: string; lang: string }> }) {
  const { game, id, lang } = use(params);
  return (
    <NeedsAccounts>
      <RequireUser>{() => <Suspense><Position game={game} productId={Number(id)} lang={lang as Lang} /></Suspense>}</RequireUser>
    </NeedsAccounts>
  );
}

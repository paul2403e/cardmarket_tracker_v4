"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { NeedsAccounts } from "@/components/account/Form";
import { RequireUser } from "@/components/account/RequireUser";
import { LangBadge } from "@/components/LangBadge";
import { Thumb } from "@/components/ProductRow";
import { GameFilter, useGameFilter } from "@/components/portfolio/GameFilter";
import { TxnDialog, type Prefill } from "@/components/portfolio/TxnDialog";
import { money, pct, trendClass } from "@/lib/format";
import { gameHref, gameOf } from "@/lib/games";
import { api, positions, usePortfolio, type Depot } from "@/lib/portfolio";
import { useSettings } from "@/lib/settings";
import { merge, useCatalogs, valuate, type Valued } from "@/lib/valuation";

const eur = (cents: number | null) => (cents === null ? "–" : money(cents / 100));
const signed = (cents: number) => `${cents > 0 ? "+" : cents < 0 ? "−" : "±"}${money(Math.abs(cents) / 100)}`;
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: number }) {
  return (
    <div className="rounded-[var(--radius-panel)] bg-surface p-4 ring-1 ring-line">
      <p className="text-sm text-slate">{label}</p>
      <p className={`display num mt-1 text-2xl ${tone === undefined ? "" : trendClass(tone)}`}>{value}</p>
      {sub && <p className={`num text-sm ${tone === undefined ? "text-slate" : trendClass(tone)}`}>{sub}</p>}
    </div>
  );
}

function DepotTabs({ depots, current, onSelect }: { depots: Depot[]; current: string; onSelect: (id: string) => void }) {
  return (
    <div role="tablist" aria-label="Portfolio" className="flex flex-wrap gap-1">
      {[{ id: "all", name: "All portfolios" }, ...depots].map((d) => (
        <button key={d.id} role="tab" type="button" aria-selected={current === d.id} onClick={() => onSelect(d.id)}
          className={`rounded-[var(--radius-control)] px-4 py-1.5 text-sm ${
            current === d.id ? "bg-ink font-semibold text-white" : "text-slate ring-1 ring-line hover:text-ink"
          }`}>
          {d.name}
        </button>
      ))}
    </div>
  );
}

function ManageDepot({ depot, count, onDeleted }: { depot: Depot; count: number; onDeleted: () => void }) {
  const { mutate } = usePortfolio();
  const [name, setName] = useState(depot.name);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function rename(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || name.trim() === depot.name) return;
    try {
      await api.renameDepot(depot.id, name);
      await mutate();
      setMsg("Renamed.");
    } catch {
      setMsg("Could not rename. Please try again.");
    }
  }
  async function remove() {
    try {
      await api.deleteDepot(depot.id);
      await mutate();
      onDeleted();
    } catch {
      setMsg("Could not delete. Please try again.");
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-panel)] bg-surface p-4 ring-1 ring-line">
      <form onSubmit={rename} className="flex items-center gap-2">
        <label className="text-sm text-slate" htmlFor="depot-name">Name</label>
        <input id="depot-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
          className="h-9 rounded-[var(--radius-control)] border border-line px-3 outline-none focus:border-cobalt" />
        <button type="submit" className="h-9 rounded-[var(--radius-control)] px-3 text-sm ring-1 ring-line hover:ring-ink">Rename</button>
      </form>
      {confirm ? (
        <span className="flex items-center gap-2 text-sm">
          Delete “{depot.name}” and its {count} transaction{count === 1 ? "" : "s"}?
          <button type="button" onClick={remove} className="h-9 rounded-[var(--radius-control)] bg-down px-3 font-semibold text-white">Delete</button>
          <button type="button" onClick={() => setConfirm(false)} className="h-9 rounded-[var(--radius-control)] px-3 ring-1 ring-line">Cancel</button>
        </span>
      ) : (
        <button type="button" onClick={() => setConfirm(true)} className="h-9 rounded-[var(--radius-control)] px-3 text-sm text-down ring-1 ring-line hover:ring-down">
          Delete portfolio
        </button>
      )}
      {msg && <span className="text-sm text-slate" role="status">{msg}</span>}
    </div>
  );
}

function PositionsTable({ rows, onAdd }: { rows: Valued[]; onAdd: (p: Prefill) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-sm">
        <thead className="text-left text-slate">
          <tr className="border-b border-line">
            <th className="py-2 font-normal">Product</th>
            <th className="py-2 text-right font-normal">Qty</th>
            <th className="py-2 text-right font-normal">Avg. cost</th>
            <th className="py-2 text-right font-normal">Fair price</th>
            <th className="py-2 text-right font-normal">Value</th>
            <th className="py-2 text-right font-normal">Profit / loss</th>
            <th className="py-2 pl-4 font-normal">Held since</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pl = r.valueCents === null ? null : r.valueCents - r.costCents;
            const plPct = pl === null || r.costCents === 0 ? null : (pl / r.costCents) * 100;
            const game = gameOf(r.game);
            return (
              <tr key={r.key} className="border-b border-line align-middle">
                <td className="py-2 pr-4">
                  <Link href={game ? `${gameHref(game, `/product/${r.productId}`)}?lang=${r.language}` : "#"}
                    className="flex items-center gap-3 hover:text-cobalt">
                    <Thumb src={r.product?.image ?? null} category={r.product?.category} size={40} />
                    <span className="min-w-0">
                      <span className="block font-semibold">{r.product?.name ?? r.productName ?? `#${r.productId}`}</span>
                      <span className="flex items-center gap-2 text-xs text-slate">
                        <LangBadge lang={r.language} /> {game?.name}
                      </span>
                    </span>
                  </Link>
                  {r.oversold > 0 && (
                    <p className="mt-1 text-xs text-down">More sold than bought ({r.oversold}) – please check the transactions.</p>
                  )}
                </td>
                <td className="num py-2 text-right">{r.quantity}</td>
                <td className="num py-2 text-right">{eur(Math.round(r.costCents / r.quantity))}</td>
                <td className="num py-2 text-right">
                  {eur(r.priceCents)}
                  {r.priceDay && <span className="block text-xs text-slate">from {fmtDate(r.priceDay)}</span>}
                </td>
                <td className="num py-2 text-right font-semibold">{eur(r.valueCents)}</td>
                <td className={`num py-2 text-right ${trendClass(pl)}`}>
                  {pl === null ? "–" : signed(pl)}
                  {plPct !== null && <span className="block text-xs">{pct(plPct)}</span>}
                </td>
                <td className="py-2 pl-4 text-slate">{r.lots[0] ? fmtDate(r.lots[0].date) : "–"}</td>
                <td className="py-2 pl-2 text-right">
                  <button type="button" onClick={() => onAdd({ game: r.game, productId: r.productId, language: r.language })}
                    aria-label="Add transaction for this product" title="Buy or sell more"
                    className="grid h-8 w-8 place-items-center rounded-full text-lg leading-none text-cobalt ring-1 ring-line hover:bg-cobalt hover:text-white">
                    +
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Portfolio() {
  const { data, error } = usePortfolio();
  const { region } = useSettings();
  const showGame = useGameFilter();
  const router = useRouter();
  const params = useSearchParams();
  const [dialog, setDialog] = useState<{ prefill?: Prefill } | null>(null);
  const depots = useMemo(() => data?.depots ?? [], [data]);
  const wanted = params.get("p") ?? "all";
  const current = wanted === "all" || depots.some((d) => d.id === wanted) ? wanted : "all";
  const select = (id: string) => router.replace(id === "all" ? "/portfolio" : `/portfolio?p=${id}`, { scroll: false });

  const txns = useMemo(
    () => (data?.txns ?? []).filter((t) => showGame(t.game) && (current === "all" || t.depot_id === current)),
    [data, current, showGame],
  );
  const games = useMemo(() => new Set((data?.txns ?? []).map((t) => t.game)), [data]);
  const catalogs = useCatalogs(games);

  const rows = useMemo(() => {
    const pos = positions(txns);
    return (current === "all" ? merge(pos) : pos).map((p) => valuate(p, catalogs, region));
  }, [txns, current, catalogs, region]);
  const open = rows.filter((r) => r.quantity > 0).sort((a, b) => (b.valueCents ?? 0) - (a.valueCents ?? 0));
  const closed = rows.filter((r) => r.quantity === 0 && r.soldQuantity > 0);

  const value = open.reduce((s, r) => s + (r.valueCents ?? 0), 0);
  const priced = open.filter((r) => r.valueCents !== null);
  const cost = open.reduce((s, r) => s + r.costCents, 0);
  const unrealized = priced.reduce((s, r) => s + (r.valueCents! - r.costCents), 0);
  const pricedCost = priced.reduce((s, r) => s + r.costCents, 0);
  const realized = rows.reduce((s, r) => s + r.realizedCents, 0);
  const missing = open.length - priced.length;

  if (error) return <p className="py-10 text-down">Could not load your portfolio. Please reload the page.</p>;
  if (!data) return <p className="py-10 text-slate">Loading portfolio…</p>;

  const depot = depots.find((d) => d.id === current);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-4xl">Portfolio</h1>
          <p className="mt-1 text-slate">Valued at today&apos;s fair price, item only{region === "eu" ? " (EU sellers)" : ""}.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/portfolio/transactions" className="h-10 rounded-[var(--radius-control)] px-4 leading-10 ring-1 ring-line hover:ring-ink">
            Transactions
          </Link>
          <button type="button" onClick={() => setDialog({})}
            className="h-10 rounded-[var(--radius-control)] bg-ink px-4 font-semibold text-white hover:bg-cobalt">
            Add transaction
          </button>
        </div>
      </div>

      {depots.length === 0 ? (
        <section className="rounded-[var(--radius-panel)] bg-surface p-8 text-center ring-1 ring-line">
          <h2 className="display text-2xl">Start your portfolio</h2>
          <p className="mx-auto mt-2 max-w-md text-slate">
            Add your first purchase. You can also use the + next to any product in All products, or “Add to portfolio” on a
            product page.
          </p>
          <button type="button" onClick={() => setDialog({})}
            className="mt-5 h-10 rounded-[var(--radius-control)] bg-ink px-5 font-semibold text-white hover:bg-cobalt">
            Add first purchase
          </button>
        </section>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <DepotTabs depots={depots} current={current} onSelect={select} />
            <GameFilter />
          </div>
          {depot && (
            <ManageDepot key={depot.id} depot={depot} count={data.txns.filter((t) => t.depot_id === depot.id).length}
              onDeleted={() => select("all")} />
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Value" value={eur(value)} sub={missing ? `${missing} without a price` : `${open.length} positions`} />
            <Kpi label="Invested" value={eur(cost)} sub="cost of what you hold" />
            <Kpi label="Unrealized" value={signed(unrealized)} tone={unrealized}
              sub={pricedCost ? pct((unrealized / pricedCost) * 100) : undefined} />
            <Kpi label="Realized" value={signed(realized)} tone={realized} sub="from sales (FIFO)" />
          </div>

          <section aria-labelledby="open-title">
            <h2 id="open-title" className="display text-2xl">Holdings</h2>
            {open.length ? (
              <div className="mt-3"><PositionsTable rows={open} onAdd={(p) => setDialog({ prefill: p })} /></div>
            ) : (
              <p className="mt-3 text-slate">Nothing held here{txns.length ? " – everything is sold" : ""}.</p>
            )}
          </section>

          {closed.length > 0 && (
            <section aria-labelledby="closed-title">
              <h2 id="closed-title" className="display text-2xl">Sold completely</h2>
              <ul className="mt-3 divide-y divide-line">
                {closed.map((r) => (
                  <li key={r.key} className="flex items-center justify-between gap-4 py-2 text-sm">
                    <span className="flex min-w-0 items-center gap-3">
                      <Thumb src={r.product?.image ?? null} category={r.product?.category} size={32} />
                      <span className="truncate">{r.product?.name ?? r.productName}</span>
                      <LangBadge lang={r.language} />
                    </span>
                    <span className={`num shrink-0 ${trendClass(r.realizedCents)}`}>{signed(r.realizedCents)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {dialog && <TxnDialog prefill={dialog.prefill} onClose={() => setDialog(null)} />}
    </div>
  );
}

export default function PortfolioPage() {
  return (
    <NeedsAccounts>
      <RequireUser>{() => <Suspense><Portfolio /></Suspense>}</RequireUser>
    </NeedsAccounts>
  );
}

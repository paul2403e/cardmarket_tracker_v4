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
import { HoldButton } from "@/components/HoldButton";
import { money, pct, trendClass } from "@/lib/format";
import { gameHref, gameOf } from "@/lib/games";
import { api, applyRemoval, positions, removalPlan, usePortfolio, type Depot, type Txn } from "@/lib/portfolio";
import { useSettings } from "@/lib/settings";
import { useCatalogs, valuate, type Valued } from "@/lib/valuation";

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

function ManageDepot({ depot, txns, value, onDeleted }: {
  depot: Depot; txns: Txn[]; value: number; onDeleted: () => void;
}) {
  const { mutate } = usePortfolio();
  const [name, setName] = useState(depot.name);
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const sentence = `I am sure I want to delete the portfolio "${depot.name}"`;
  const held = positions(txns).filter((p) => p.quantity > 0).length;
  const sold = txns.some((t) => t.kind === "sell");

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
    <div className="rounded-[var(--radius-panel)] bg-surface p-4 ring-1 ring-line">
      <div className="flex flex-wrap items-center gap-3">
        <form onSubmit={rename} className="flex items-center gap-2">
          <label className="text-sm text-slate" htmlFor="depot-name">Name</label>
          <input id="depot-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
            className="h-9 rounded-[var(--radius-control)] border border-line px-3 outline-none focus:border-cobalt" />
          <button type="submit" className="h-9 rounded-[var(--radius-control)] px-3 text-sm ring-1 ring-line hover:ring-ink">Rename</button>
        </form>
        {!deleting && (
          <button type="button" onClick={() => setDeleting(true)}
            className="h-9 rounded-[var(--radius-control)] px-3 text-sm text-down ring-1 ring-line hover:ring-down">
            Delete portfolio…
          </button>
        )}
        {msg && <span className="text-sm text-slate" role="status">{msg}</span>}
      </div>
      {deleting && (
        <div className="mt-4 max-w-xl rounded-lg bg-down-soft p-4 text-sm">
          <p className="font-semibold text-down">Deleting “{depot.name}” can&apos;t be undone. It removes:</p>
          <ul className="mt-2 list-disc pl-5 text-ink">
            <li>{held} position{held === 1 ? "" : "s"} you hold, worth {eur(value)} today</li>
            <li>all {txns.length} transaction{txns.length === 1 ? "" : "s"} – every purchase and sale in it</li>
            {sold && <li>the realized profit or loss from its sales</li>}
            <li>it from your totals in “All portfolios”</li>
          </ul>
          <label htmlFor="delete-sentence" className="mt-3 block">
            To confirm, type: <span className="font-semibold select-all">{sentence}</span>
          </label>
          <input id="delete-sentence" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off"
            className="mt-2 h-10 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 outline-none focus:border-down" />
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={remove} disabled={typed.trim() !== sentence}
              className="h-10 rounded-[var(--radius-control)] bg-down px-4 font-semibold text-white disabled:opacity-40">
              Delete portfolio
            </button>
            <button type="button" onClick={() => { setDeleting(false); setTyped(""); }}
              className="h-10 rounded-[var(--radius-control)] bg-surface px-4 ring-1 ring-line">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Position entfernen (Fehleingabe): ganze Position oder einzelne Stücke; Halte-Knopf zum Bestätigen. */
function RemoveDialog({ row, txns, depotName, onClose }: { row: Valued; txns: Txn[]; depotName: string; onClose: () => void }) {
  const { mutate } = usePortfolio();
  const [units, setUnits] = useState(String(row.quantity));
  const [error, setError] = useState<string | null>(null);
  const n = Number(units);
  const valid = Number.isInteger(n) && n >= 1 && n <= row.quantity;
  async function confirm() {
    try {
      await applyRemoval(removalPlan(txns, row, n));
      await mutate();
      onClose();
    } catch {
      setError("Could not remove. Please try again.");
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="remove-title" className="w-full max-w-md rounded-[var(--radius-panel)] bg-surface p-6 shadow-2xl">
        <h2 id="remove-title" className="display text-2xl">Remove position</h2>
        <p className="mt-2 font-semibold">{row.product?.name ?? row.productName}</p>
        <p className="text-sm text-slate">{depotName} · {row.quantity} held</p>
        <label htmlFor="remove-units" className="mt-4 block text-sm font-semibold">Items to remove</label>
        <div className="mt-1 flex items-center gap-2">
          <input id="remove-units" type="number" min={1} max={row.quantity} step={1} value={units}
            onChange={(e) => setUnits(e.target.value)}
            className="num h-10 w-28 rounded-[var(--radius-control)] border border-line px-3 outline-none focus:border-cobalt" />
          <span className="text-sm text-slate">of {row.quantity}{n === row.quantity ? " (whole position)" : ""}</span>
        </div>
        <p className="mt-4 rounded-lg bg-down-soft px-3 py-2 text-sm text-down">
          This removes the items permanently, as if they were never bought – it can&apos;t be undone. Use it to fix a wrong
          entry. <strong>If you sold them, use Sell instead</strong> so your profit is recorded. Sales you already entered
          stay as they are.
        </p>
        {error && <p role="alert" className="mt-3 text-sm text-down">{error}</p>}
        <div className="mt-4 flex flex-col gap-2">
          <HoldButton onConfirm={confirm} disabled={!valid}>
            {valid ? `Hold to remove ${n} item${n === 1 ? "" : "s"}` : "Enter a valid number"}
          </HoldButton>
          <button type="button" onClick={onClose} className="h-10 rounded-[var(--radius-control)] ring-1 ring-line">Cancel</button>
        </div>
      </div>
    </div>
  );
}

type SortKey = "product" | "portfolio" | "qty" | "avg" | "price" | "value" | "pl" | "since";

function SortHead({ id, label, sort, setSort, right = false }: {
  id: SortKey; label: string; sort: { key: SortKey; dir: 1 | -1 }; setSort: (k: SortKey) => void; right?: boolean;
}) {
  const active = sort.key === id;
  return (
    <th className={`py-2 font-normal ${right ? "text-right" : ""}`}
      aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => setSort(id)} className={`inline-flex items-center gap-1 hover:text-ink ${active ? "font-semibold text-ink" : ""}`}>
        {label}
        <span aria-hidden className="w-3 text-xs">{active ? (sort.dir === 1 ? "↑" : "↓") : ""}</span>
      </button>
    </th>
  );
}

function sortValue(r: Valued, key: SortKey, depotName: (id: string) => string): string | number | null {
  switch (key) {
    case "product": return (r.product?.name ?? r.productName ?? "").toLowerCase();
    case "portfolio": return depotName(r.depotId).toLowerCase();
    case "qty": return r.quantity;
    case "avg": return r.costCents / r.quantity;
    case "price": return r.priceCents;
    case "value": return r.valueCents;
    case "pl": return r.valueCents === null ? null : r.valueCents - r.costCents;
    case "since": return r.lots[0]?.date ?? null;
  }
}

function PositionsTable({ rows, showDepot, depotName, onTrade, onRemove }: {
  rows: Valued[];
  showDepot: boolean;
  depotName: (id: string) => string;
  onTrade: (p: Prefill) => void;
  onRemove: (r: Valued) => void;
}) {
  const [sort, setSortState] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "value", dir: -1 });
  const setSort = (key: SortKey) =>
    setSortState((cur) => cur.key === key ? { key, dir: cur.dir === 1 ? -1 : 1 } : { key, dir: key === "product" || key === "portfolio" ? 1 : -1 });
  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const x = sortValue(a, sort.key, depotName);
    const y = sortValue(b, sort.key, depotName);
    if (x === null) return y === null ? 0 : 1; // ohne Wert immer unten
    if (y === null) return -1;
    return sort.dir * (typeof x === "string" ? x.localeCompare(y as string) : x - (y as number));
  }), [rows, sort, depotName]);
  const head = { sort, setSort };
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[920px] text-sm">
        <thead className="text-left text-slate">
          <tr className="border-b border-line">
            <SortHead id="product" label="Product" {...head} />
            {showDepot && <SortHead id="portfolio" label="Portfolio" {...head} />}
            <SortHead id="qty" label="Qty" right {...head} />
            <SortHead id="avg" label="Avg. cost" right {...head} />
            <SortHead id="price" label="Fair price" right {...head} />
            <SortHead id="value" label="Value" right {...head} />
            <SortHead id="pl" label="Profit / loss" right {...head} />
            <th className="py-2 pl-4 font-normal" aria-sort={sort.key === "since" ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
              <button type="button" onClick={() => setSort("since")} className={`inline-flex items-center gap-1 hover:text-ink ${sort.key === "since" ? "font-semibold text-ink" : ""}`}>
                Held since<span aria-hidden className="w-3 text-xs">{sort.key === "since" ? (sort.dir === 1 ? "↑" : "↓") : ""}</span>
              </button>
            </th>
            <th className="py-2"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const pl = r.valueCents === null ? null : r.valueCents - r.costCents;
            const plPct = pl === null || r.costCents === 0 ? null : (pl / r.costCents) * 100;
            const game = gameOf(r.game);
            const name = r.product?.name ?? r.productName ?? `#${r.productId}`;
            return (
              <tr key={r.key} className="border-b border-line align-middle">
                <td className="py-2 pr-4">
                  <Link href={game ? `${gameHref(game, `/product/${r.productId}`)}?lang=${r.language}` : "#"}
                    className="flex items-center gap-3 hover:text-cobalt">
                    <Thumb src={r.product?.image ?? null} category={r.product?.category} size={40} />
                    <span className="min-w-0">
                      <span className="block font-semibold">{name}</span>
                      <span className="flex items-center gap-2 text-xs text-slate">
                        <LangBadge lang={r.language} /> {game?.name}
                      </span>
                    </span>
                  </Link>
                  {r.oversold > 0 && (
                    <p className="mt-1 text-xs text-down">More sold than bought ({r.oversold}) – please check the transactions.</p>
                  )}
                </td>
                {showDepot && <td className="py-2 pr-4">{depotName(r.depotId)}</td>}
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
                <td className="py-2 pl-2">
                  <span className="flex justify-end gap-1.5">
                    <button type="button"
                      onClick={() => onTrade({ game: r.game, productId: r.productId, language: r.language, depotId: r.depotId })}
                      aria-label={`Buy or sell ${name}`} title="Buy or sell"
                      className="h-8 rounded-full px-2.5 text-sm font-semibold text-cobalt ring-1 ring-line hover:bg-cobalt hover:text-white hover:ring-cobalt">
                      +/−
                    </button>
                    <button type="button" onClick={() => onRemove(r)} aria-label={`Remove ${name}`} title="Remove position (wrong entry)"
                      className="grid h-8 w-8 place-items-center rounded-full text-slate ring-1 ring-line hover:text-down hover:ring-down">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                        strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                      </svg>
                    </button>
                  </span>
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
  const [removing, setRemoving] = useState<Valued | null>(null);
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

  // eine Zeile je Portfolio + Produkt + Sprache (auch bei "All portfolios")
  const rows = useMemo(() => positions(txns).map((p) => valuate(p, catalogs, region)), [txns, catalogs, region]);
  const depotName = useMemo(() => {
    const names = Object.fromEntries(depots.map((d) => [d.id, d.name]));
    return (id: string) => names[id] ?? "–";
  }, [depots]);
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
          <Link href="/portfolio/excel" className="h-10 rounded-[var(--radius-control)] px-4 leading-10 ring-1 ring-line hover:ring-ink">
            Excel
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
            Add your first purchase. You can also use the + next to any product in All products, “Add to portfolio” on a
            product page, or import a whole collection from <Link href="/portfolio/excel" className="text-cobalt hover:underline">Excel</Link>.
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
            <ManageDepot key={depot.id} depot={depot} txns={data.txns.filter((t) => t.depot_id === depot.id)}
              value={open.reduce((sum, r) => sum + (r.valueCents ?? 0), 0)} onDeleted={() => select("all")} />
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
              <div className="mt-3">
                <PositionsTable rows={open} showDepot={current === "all" && depots.length > 1} depotName={depotName}
                  onTrade={(p) => setDialog({ prefill: p })} onRemove={setRemoving} />
              </div>
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
                      {current === "all" && depots.length > 1 && <span className="text-xs text-slate">{depotName(r.depotId)}</span>}
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
      {removing && (
        <RemoveDialog row={removing} txns={data.txns} depotName={depotName(removing.depotId)} onClose={() => setRemoving(null)} />
      )}
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

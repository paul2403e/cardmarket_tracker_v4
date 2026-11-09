"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { NeedsAccounts } from "@/components/account/Form";
import { RequireUser } from "@/components/account/RequireUser";
import { LangBadge } from "@/components/LangBadge";
import { GameFilter, useGameFilter } from "@/components/portfolio/GameFilter";
import { TxnDialog } from "@/components/portfolio/TxnDialog";
import { HoldButton } from "@/components/HoldButton";
import { LANG_SHORT, money } from "@/lib/format";
import { gameOf } from "@/lib/games";
import { api, usePortfolio, wouldOversell, type Txn } from "@/lib/portfolio";

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function DeleteDialog({ txn, all, onClose }: { txn: Txn; all: Txn[]; onClose: () => void }) {
  const { mutate } = usePortfolio();
  const [error, setError] = useState<string | null>(null);
  const blocked = wouldOversell(all.filter((t) => t.id !== txn.id));
  const what = `${txn.quantity} × ${txn.product_name ?? `#${txn.product_id}`} (${LANG_SHORT[txn.language]})`;
  async function remove() {
    try {
      await api.deleteTxn(txn.id);
      await mutate();
      onClose();
    } catch {
      setError("Could not delete. Please try again.");
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex overflow-y-auto bg-ink/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="del-title" className="m-auto w-full max-w-md rounded-[var(--radius-panel)] bg-surface p-6 shadow-2xl">
        <h2 id="del-title" className="display text-2xl">Delete {txn.kind === "buy" ? "purchase" : "sale"}</h2>
        <p className="mt-2 font-semibold">{what}</p>
        <p className="text-sm text-slate">{fmtDate(txn.trade_date)} · {money(txn.unit_price_cents / 100)} per item</p>
        {blocked ? (
          <p className="mt-4 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
            These items were already sold. Delete the sale first, then this purchase.
          </p>
        ) : (
          <p className="mt-4 rounded-lg bg-down-soft px-3 py-2 text-sm text-down">
            {txn.kind === "sell"
              ? "The sold items go back into your holdings exactly as before, and the profit from this sale disappears. "
              : "These items disappear from your holdings, as if they were never bought. "}
            This can&apos;t be undone.
          </p>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-down">{error}</p>}
        <div className="mt-4 flex flex-col gap-2">
          {!blocked && <HoldButton onConfirm={remove}>Hold to delete</HoldButton>}
          <button type="button" onClick={onClose} className="h-10 rounded-[var(--radius-control)] ring-1 ring-line">
            {blocked ? "OK" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Transactions() {
  const { data, error } = usePortfolio();
  const showGame = useGameFilter();
  const [depot, setDepot] = useState("all");
  const [editing, setEditing] = useState<Txn | null>(null);
  const [deleting, setDeleting] = useState<Txn | null>(null);
  const [adding, setAdding] = useState(false);
  const depots = useMemo(() => data?.depots ?? [], [data]);
  const names = useMemo(() => Object.fromEntries(depots.map((d) => [d.id, d.name])), [depots]);
  const rows = useMemo(
    () => [...(data?.txns ?? [])]
      .filter((t) => showGame(t.game) && (depot === "all" || t.depot_id === depot))
      .sort((a, b) => b.trade_date.localeCompare(a.trade_date) || b.created_at.localeCompare(a.created_at)),
    [data, depot, showGame],
  );

  if (error) return <p className="py-10 text-down">Could not load your transactions. Please reload the page.</p>;
  if (!data) return <p className="py-10 text-slate">Loading…</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/portfolio" className="text-sm text-cobalt hover:underline">← Portfolio</Link>
          <h1 className="display mt-1 text-4xl">Transactions</h1>
        </div>
        <button type="button" onClick={() => setAdding(true)}
          className="h-10 rounded-[var(--radius-control)] bg-ink px-4 font-semibold text-white hover:bg-cobalt">
          Add transaction
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <select aria-label="Portfolio" value={depot} onChange={(e) => setDepot(e.target.value)}
          className="h-9 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm">
          <option value="all">All portfolios</option>
          {depots.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <GameFilter />
      </div>

      {rows.length === 0 ? (
        <p className="text-slate">No transactions yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="text-left text-slate">
              <tr className="border-b border-line">
                <th className="py-2 font-normal">Date</th>
                <th className="py-2 font-normal">Type</th>
                <th className="py-2 font-normal">Product</th>
                <th className="py-2 font-normal">Portfolio</th>
                <th className="py-2 text-right font-normal">Qty</th>
                <th className="py-2 text-right font-normal">Per item</th>
                <th className="py-2 text-right font-normal">Total</th>
                <th className="py-2 pl-4 font-normal">Note</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="border-b border-line align-top">
                  <td className="num py-2 pr-3 whitespace-nowrap">{fmtDate(t.trade_date)}</td>
                  <td className="py-2 pr-3">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${t.kind === "buy" ? "bg-cobalt-soft text-cobalt" : "bg-up-soft text-up"}`}>
                      {t.kind === "buy" ? "Buy" : "Sell"}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <span className="block font-semibold">{t.product_name ?? `#${t.product_id}`}</span>
                    <span className="flex items-center gap-2 text-xs text-slate"><LangBadge lang={t.language} /> {gameOf(t.game)?.name}</span>
                  </td>
                  <td className="py-2 pr-3">{names[t.depot_id] ?? "–"}</td>
                  <td className="num py-2 text-right">{t.quantity}</td>
                  <td className="num py-2 text-right">{money(t.unit_price_cents / 100)}</td>
                  <td className="num py-2 text-right font-semibold">{money((t.unit_price_cents * t.quantity) / 100)}</td>
                  <td className="max-w-[220px] py-2 pl-4 break-words text-slate">{t.note}</td>
                  <td className="py-2 pl-3">
                    <span className="flex justify-end gap-3">
                      <button type="button" onClick={() => setEditing(t)} className="text-sm text-cobalt hover:underline">Edit</button>
                      <button type="button" onClick={() => setDeleting(t)} className="text-sm text-slate hover:text-down">Delete</button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <TxnDialog editing={editing} onClose={() => setEditing(null)} />}
      {deleting && <DeleteDialog txn={deleting} all={data.txns} onClose={() => setDeleting(null)} />}
      {adding && <TxnDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

export default function TransactionsPage() {
  return (
    <NeedsAccounts>
      <RequireUser>{() => <Suspense><Transactions /></Suspense>}</RequireUser>
    </NeedsAccounts>
  );
}

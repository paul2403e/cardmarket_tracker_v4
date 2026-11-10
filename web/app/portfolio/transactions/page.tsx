"use client";

import { Suspense, useMemo, useState } from "react";
import { NeedsAccounts } from "@/components/account/Form";
import { RequireUser } from "@/components/account/RequireUser";
import { LangBadge } from "@/components/LangBadge";
import { PortfolioShell, useScope } from "@/components/portfolio/Shell";
import { SortTh, nextSort, type Sort } from "@/components/portfolio/SortTh";
import { TxnDialog } from "@/components/portfolio/TxnDialog";
import { DeleteTxnDialog } from "@/components/portfolio/DeleteTxnDialog";
import { money } from "@/lib/format";
import { gameOf } from "@/lib/games";
import { usePortfolio, type Txn } from "@/lib/portfolio";

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });


type Key = "date" | "kind" | "product" | "portfolio" | "qty" | "price" | "total" | "note";
const TEXT_KEYS: Key[] = ["kind", "product", "portfolio", "note"];

function Transactions() {
  const scope = useScope();
  const { error } = usePortfolio();
  const [editing, setEditing] = useState<Txn | null>(null);
  const [deleting, setDeleting] = useState<Txn | null>(null);
  const [sort, setSort] = useState<Sort<Key>>({ key: "date", dir: -1 });
  const onSort = (k: Key) => setSort((cur) => nextSort(cur, k, TEXT_KEYS));
  const names = scope?.depotName;
  const rows = useMemo(() => {
    if (!scope) return [];
    const val = (t: Txn): string | number => {
      switch (sort.key) {
        case "date": return `${t.trade_date}|${t.created_at}`;
        case "kind": return t.kind;
        case "product": return (t.product_name ?? "").toLowerCase();
        case "portfolio": return scope.depotName(t.depot_id).toLowerCase();
        case "qty": return t.quantity;
        case "price": return t.unit_price_cents;
        case "total": return t.unit_price_cents * t.quantity;
        case "note": return (t.note ?? "").toLowerCase();
      }
    };
    return [...scope.txns].sort((a, b) => {
      const x = val(a), y = val(b);
      return sort.dir * (typeof x === "string" ? x.localeCompare(y as string) : x - (y as number));
    });
  }, [scope, sort]);

  if (error) return <p className="py-10 text-down">Could not load your transactions. Please reload the page.</p>;
  if (!scope) return <p className="py-10 text-slate">Loading…</p>;
  const head = { sort, onSort };

  return (
    <PortfolioShell scope={scope}>
      {rows.length === 0 ? (
        <p className="text-slate">No transactions yet.</p>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="text-left text-slate">
              <tr className="border-b border-line">
                <SortTh id="date" label="Date" {...head} />
                <SortTh id="kind" label="Type" {...head} />
                <SortTh id="product" label="Product" {...head} />
                <SortTh id="portfolio" label="Portfolio" {...head} />
                <SortTh id="qty" label="Qty" right {...head} />
                <SortTh id="price" label="Per item" right {...head} />
                <SortTh id="total" label="Total" right {...head} />
                <SortTh id="note" label="Note" {...head} />
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
                  <td className="py-2 pr-3">{names!(t.depot_id)}</td>
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
      {deleting && <DeleteTxnDialog txn={deleting} all={scope.allTxns} onClose={() => setDeleting(null)} />}
    </PortfolioShell>
  );
}

export default function TransactionsPage() {
  return (
    <NeedsAccounts>
      <RequireUser>{() => <Suspense><Transactions /></Suspense>}</RequireUser>
    </NeedsAccounts>
  );
}

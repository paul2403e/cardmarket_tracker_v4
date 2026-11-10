"use client";

// Transaktion löschen (Halte-Knopf). Ein Kauf, dessen Stück schon verkauft sind, kann erst nach dem Verkauf weg.
import { useState } from "react";
import { createPortal } from "react-dom";
import { HoldButton } from "@/components/HoldButton";
import { LANG_SHORT, money } from "@/lib/format";
import { api, usePortfolio, wouldOversell, type Txn } from "@/lib/portfolio";

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function DeleteTxnDialog({ txn, all, onClose }: { txn: Txn; all: Txn[]; onClose: () => void }) {
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
  return createPortal(
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
    </div>,
    document.body,
  );
}

"use client";

// Portfolio umbenennen oder löschen. Öffnet sich über den Stift neben dem gewählten Portfolio (Kopf aller Portfolio-Seiten).
import { useState } from "react";
import { api, positions, usePortfolio, type Depot, type Txn } from "@/lib/portfolio";
import { useSettings } from "@/lib/settings";
import { useCatalogs, valuate } from "@/lib/valuation";
import { eur } from "./ui";

export function ManageDepot({ depot, txns, onDeleted, onClose }: {
  depot: Depot; txns: Txn[]; onDeleted: () => void; onClose: () => void;
}) {
  const { mutate } = usePortfolio();
  const { region } = useSettings();
  const catalogs = useCatalogs(new Set(txns.map((t) => t.game)));
  const value = positions(txns).filter((p) => p.quantity > 0)
    .reduce((s, p) => s + (valuate(p, catalogs, region).valueCents ?? 0), 0);
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
          <input id="depot-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
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
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto text-2xl leading-none text-slate hover:text-ink">×</button>
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


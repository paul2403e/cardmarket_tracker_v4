"use client";

// Gemeinsamer Kopf aller Portfolio-Seiten: Reiter, Portfolio-Auswahl (in der Adresse: ?p=<id>), Spiele-Schalter.
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { usePortfolio, type Depot, type Txn } from "@/lib/portfolio";
import { FilterRow, GameFilter, useGameFilter } from "./GameFilter";
import { ManageDepot } from "./ManageDepot";
import { TxnDialog } from "./TxnDialog";

const TABS = [
  { href: "/portfolio", label: "Overview" },
  { href: "/portfolio/performance", label: "Performance" },
  { href: "/portfolio/analysis", label: "Analysis" },
  { href: "/portfolio/transactions", label: "Transactions" },
  { href: "/portfolio/excel", label: "Import / Export (Excel)" },
];

export interface Scope {
  depots: Depot[];
  allTxns: Txn[];
  /** gefiltert nach Portfolio-Auswahl und Spielen */
  txns: Txn[];
  current: string; // "all" oder Depot-ID
  select: (id: string) => void;
  depotName: (id: string) => string;
}

/** Portfolio-Auswahl und gefilterte Transaktionen der aktuellen Seite. */
export function useScope(): Scope | null {
  const { data } = usePortfolio();
  const showGame = useGameFilter();
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const depots = useMemo(() => data?.depots ?? [], [data]);
  const wanted = params.get("p") ?? "all";
  const current = wanted === "all" || depots.some((d) => d.id === wanted) ? wanted : "all";
  const txns = useMemo(
    () => (data?.txns ?? []).filter((t) => showGame(t.game) && (current === "all" || t.depot_id === current)),
    [data, current, showGame],
  );
  const depotName = useMemo(() => {
    const names = Object.fromEntries(depots.map((d) => [d.id, d.name]));
    return (id: string) => names[id] ?? "–";
  }, [depots]);
  if (!data) return null;
  return {
    depots, allTxns: data.txns, txns, current, depotName,
    select: (id) => router.replace(id === "all" ? path : `${path}?p=${id}`, { scroll: false }),
  };
}

export function PortfolioShell({ scope, children, showFilters = true, showGames = true }: {
  scope: Scope; children: ReactNode; showFilters?: boolean; showGames?: boolean;
}) {
  const path = usePathname();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null); // Depot-ID, deren Bearbeiten-Zeile offen ist
  const depot = scope.depots.find((d) => d.id === scope.current);
  const q = scope.current === "all" ? "" : `?p=${scope.current}`;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="display text-4xl">Portfolio</h1>
        <button type="button" onClick={() => setAdding(true)}
          className="h-10 rounded-[var(--radius-control)] bg-ink px-4 font-semibold text-white hover:bg-cobalt">
          Add transaction
        </button>
      </div>
      <nav aria-label="Portfolio sections" className="no-scrollbar -mt-2 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line">
        {TABS.map((t) => {
          const active = path === t.href;
          return (
            <Link key={t.href} href={`${t.href}${q}`} aria-current={active ? "page" : undefined}
              className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-[15px] whitespace-nowrap ${
                active ? "border-ink font-semibold text-ink" : "border-transparent text-slate hover:text-ink"
              }`}>
              {t.label}
            </Link>
          );
        })}
      </nav>
      {showFilters && scope.depots.length > 0 && (
        <div className="flex flex-col gap-3">
          <FilterRow label="Portfolio">
            <div role="tablist" aria-label="Portfolio" className="flex flex-wrap gap-1.5">
              {[{ id: "all", name: "All portfolios" }, ...scope.depots].map((d) => {
                const active = scope.current === d.id;
                return (
                  <span key={d.id} className={`inline-flex items-center rounded-[var(--radius-control)] text-sm ${
                    active ? "bg-ink font-semibold text-white" : "text-slate ring-1 ring-line hover:text-ink"}`}>
                    <button role="tab" type="button" aria-selected={active}
                      onClick={() => { scope.select(d.id); setEditing(null); }}
                      className={`py-1.5 ${active && d.id !== "all" ? "pl-4 pr-1.5" : "px-4"}`}>
                      {d.name}
                    </button>
                    {active && d.id !== "all" && (
                      <button type="button" onClick={() => setEditing((e) => (e === d.id ? null : d.id))}
                        aria-label={`Rename or delete ${d.name}`} aria-expanded={editing === d.id} title="Rename or delete"
                        className="mr-1 grid h-7 w-7 place-items-center rounded-full text-white/80 hover:bg-white/15 hover:text-white">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
                          strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                        </svg>
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
          </FilterRow>
          {showGames && (
            <FilterRow label="Games">
              <GameFilter />
            </FilterRow>
          )}
          {depot && editing === depot.id && (
            <ManageDepot key={depot.id} depot={depot} txns={scope.allTxns.filter((t) => t.depot_id === depot.id)}
              onClose={() => setEditing(null)} onDeleted={() => { setEditing(null); scope.select("all"); }} />
          )}
        </div>
      )}
      {children}
      {adding && <TxnDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

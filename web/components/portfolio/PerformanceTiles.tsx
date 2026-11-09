"use client";

// Vier kleine Kacheln: Performance des heutigen Bestands über 7 Tage, 30 Tage, 6 Monate, 1 Jahr.
import { useMemo } from "react";
import { addDays, chunks, performance, timeline, usePriceSeries } from "@/lib/performance";
import { todayIso, type Txn } from "@/lib/portfolio";
import { useSettings } from "@/lib/settings";
import { Kpi, signed, signedPct } from "./ui";

const PERIODS = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "6 months", days: 182 },
  { label: "1 year", days: 365 },
];

export function usePortfolioTimeline(txns: Txn[], includeSold = false) {
  const { region } = useSettings();
  const { series, loading } = usePriceSeries(txns, region);
  const today = todayIso();
  const points = useMemo(
    () => (loading ? [] : timeline(chunks(txns), txns, series, today, includeSold)),
    [txns, series, loading, today, includeSold],
  );
  return { points, loading, today, series };
}

export function PerformanceTiles({ txns }: { txns: Txn[] }) {
  const { points, loading, today } = usePortfolioTimeline(txns);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {PERIODS.map((p) => {
        const r = loading ? null : performance(points, addDays(today, -p.days));
        const approx = r?.estimated ? "≈ " : "";
        return (
          <Kpi key={p.label} small label={`Performance ${p.label}`}
            value={r ? `${approx}${signedPct(r.pct)}` : loading ? "…" : "–"}
            sub={r ? `${approx}${signed(Math.round(r.cents))}` : undefined} tone={r ? r.pct : undefined} />
        );
      })}
    </div>
  );
}

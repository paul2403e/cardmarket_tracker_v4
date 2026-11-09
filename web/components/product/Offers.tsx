"use client";

// Heutige gespeicherte Angebote (die günstigsten je Sortierung) mit Kennzeichnung, ob sie für den Preis zählen.
import { useMemo, useState } from "react";
import { money } from "@/lib/format";
import type { Offer, Region } from "@/lib/types";

const REASON: Record<string, string> = {
  A_schaden: "Damage",
  B_folie_siegel: "Foil or seal",
  C_oeffnen_inhalt: "Opened or incomplete",
  D_risiko: "Flaws possible",
};

function why(o: Offer, region: Region): string | null {
  if (region === "eu" && !o.eu) return "Outside the EU";
  if (o.excluded) {
    const [cat, word] = o.excluded.split(": ");
    return `${REASON[cat] ?? cat}: “${word}”`;
  }
  if (region === "eu" ? o.lockEu : o.lockAll) return "Bait price";
  return null;
}

const SELLER: Record<string, string> = { private: "Private", professional: "Professional", powerseller: "Powerseller" };
const RATING: Record<string, string> = {
  outstanding: "Outstanding", very_good: "Very good", good: "Good", average: "Average", bad: "Bad", none: "No rating yet",
};

export function Offers({ offers, region, incl }: { offers: Offer[]; region: Region; incl: boolean }) {
  const [open, setOpen] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);
  const rows = useMemo(() => {
    const sorted = [...offers].sort((a, b) => (incl ? a.total - b.total : a.price - b.price));
    return sorted.map((o) => ({ o, reason: why(o, region) })).filter((r) => showExcluded || !r.reason);
  }, [offers, region, incl, showExcluded]);
  const excludedCount = offers.filter((o) => why(o, region)).length;

  return (
    <section aria-labelledby="offers-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="offers-title" className="display text-2xl">
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="offers-table"
            className="flex items-center gap-3 text-left">
            <span aria-hidden className={`inline-block text-lg transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
            Cheapest offers today
            <span className="num font-sans text-base font-normal text-slate" style={{ fontStretch: "100%" }}>{offers.length}</span>
          </button>
        </h2>
        {open && excludedCount > 0 && (
          <label className="flex items-center gap-2 text-sm text-slate">
            <input type="checkbox" checked={showExcluded} onChange={(e) => setShowExcluded(e.target.checked)} className="accent-cobalt" />
            Show {excludedCount} offers left out of the fair price
          </label>
        )}
      </div>
      {!open ? null : rows.length === 0 ? (
        <p className="py-6 text-slate">No offers today.</p>
      ) : (
        <div id="offers-table" className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-slate">
              <tr className="border-b border-line">
                <th className="py-2 pr-3 font-normal">Price</th>
                <th className="py-2 pr-3 font-normal">Shipping</th>
                <th className="py-2 pr-3 font-normal">Total</th>
                <th className="py-2 pr-3 font-normal">Qty</th>
                <th className="py-2 pr-3 font-normal">From</th>
                <th className="py-2 pr-3 font-normal">Seller</th>
                <th className="py-2 font-normal">Comment</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ o, reason }, i) => (
                <tr key={i} className={`border-b border-line align-top ${reason ? "text-slate" : ""}`}>
                  <td className="num py-2 pr-3">{money(o.price)}</td>
                  <td className="num py-2 pr-3">{money(o.shipping)}</td>
                  <td className="num py-2 pr-3 font-semibold">{money(o.total)}</td>
                  <td className="num py-2 pr-3">{o.qty}</td>
                  <td className="py-2 pr-3">{o.country ?? "–"}</td>
                  <td className="py-2 pr-3">
                    {SELLER[o.sellerType ?? ""] ?? "–"}
                    {o.rating && (
                      <span className="block text-xs text-slate">
                        {RATING[o.rating] ?? o.rating}
                        {o.sales !== null && <span className="num ml-2">{o.sales} sales</span>}
                      </span>
                    )}
                  </td>
                  <td className="py-2">
                    {reason && <span className="mb-0.5 block text-xs font-semibold text-down">Left out: {reason}</span>}
                    <span className="break-words">{o.comment ?? ""}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

"use client";

// Eigener Zeitraum für Graphen: von–bis (Datum) oder die letzten N Tage. Überall gleich (Produkt, Vergleich,
// Portfolio-Performance, Positionsseite).
export interface CustomValue { from: string; to: string; days: string }

const shift = (iso: string, n: number) =>
  iso ? new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10) : "";

/** Wirksamer Zeitraum: "letzte N Tage" geht vor; ohne Bis-Datum bis zum letzten Tag. */
export function resolveCustom(v: CustomValue, last: string): { from: string; to: string } {
  const n = Number(v.days);
  if (v.days && Number.isFinite(n) && n > 0) return { from: shift(last, -Math.round(n)), to: last };
  return { from: v.from || shift(last, -90), to: v.to && v.to < last ? v.to : last };
}

export const customDefault = (): CustomValue => ({ from: "", to: "", days: "" });

export function CustomRange({ value, onChange, first, last }: {
  value: CustomValue; onChange: (v: CustomValue) => void; first?: string; last: string;
}) {
  const eff = resolveCustom(value, last);
  const input = "h-9 rounded-[var(--radius-control)] border border-line bg-surface px-3";
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
      <label className="flex items-center gap-2">From
        <input type="date" value={eff.from} min={first} max={eff.to || last}
          onChange={(e) => onChange({ from: e.target.value, to: value.days ? eff.to : value.to, days: "" })} className={input} />
      </label>
      <label className="flex items-center gap-2">to
        <input type="date" value={eff.to} min={eff.from || first} max={last}
          onChange={(e) => onChange({ from: value.days ? eff.from : value.from, to: e.target.value, days: "" })} className={input} />
      </label>
      <span className="text-slate">or last</span>
      <input type="number" min={1} value={value.days} onChange={(e) => onChange({ ...value, days: e.target.value })} placeholder="N"
        aria-label="Number of days" className={`num w-20 ${input}`} />
      <span className="text-slate">days</span>
    </div>
  );
}

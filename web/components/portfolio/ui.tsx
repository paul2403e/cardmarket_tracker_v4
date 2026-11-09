// Kleine gemeinsame Bausteine der Portfolio-Seiten.
import { money, trendClass } from "@/lib/format";

export const eur = (cents: number | null) => (cents === null ? "–" : money(cents / 100));
export const signed = (cents: number) => `${cents > 0 ? "+" : cents < 0 ? "−" : "±"}${money(Math.abs(cents) / 100)}`;
export const signedPct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(1).replace(".", ",")} %`;
export const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function Kpi({ label, value, sub, tone, small = false }: {
  label: string; value: string; sub?: string; tone?: number; small?: boolean;
}) {
  return (
    <div className={`rounded-[var(--radius-panel)] bg-surface ring-1 ring-line ${small ? "px-4 py-3" : "p-4"}`}>
      <p className="text-sm text-slate">{label}</p>
      <p className={`display num mt-1 ${small ? "text-lg" : "text-2xl"} ${tone === undefined ? "" : trendClass(tone)}`}>{value}</p>
      {sub && <p className={`num text-sm ${tone === undefined ? "text-slate" : trendClass(tone)}`}>{sub}</p>}
    </div>
  );
}

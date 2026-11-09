"use client";

// Ein Diagramm für Preis und Bestand. Schalter: fairer Preis inkl. Versand (an), Bestand (an, eigene Achse rechts),
// fairer Preis nur Artikel (aus).
import { useMemo, useState } from "react";
import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Segmented } from "@/components/Segmented";
import { count, money } from "@/lib/format";
import type { VariantFull } from "@/lib/types";

type Range = "7" | "30" | "90" | "365" | "all";
const RANGES: { value: Range; label: string }[] = [
  { value: "7", label: "7D" },
  { value: "30", label: "30D" },
  { value: "90", label: "90D" },
  { value: "365", label: "1Y" },
  { value: "all", label: "All" },
];

const SERIES = [
  { key: "incl", label: "Fair price incl. shipping", color: "#2147c9", on: true },
  { key: "items", label: "Items listed", color: "#b7c1cb", on: true },
  { key: "excl", label: "Fair price item only", color: "#0e8a5c", on: false },
] as const;
type Key = (typeof SERIES)[number]["key"];

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export function PriceChart({ v, region }: { v: VariantFull; region: "eu" | "all" }) {
  const [range, setRange] = useState<Range>("90");
  const [shown, setShown] = useState<Record<Key, boolean>>(
    Object.fromEntries(SERIES.map((s) => [s.key, s.on])) as Record<Key, boolean>,
  );
  const s = v.series;

  const data = useMemo(() => {
    const rows = s.days.map((day, i) => ({
      day,
      incl: s[`${region}_incl`][i],
      excl: s[`${region}_excl`][i],
      items: s.items[i],
    }));
    return range === "all" ? rows : rows.slice(-Number(range));
  }, [s, region, range]);

  const enough = data.filter((d) => d.incl !== null || d.items !== null).length > 1;
  const anyPrice = shown.incl || shown.excl;

  return (
    <section aria-labelledby="chart-title" className="rounded-[var(--radius-panel)] bg-surface p-5 ring-1 ring-line">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="chart-title" className="font-semibold">History</h2>
        <Segmented label="Time range" value={range} options={RANGES} onChange={setRange} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Lines shown">
        {SERIES.map((x) => (
          <button key={x.key} type="button" aria-pressed={shown[x.key]}
            onClick={() => setShown((st) => ({ ...st, [x.key]: !st[x.key] }))}
            className={`flex items-center gap-2 rounded-[var(--radius-control)] px-3 py-1 text-sm ring-1 ${
              shown[x.key] ? "text-ink ring-ink" : "text-slate ring-line"
            }`}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: shown[x.key] ? x.color : "#d8dee3" }} aria-hidden />
            {x.label}
          </button>
        ))}
      </div>
      {enough ? (
        <div className="mt-4 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
              <XAxis dataKey="day" tickFormatter={fmtDay} tickLine={false} axisLine={false} minTickGap={48}
                tick={{ fill: "#5b6772", fontSize: 12 }} />
              <YAxis yAxisId="price" orientation="left" domain={["auto", "auto"]} tickLine={false} axisLine={false} width={anyPrice ? 56 : 0}
                hide={!anyPrice} tick={{ fill: "#5b6772", fontSize: 12 }} tickFormatter={(x: number) => `€${x.toFixed(0)}`} />
              <YAxis yAxisId="items" orientation="right" tickLine={false} axisLine={false} width={shown.items ? 44 : 0}
                hide={!shown.items} allowDecimals={false} tick={{ fill: "#5b6772", fontSize: 12 }} />
              <Tooltip
                formatter={(val, name) => [name === "Items listed" ? count(Number(val)) : money(Number(val)), String(name)]}
                labelFormatter={(l) => fmtDay(String(l))}
                contentStyle={{ borderRadius: 10, border: "1px solid #d8dee3", fontFamily: "inherit" }}
              />
              {shown.items && (
                <Area yAxisId="items" type="stepAfter" dataKey="items" name="Items listed" stroke="#b7c1cb" strokeWidth={1}
                  fill="#dfe5ea" fillOpacity={0.6} connectNulls isAnimationActive={false} dot={false} />
              )}
              {shown.incl && (
                <Area yAxisId="price" type="monotone" dataKey="incl" name="Fair price incl. shipping" stroke="#2147c9"
                  strokeWidth={2.5} fill="#2147c9" fillOpacity={0.05} connectNulls isAnimationActive={false} dot={false} />
              )}
              {shown.excl && (
                <Line yAxisId="price" type="monotone" dataKey="excl" name="Fair price item only" stroke="#0e8a5c"
                  strokeWidth={2} connectNulls isAnimationActive={false} dot={false} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="grid h-48 place-items-center text-center text-slate">The chart starts once there is data from two days.</p>
      )}
    </section>
  );
}

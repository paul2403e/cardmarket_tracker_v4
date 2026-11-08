"use client";

// Verlauf von fairem Preis (wahlweise mit günstigstem Angebot und Cardmarket-Trend) und darunter Bestand.
import { useMemo, useState } from "react";
import { Area, Bar, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Segmented } from "@/components/Segmented";
import { money } from "@/lib/format";
import type { VariantFull } from "@/lib/types";

type Range = "7" | "30" | "90" | "365" | "all";
const RANGES: { value: Range; label: string }[] = [
  { value: "7", label: "7D" },
  { value: "30", label: "30D" },
  { value: "90", label: "90D" },
  { value: "365", label: "1Y" },
  { value: "all", label: "All" },
];

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export function PriceChart({ v, region, incl }: { v: VariantFull; region: "eu" | "all"; incl: boolean }) {
  const [range, setRange] = useState<Range>("90");
  const [showTrend, setShowTrend] = useState(false);
  const s = v.series;
  const priceKey = `${region}_${incl ? "incl" : "excl"}` as const;

  const data = useMemo(() => {
    const rows = s.days.map((day, i) => ({
      day,
      price: s[priceKey][i],
      cheapest: incl ? s[`${region}_cheapest_incl`][i] : null,
      trend: s.trend[i],
      items: s.items[i],
    }));
    return range === "all" ? rows : rows.slice(-Number(range));
  }, [s, priceKey, region, incl, range]);

  const enough = data.filter((d) => d.price !== null).length > 1;

  return (
    <section aria-labelledby="chart-title" className="rounded-[var(--radius-panel)] bg-surface p-5 ring-1 ring-line">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="chart-title" className="font-semibold">Price history</h2>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate">
            <input type="checkbox" checked={showTrend} onChange={(e) => setShowTrend(e.target.checked)} className="accent-cobalt" />
            Cardmarket trend
          </label>
          <Segmented label="Time range" value={range} options={RANGES} onChange={setRange} />
        </div>
      </div>
      {enough ? (
        <>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }} syncId="product">
                <XAxis dataKey="day" tickFormatter={fmtDay} tickLine={false} axisLine={false} minTickGap={48}
                  tick={{ fill: "#5b6772", fontSize: 12 }} />
                <YAxis orientation="right" domain={["auto", "auto"]} tickLine={false} axisLine={false} width={56}
                  tick={{ fill: "#5b6772", fontSize: 12 }} tickFormatter={(x: number) => `€${x.toFixed(0)}`} />
                <Tooltip
                  formatter={(val, name) => [money(Number(val)), String(name)]}
                  labelFormatter={(l) => fmtDay(String(l))}
                  contentStyle={{ borderRadius: 10, border: "1px solid #d8dee3", fontFamily: "inherit" }}
                />
                <Area type="monotone" dataKey="price" name="Fair price" stroke="#2147c9" strokeWidth={2.5}
                  fill="#2147c9" fillOpacity={0.06} connectNulls isAnimationActive={false} dot={false} />
                {incl && (
                  <Line type="monotone" dataKey="cheapest" name="Cheapest offer" stroke="#5b6772" strokeDasharray="4 4"
                    strokeWidth={1.5} connectNulls isAnimationActive={false} dot={false} />
                )}
                {showTrend && (
                  <Line type="monotone" dataKey="trend" name="Cardmarket trend" stroke="#ec5fb4" strokeWidth={1.5}
                    connectNulls isAnimationActive={false} dot={false} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <h3 className="mt-4 text-sm text-slate">Items listed</h3>
          <div className="h-24">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} syncId="product">
                <XAxis dataKey="day" hide />
                <YAxis orientation="right" tickLine={false} axisLine={false} width={56} tick={{ fill: "#5b6772", fontSize: 11 }}
                  allowDecimals={false} />
                <Tooltip formatter={(val) => [String(val), "Items listed"]} labelFormatter={(l) => fmtDay(String(l))}
                  contentStyle={{ borderRadius: 10, border: "1px solid #d8dee3", fontFamily: "inherit" }} />
                <Bar dataKey="items" fill="#c5cdd5" isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      ) : (
        <p className="grid h-48 place-items-center text-center text-slate">
          The chart starts once there are prices from two days.
        </p>
      )}
    </section>
  );
}

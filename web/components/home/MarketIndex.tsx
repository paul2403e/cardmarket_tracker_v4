"use client";

// Marktindex (verkettet, Start 100): Wie hat sich der Preis von Sealed-Produkten insgesamt entwickelt?
// Das einzige laute Element der Seite: die Linie im Holo-Verlauf.
import { useMemo, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Segmented } from "@/components/Segmented";
import { shortCategory } from "@/components/ProductRow";
import { useMarketIndex } from "@/lib/data";
import { pct, trendClass } from "@/lib/format";
import { useSettings } from "@/lib/settings";

type Range = "30" | "90" | "365" | "all";
const RANGES: { value: Range; label: string }[] = [
  { value: "30", label: "30D" },
  { value: "90", label: "90D" },
  { value: "365", label: "1Y" },
  { value: "all", label: "All" },
];

function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function MarketIndex() {
  const { data } = useMarketIndex();
  const { region } = useSettings();
  const [range, setRange] = useState<Range>("90");
  const [cat, setCat] = useState<string>("all");

  const points = useMemo(() => {
    if (!data) return [];
    const block = data[region];
    const values = (block[cat] ?? block.all) as number[];
    const all = block.days.map((d, i) => ({ day: d as string, value: values[i] }));
    return range === "all" ? all : all.slice(-Number(range));
  }, [data, region, range, cat]);

  const last = points.at(-1)?.value;
  const first = points[0]?.value;
  const change = last !== undefined && first ? ((last / first) - 1) * 100 : null;
  const categories = data ? Object.entries(data.categories) : [];

  return (
    <section aria-labelledby="index-title" className="rounded-[var(--radius-panel)] bg-surface p-5 ring-1 ring-line sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="index-title" className="text-sm text-slate">
            Sealed market index {cat !== "all" && <>for {shortCategory(data?.categories[cat] ?? "")}</>}
          </h2>
          <p className="mt-1 flex items-baseline gap-3">
            <span className="display num text-5xl">{last !== undefined ? last.toFixed(1) : "–"}</span>
            <span className={`num text-lg font-semibold ${trendClass(change)}`}>{points.length > 1 ? pct(change) : ""}</span>
          </p>
        </div>
        <Segmented label="Time range" value={range} options={RANGES} onChange={setRange} />
      </div>

      <div className="mt-5 h-56 sm:h-64">
        {points.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="holo-line" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#48b8e8" />
                  <stop offset="35%" stopColor="#8f6cf0" />
                  <stop offset="65%" stopColor="#ec5fb4" />
                  <stop offset="100%" stopColor="#f6d64a" />
                </linearGradient>
                <linearGradient id="holo-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8f6cf0" stopOpacity={0.16} />
                  <stop offset="100%" stopColor="#8f6cf0" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="day" tickFormatter={fmtDay} tickLine={false} axisLine={false} minTickGap={48}
                tick={{ fill: "#5b6772", fontSize: 12 }} />
              <YAxis orientation="right" domain={["auto", "auto"]} tickLine={false} axisLine={false} width={44}
                tick={{ fill: "#5b6772", fontSize: 12 }} tickFormatter={(v: number) => v.toFixed(0)} />
              <Tooltip
                formatter={(v) => [Number(v).toFixed(1), "Index"]}
                labelFormatter={(l) => fmtDay(String(l))}
                contentStyle={{ borderRadius: 10, border: "1px solid #d8dee3", fontFamily: "inherit" }}
              />
              <Area type="monotone" dataKey="value" stroke="url(#holo-line)" strokeWidth={3} fill="url(#holo-fill)"
                isAnimationActive={false} dot={false} activeDot={{ r: 4, fill: "#17212b" }} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <p className="grid h-full place-items-center text-center text-slate">
            The index starts once there are prices from two days.
          </p>
        )}
      </div>

      {categories.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label="Category">
          {[["all", "All sealed"], ...categories].map(([id, name]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={cat === id}
              onClick={() => setCat(id)}
              className={`rounded-[var(--radius-control)] px-3 py-1 text-sm ring-1 ${
                cat === id ? "bg-cobalt text-white ring-cobalt" : "text-slate ring-line hover:text-ink"
              }`}
            >
              {id === "all" ? name : shortCategory(name)}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

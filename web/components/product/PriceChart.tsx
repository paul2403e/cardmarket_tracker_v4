"use client";

// Ein Diagramm für Preis und Bestand. Schalter: fairer Preis inkl. Versand (an), Bestand (an, eigene Achse rechts),
// fairer Preis nur Artikel (aus). Hoch und Tief seit Trackingbeginn (ATH/ATL) jeder Linie als Punkt markiert;
// beim Darüberfahren: Datum, beide Preise und Bestand – ATH/ATL steht dann beim jeweiligen Wert.
import { useMemo, useState } from "react";
import { Area, ComposedChart, Line, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

type Extremes = { high: { day: string; value: number }; low: { day: string; value: number } } | null;

/** Höchst- und Tiefstwert über den ganzen Verlauf (erster Tag bei Gleichstand). */
function extremes(days: string[], values: (number | null)[]): Extremes {
  let high: { day: string; value: number } | null = null;
  let low: { day: string; value: number } | null = null;
  values.forEach((v, i) => {
    if (v === null || v === undefined) return;
    if (!high || v > high.value) high = { day: days[i], value: v };
    if (!low || v < low.value) low = { day: days[i], value: v };
  });
  return high && low ? { high, low } : null;
}

const mark = (e: Extremes, day: string) => (e?.high.day === day ? "ATH" : e?.low.day === day ? "ATL" : null);

type Row = { day: string; incl: number | null; excl: number | null; items: number | null };

function Tip({ active, payload, ext }: {
  active?: boolean;
  payload?: { payload: Row }[];
  ext: Record<"incl" | "excl" | "items", Extremes>;
}) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  const lines: { key: "incl" | "excl" | "items"; label: string; value: string }[] = [
    { key: "incl", label: "Fair price incl. shipping", value: money(row.incl) },
    { key: "excl", label: "Fair price item only", value: money(row.excl) },
    { key: "items", label: "Items listed", value: count(row.items) },
  ];
  return (
    <div className="rounded-[10px] border border-line bg-surface px-3 py-2 text-sm shadow-[0_8px_24px_-12px_rgba(23,33,43,0.3)]">
      <p className="mb-1 font-semibold">{fmtDate(row.day)}</p>
      {lines.map((l) => {
        const m = mark(ext[l.key], row.day);
        return (
          <p key={l.key} className="flex justify-between gap-6">
            <span className="text-slate">{l.label}</span>
            <span className="num font-semibold">
              {m && <span className="mr-1.5 rounded bg-cobalt-soft px-1 text-xs font-semibold text-cobalt">{m}</span>}
              {l.value}
            </span>
          </p>
        );
      })}
    </div>
  );
}

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

  // ATH/ATL seit Trackingbeginn (nicht nur im gewählten Zeitraum)
  const ext = useMemo(() => ({
    incl: extremes(s.days, s[`${region}_incl`]),
    excl: extremes(s.days, s[`${region}_excl`]),
    items: extremes(s.days, s.items),
  }), [s, region]);
  const visible = new Set(data.map((d) => d.day));
  const dots = (["items", "incl", "excl"] as const).flatMap((key) => {
    const e = ext[key];
    if (!shown[key] || !e) return [];
    const color = SERIES.find((x) => x.key === key)!.color;
    return [e.high, e.low].filter((p) => visible.has(p.day)).map((p, i) => (
      <ReferenceDot key={`${key}-${i}`} yAxisId={key === "items" ? "items" : "price"} x={p.day} y={p.value} r={5}
        fill={key === "items" ? "#7d8a96" : color} stroke="#ffffff" strokeWidth={2} ifOverflow="extendDomain" />
    ));
  });

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
              <Tooltip content={<Tip ext={ext} />} cursor={{ stroke: "#9aa6b1", strokeDasharray: "3 3" }} />
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
              {dots}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="grid h-48 place-items-center text-center text-slate">The chart starts once there is data from two days.</p>
      )}
    </section>
  );
}

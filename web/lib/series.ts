// Auswertungen eines Verlaufs (Produktseite). Gleiche Regeln wie beim Veröffentlichen (publish.py):
// Veränderung nur, wenn es heute und am Anfang des Zeitraums einen Wert gibt (kleine Toleranz).

export interface Point {
  day: string;
  value: number;
}

export function points(days: string[], values: (number | null)[]): Point[] {
  const out: Point[] = [];
  days.forEach((d, i) => {
    const v = values[i];
    if (v !== null && v !== undefined) out.push({ day: d, value: v });
  });
  return out;
}

const DAY = 86_400_000;
const ts = (iso: string) => new Date(`${iso}T00:00:00Z`).getTime();

export function changeOver(pts: Point[], lastDay: string, daysBack: number): number | null {
  const end = pts.at(-1);
  if (!end || end.day !== lastDay) return null;
  const target = ts(lastDay) - daysBack * DAY;
  const tolerance = (daysBack <= 7 ? 3 : daysBack <= 30 ? 7 : 21) * DAY;
  const start = [...pts].reverse().find((p) => ts(p.day) <= target && ts(p.day) >= target - tolerance);
  if (!start || start.value <= 0) return null;
  return Math.round((end.value / start.value - 1) * 1000) / 10;
}

export function range(pts: Point[], lastDay: string, daysBack?: number): { low: Point; high: Point } | null {
  const from = daysBack ? ts(lastDay) - daysBack * DAY : -Infinity;
  const sel = pts.filter((p) => ts(p.day) >= from);
  if (!sel.length) return null;
  return {
    low: sel.reduce((a, b) => (b.value < a.value ? b : a)),
    high: sel.reduce((a, b) => (b.value > a.value ? b : a)),
  };
}

export type Confidence = "high" | "medium" | "low";

/** Wie verlässlich ist der faire Preis? Nach Korbgröße und Anzahl gelisteter Stück. */
export function confidence(basket: number | null | undefined, items: number | null | undefined): Confidence {
  const b = basket ?? 0;
  const n = items ?? 0;
  if (b >= 5 && n >= 20) return "high";
  if (b >= 2 || n >= 5) return "medium";
  return "low";
}

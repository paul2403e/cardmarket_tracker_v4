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

export type Confidence = "reliable" | "fair" | "shaky" | "single" | "none";

/** Stufen von schlecht nach gut (Reihenfolge für Sortierung und Filter). */
export const CONFIDENCE_ORDER: Confidence[] = ["none", "single", "shaky", "fair", "reliable"];

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  reliable: "Reliable", fair: "Fair", shaky: "Shaky", single: "Single offer", none: "No price",
};

export const CONFIDENCE_TEXT: Record<Confidence, string> = {
  reliable: "Reliable: 50 or more offers",
  fair: "Fair: 10 to 49 offers",
  shaky: "Shaky: fewer than 10 offers – the price can jump",
  single: "Single offer: the price is just one seller's asking price",
  none: "No price: no valid offers today",
};

/** Wie verlässlich ist der faire Preis? Nach der Zahl gültiger Angebote (nach allen Filtern, je EU-Schalter).
 *  Ältere Daten ohne diese Zahl: alle Angebote auf Cardmarket als Näherung. */
export function confidence(v: { price?: { eu: { incl: number | null }; all: { incl: number | null } } | null;
  valid?: { eu: number | null; all: number | null } | null; offers?: number | null } | null | undefined, region: "eu" | "all"):
  { level: Confidence; offers: number } {
  const n = v?.valid?.[region] ?? v?.offers ?? 0;
  if (!v?.price?.[region]?.incl || n <= 0) return { level: "none", offers: 0 };
  if (n === 1) return { level: "single", offers: n };
  if (n < 10) return { level: "shaky", offers: n };
  if (n < 50) return { level: "fair", offers: n };
  return { level: "reliable", offers: n };
}

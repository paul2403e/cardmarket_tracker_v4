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

export type Confidence = "reliable" | "fair" | "thin" | "very_thin" | "none";

/** Stufen von schlecht nach gut (Reihenfolge für Sortierung und Filter). */
export const CONFIDENCE_ORDER: Confidence[] = ["none", "very_thin", "thin", "fair", "reliable"];

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  reliable: "Reliable", fair: "Fair", thin: "Thin", very_thin: "Very thin", none: "No price",
};

/** Was hinter der Stufe steckt (Korb = günstigste gültige Angebote, aus denen der Median gebildet wird). */
export const CONFIDENCE_TEXT: Record<Confidence, string> = {
  reliable: "The fair price is based on 5–7 valid offers (needs at least 34 offers on the market).",
  fair: "The fair price is based on 3–4 valid offers (at least 20 offers on the market).",
  thin: "The fair price is based on 2 valid offers (at least 14 offers on the market).",
  very_thin: "The fair price is based on the cheapest valid offer only – it can jump.",
  none: "No price: no valid offers today.",
};

/** Erklärung für "Offers" (beim Darüberfahren). */
export const OFFERS_HINT = "All offers on Cardmarket in this language, from all countries – including non-EU and damaged items that the fair price leaves out.";

/** Wie verlässlich ist der faire Preis? Nach der Zahl gültiger Angebote im Korb (aus der Preisberechnung, je
 *  EU-Schalter). `offers` = alle Angebote auf Cardmarket (nur zur Anzeige). */
export function confidence(v: { price?: { eu: { incl: number | null }; all: { incl: number | null } } | null;
  basket?: { eu: number | null; all: number | null } | null; offers?: number | null } | null | undefined,
region: "eu" | "all"): { level: Confidence; offers: number; basket: number } {
  const offers = v?.offers ?? 0;
  const basket = v?.price?.[region]?.incl ? v?.basket?.[region] ?? 1 : 0;
  const level: Confidence = basket <= 0 ? "none" : basket === 1 ? "very_thin" : basket === 2 ? "thin" : basket <= 4 ? "fair" : "reliable";
  return { level, offers, basket };
}

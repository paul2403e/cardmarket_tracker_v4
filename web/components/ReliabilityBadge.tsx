// Zuverlässigkeit des fairen Preises als farbiges Kästchen (Stufen in lib/series.ts).
import { CONFIDENCE_LABEL, CONFIDENCE_TEXT, type Confidence } from "@/lib/series";

export const CONFIDENCE_STYLE: Record<Confidence, string> = {
  reliable: "bg-up-soft text-up", fair: "bg-cobalt-soft text-cobalt", shaky: "bg-warn-soft text-warn",
  single: "bg-down-soft text-down", none: "bg-paper text-slate ring-1 ring-line",
};

/** Farbe je Stufe für Balken und Punkte. */
export const CONFIDENCE_COLOR: Record<Confidence, string> = {
  reliable: "#0e8a5c", fair: "#2147c9", shaky: "#e0a020", single: "#c53d2b", none: "#b7c1cb",
};

export function ReliabilityBadge({ level, long = false }: { level: Confidence; long?: boolean }) {
  return (
    <span title={long ? undefined : CONFIDENCE_TEXT[level]}
      className={`inline-block whitespace-nowrap rounded-lg px-2 py-0.5 text-xs font-semibold ${CONFIDENCE_STYLE[level]}`}>
      {long ? CONFIDENCE_TEXT[level] : CONFIDENCE_LABEL[level]}
    </span>
  );
}

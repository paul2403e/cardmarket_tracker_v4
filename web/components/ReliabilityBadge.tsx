// Zuverlässigkeit des fairen Preises als farbiges Kästchen (Stufen in lib/series.ts).
import { CONFIDENCE_LABEL, CONFIDENCE_TEXT, type Confidence } from "@/lib/series";

export const CONFIDENCE_STYLE: Record<Confidence, string> = {
  reliable: "bg-up-soft text-up", fair: "bg-cobalt-soft text-cobalt", thin: "bg-warn-soft text-warn",
  very_thin: "bg-down-soft text-down", none: "bg-paper text-slate ring-1 ring-line",
};

/** Farbe je Stufe für Balken und Punkte. */
export const CONFIDENCE_COLOR: Record<Confidence, string> = {
  reliable: "#0e8a5c", fair: "#2147c9", thin: "#e0a020", very_thin: "#c53d2b", none: "#b7c1cb",
};

export function ReliabilityBadge({ level }: { level: Confidence }) {
  return (
    <span title={CONFIDENCE_TEXT[level]}
      className={`inline-block cursor-help whitespace-nowrap rounded-lg px-2 py-0.5 text-xs font-semibold ${CONFIDENCE_STYLE[level]}`}>
      {CONFIDENCE_LABEL[level]}
    </span>
  );
}

import type { Lang } from "./types";

const eur = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
const eur0 = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const int = new Intl.NumberFormat("en-IE");

export function money(v: number | null | undefined, round = false): string {
  if (v === null || v === undefined) return "–";
  return (round && Math.abs(v) >= 1000 ? eur0 : eur).format(v);
}

export function count(v: number | null | undefined): string {
  return v === null || v === undefined ? "–" : int.format(v);
}

export function pct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "–";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "±";
  return `${sign}${Math.abs(v).toFixed(1)}%`;
}

export function trendClass(v: number | null | undefined): string {
  if (v === null || v === undefined || v === 0) return "text-slate";
  return v > 0 ? "text-up" : "text-down";
}

export const LANG_LABEL: Record<Lang, string> = { en: "English", de: "German", ja: "Japanese" };
export const LANG_SHORT: Record<Lang, string> = { en: "EN", de: "DE", ja: "JP" };
export const LANGS: Lang[] = ["en", "de", "ja"];

export function relativeTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `${Math.max(mins, 1)} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

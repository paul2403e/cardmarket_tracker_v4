// Supabase (nur Nutzerdaten: Konten, Einstellungen, später Depots). Marktdaten kommen weiter aus R2.
// Die Werte setzt Vercel (Settings → Environment Variables). Der "publishable key" ist absichtlich öffentlich –
// geschützt wird über Row Level Security in der Datenbank (supabase/migrations).
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

/** Ohne Einstellungen (z. B. lokale Tests) läuft die Website ohne Konten weiter. */
export const accountsEnabled = Boolean(SUPABASE_URL && SUPABASE_KEY);

export const MIN_PASSWORD = 10;

/** Nur interne Pfade als Weiterleitungsziel (kein "//fremde-seite.de"). */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : fallback;
}

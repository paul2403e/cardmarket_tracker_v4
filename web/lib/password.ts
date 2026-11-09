// Passwort-Regeln wie in Supabase eingestellt: mind. 10 Zeichen, Klein- und Großbuchstaben, Zahl, Sonderzeichen.
import { MIN_PASSWORD } from "./supabase/config";

export const PASSWORD_RULES: { label: string; ok: (p: string) => boolean }[] = [
  { label: `At least ${MIN_PASSWORD} characters`, ok: (p) => p.length >= MIN_PASSWORD },
  { label: "A lowercase letter (a–z)", ok: (p) => /[a-z]/.test(p) },
  { label: "An uppercase letter (A–Z)", ok: (p) => /[A-Z]/.test(p) },
  { label: "A number (0–9)", ok: (p) => /[0-9]/.test(p) },
  { label: "A special character (e.g. ! ? # $ % &)", ok: (p) => /[^A-Za-z0-9]/.test(p) },
];

export const PASSWORD_TEXT =
  `Your password needs at least ${MIN_PASSWORD} characters, with a lowercase letter, an uppercase letter, a number and a special character.`;

/** Fehlertext, wenn das Passwort die Regeln nicht erfüllt – sonst null. */
export function passwordProblem(p: string): string | null {
  const missing = PASSWORD_RULES.filter((r) => !r.ok(p)).map((r) => r.label.toLowerCase());
  return missing.length ? `Your password still needs: ${missing.join(", ")}.` : null;
}

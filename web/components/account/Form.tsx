"use client";

// Bausteine für die Konto-Seiten (Anmelden, Registrieren, Passwort).
import Link from "next/link";
import { useId, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { PASSWORD_RULES } from "@/lib/password";

export function Panel({ title, children, intro }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section className="mx-auto w-full max-w-md py-6">
      <h1 className="display text-3xl">{title}</h1>
      {intro && <div className="mt-2 text-slate">{intro}</div>}
      <div className="mt-6 rounded-[var(--radius-panel)] bg-surface p-6 ring-1 ring-line">{children}</div>
    </section>
  );
}

export function Field({ label, type = "text", value, onChange, autoComplete, hint, required = true, minLength }: {
  label: string; type?: string; value: string; onChange: (v: string) => void; autoComplete?: string;
  hint?: string; required?: boolean; minLength?: number;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold">{label}</label>
      <input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete}
        required={required} minLength={minLength} aria-describedby={hint ? `${id}-hint` : undefined}
        className="h-11 rounded-[var(--radius-control)] border border-line bg-surface px-3 outline-none focus:border-cobalt" />
      {hint && <p id={`${id}-hint`} className="text-xs text-slate">{hint}</p>}
    </div>
  );
}

export function Submit({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button type="submit" disabled={busy}
      className="h-11 w-full rounded-[var(--radius-control)] bg-ink font-semibold text-white hover:bg-cobalt disabled:opacity-60">
      {busy ? "Please wait…" : children}
    </button>
  );
}

export function Notice({ kind, children }: { kind: "error" | "ok"; children: ReactNode }) {
  return (
    <p role={kind === "error" ? "alert" : "status"}
      className={`rounded-[var(--radius-control)] px-3 py-2 text-sm ${kind === "error" ? "bg-down-soft text-down" : "bg-up-soft text-up"}`}>
      {children}
    </p>
  );
}

/** Seiten, die Konten brauchen: Hinweis, solange Supabase nicht eingerichtet ist. */
export function NeedsAccounts({ children }: { children: ReactNode }) {
  const { enabled } = useAuth();
  if (enabled) return <>{children}</>;
  return (
    <section className="mx-auto max-w-md py-16 text-center">
      <h1 className="display text-3xl">Accounts are coming soon</h1>
      <p className="mt-3 text-slate">Sign-up isn&apos;t open yet. <Link href="/" className="text-cobalt hover:underline">Back to the market</Link></p>
    </section>
  );
}

/** Live-Checkliste der Passwort-Regeln unter dem Passwortfeld. */
export function PasswordRules({ password }: { password: string }) {
  return (
    <ul className="-mt-2 grid gap-0.5 text-xs" aria-label="Password requirements">
      {PASSWORD_RULES.map((r) => {
        const ok = r.ok(password);
        return (
          <li key={r.label} className={ok ? "text-up" : "text-slate"}>
            <span aria-hidden className="mr-1.5 inline-block w-3">{ok ? "✓" : "·"}</span>
            {r.label}
            <span className="sr-only">{ok ? " – done" : " – missing"}</span>
          </li>
        );
      })}
    </ul>
  );
}

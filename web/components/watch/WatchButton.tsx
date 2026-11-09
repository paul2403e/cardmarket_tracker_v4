"use client";

// Watchlist-Schalter und Preisalarm-Knopf (Produktseite, Browse). Nicht angemeldet: weiter zur Anmeldung.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import type { Lang } from "@/lib/types";
import { alertText, sameVariant, useWatch, watchApi, type Alert } from "@/lib/watch";
import { AlertDialog } from "./AlertDialog";
import { HoldConfirm } from "./Dialog";

function Eye({ on }: { on: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill={on ? "currentColor" : "none"} />
      <circle cx="12" cy="12" r="3" fill={on ? "var(--color-cobalt-soft)" : "none"} stroke={on ? "var(--color-cobalt-soft)" : "currentColor"} />
    </svg>
  );
}

/** Watch-Status einer Variante plus Umschalten (mit Rückfrage, wenn dabei Alarme gelöscht würden). */
function useToggle(game: string, productId: number, language: Lang) {
  const { data, mutate } = useWatch();
  const watched = Boolean(data?.watch.some((w) => sameVariant(w, game, productId, language)));
  const alerts = (data?.alerts ?? []).filter((a) => sameVariant(a, game, productId, language));
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  async function toggle() {
    if (watched && alerts.length) return setConfirm(true);
    setBusy(true);
    try {
      if (watched) await watchApi.remove(game, productId, language);
      else await watchApi.add(game, productId, language);
      await mutate();
    } finally {
      setBusy(false);
    }
  }
  const dialog = confirm && (
    <HoldConfirm title="Remove from watchlist"
      text={<>This also deletes {alerts.length === 1 ? "its price alert" : `its ${alerts.length} price alerts`}:
        <ul className="mt-2 list-disc pl-5">{alerts.map((a) => <li key={a.id}>{alertText(a)}</li>)}</ul></>}
      action="Hold to remove" onClose={() => setConfirm(false)}
      onConfirm={async () => { await watchApi.remove(game, productId, language); await mutate(); }} />
  );
  return { ready: Boolean(data), watched, alerts, toggle, busy, dialog };
}

function SignInLink({ className, label, children }: { className: string; label: string; children: React.ReactNode }) {
  const path = usePathname();
  return (
    <Link href={`/login?next=${encodeURIComponent(path)}`} className={className} aria-label={`${label} (sign in first)`} title={label}>
      {children}
    </Link>
  );
}

const big = "inline-flex items-center gap-2 rounded-[var(--radius-control)] px-4 py-1.5 text-sm font-semibold ring-1";

/** Produktseite: "Watch" / "Watching" und "Price alert" plus die eigenen Alarme dieser Sprache. */
export function WatchControls({ game, productId, language }: { game: string; productId: number; language: Lang }) {
  const { enabled, user } = useAuth();
  if (!enabled) return null;
  if (!user) {
    return (
      <>
        <SignInLink className={`${big} ring-line hover:ring-ink`} label="Watch"><Eye on={false} />Watch</SignInLink>
        <SignInLink className={`${big} ring-line hover:ring-ink`} label="Price alert">Price alert</SignInLink>
      </>
    );
  }
  return <SignedIn game={game} productId={productId} language={language} />;
}

function SignedIn({ game, productId, language }: { game: string; productId: number; language: Lang }) {
  const t = useToggle(game, productId, language);
  const [dialog, setDialog] = useState<{ editing?: Alert } | null>(null);
  return (
    <>
      <button type="button" onClick={t.toggle} disabled={!t.ready || t.busy} aria-pressed={t.watched}
        className={`${big} disabled:opacity-60 ${t.watched ? "bg-cobalt-soft text-cobalt ring-cobalt" : "ring-line hover:ring-ink"}`}>
        <Eye on={t.watched} />{t.watched ? "Watching" : "Watch"}
      </button>
      <button type="button" onClick={() => setDialog({})} className={`${big} ring-line hover:ring-ink`}>
        Price alert{t.alerts.length ? <span className="num rounded-full bg-ink px-1.5 text-xs text-white">{t.alerts.length}</span> : null}
      </button>
      {t.alerts.length > 0 && (
        <ul className="basis-full text-sm">
          {t.alerts.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-2 py-0.5">
              <span aria-hidden>{a.active ? (a.armed ? "🔔" : "✓") : "⏸"}</span>
              <span className={a.active ? "" : "text-slate line-through"}>{alertText(a)}</span>
              {!a.armed && a.active && <span className="text-xs text-slate">triggered – waits until the condition clears</span>}
              <button type="button" onClick={() => setDialog({ editing: a })} className="text-cobalt hover:underline">Edit</button>
            </li>
          ))}
          <li className="pt-0.5"><Link href="/watchlist" className="text-cobalt hover:underline">Manage on your watchlist</Link></li>
        </ul>
      )}
      {t.dialog}
      {dialog && <AlertDialog target={{ game, productId, language }} editing={dialog.editing} onClose={() => setDialog(null)} />}
    </>
  );
}

/** Browse-Zeile: kleines Auge zum An-/Abwählen. */
export function WatchToggle({ game, productId, language }: { game: string; productId: number; language: Lang }) {
  const { enabled, user } = useAuth();
  if (!enabled) return null;
  const cls = "grid h-8 w-8 place-items-center rounded-full ring-1";
  if (!user) return <SignInLink className={`${cls} text-slate ring-line hover:text-ink`} label="Watch"><Eye on={false} /></SignInLink>;
  return <SmallToggle game={game} productId={productId} language={language} cls={cls} />;
}

function SmallToggle({ game, productId, language, cls }: { game: string; productId: number; language: Lang; cls: string }) {
  const t = useToggle(game, productId, language);
  const label = t.watched ? "Remove from watchlist" : "Add to watchlist";
  return (
    <>
      <button type="button" onClick={t.toggle} disabled={!t.ready || t.busy} aria-pressed={t.watched} aria-label={label} title={label}
        className={`${cls} disabled:opacity-60 ${t.watched ? "bg-cobalt-soft text-cobalt ring-cobalt" : "text-slate ring-line hover:text-ink"}`}>
        <Eye on={t.watched} />
      </button>
      {t.dialog}
    </>
  );
}

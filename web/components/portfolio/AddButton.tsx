"use client";

// "Add to portfolio" – öffnet die Eingabe mit vorausgefülltem Produkt (und Sprache).
// Nicht angemeldet: weiter zur Anmeldung und danach zurück.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import type { Lang } from "@/lib/types";
import { TxnDialog } from "./TxnDialog";

export function AddButton({ game, productId, language, compact = false }: {
  game: string; productId: number; language?: Lang; compact?: boolean;
}) {
  const { enabled, user } = useAuth();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  if (!enabled) return null;
  const cls = compact
    ? "grid h-8 w-8 place-items-center rounded-full text-lg leading-none text-cobalt ring-1 ring-line hover:bg-cobalt hover:text-white hover:ring-cobalt"
    : "rounded-[var(--radius-control)] bg-ink px-4 py-1.5 text-sm font-semibold text-white hover:bg-cobalt";
  const label = compact ? "+" : "Add to portfolio";
  if (!user) {
    return (
      <Link href={`/login?next=${encodeURIComponent(path)}`} className={cls} aria-label="Add to portfolio (sign in first)"
        title="Add to portfolio">
        {label}
      </Link>
    );
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cls} aria-label="Add to portfolio" title="Add to portfolio">
        {label}
      </button>
      {open && <TxnDialog prefill={{ game, productId, language }} onClose={() => setOpen(false)} />}
    </>
  );
}

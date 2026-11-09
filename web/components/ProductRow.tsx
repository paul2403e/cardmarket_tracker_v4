"use client";

import Link from "next/link";
import { useState } from "react";
import { LANG_SHORT, money, pct, trendClass } from "@/lib/format";
import { gameHref, useGame } from "@/lib/games";
import type { Lang } from "@/lib/types";

export function shortCategory(c: string | null): string {
  // "Pokémon Elite Trainer Boxes" -> "Elite Trainer Boxes" (Spielname steht ohnehin oben)
  return (c ?? "").replace(/^(Pokémon|One Piece|Flesh And Blood)\s+/i, "");
}

type Kind = "display" | "box" | "tin" | "pack" | "other";

/** Produktart aus dem Kategorienamen (spielübergreifend: Pokémon, One Piece, Flesh and Blood). */
export function kindOf(category: string | null | undefined): Kind {
  const c = (category ?? "").toLowerCase();
  if (/\btins?\b/.test(c)) return "tin";
  if (/blister/.test(c)) return "pack";
  if (/display|booster box/.test(c)) return "display";
  if (/elite trainer|box set|collection|other box|promo/.test(c)) return "box";
  return "other";
}

/** Schlichte Symbole statt fehlender Produktbilder (eigene Zeichnungen, keine Spiel-Logos). */
function KindIcon({ kind, size }: { kind: Kind; size: number }) {
  const paths: Record<Kind, React.ReactNode> = {
    // Display: Karton mit herausstehenden Boostern
    display: <><rect x="3" y="10" width="18" height="10.5" rx="1.5" /><path d="M6 10V5.5h3.5V10M10.5 10V4h3.5v6M15 10V6h3v4" /></>,
    // Box mit Deckel (ETB, Box Set, Collection)
    box: <><rect x="4" y="9.5" width="16" height="11" rx="1" /><rect x="3" y="6" width="18" height="3.5" rx="1" /><path d="M12 6v14.5" /></>,
    // Dose
    tin: <><ellipse cx="12" cy="6" rx="7" ry="2.5" /><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6" /><path d="M5 9c0 1.4 3.1 2.5 7 2.5S19 10.4 19 9" /></>,
    // Blister: Karte mit Booster
    pack: <><rect x="5" y="2.5" width="14" height="19" rx="1.5" /><circle cx="12" cy="5.5" r="1" /><rect x="8" y="8.5" width="8" height="10" rx="0.8" /><path d="M8 10.5h8M8 16.5h8" /></>,
    // allgemeines Paket
    other: <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {paths[kind]}
    </svg>
  );
}

export function Thumb({ src, category, size = 44 }: {
  src: string | null; name?: string | null; category?: string | null; size?: number;
}) {
  // Manche Produkte haben auf Cardmarkets Bild-Server kein Bild: dann Symbol der Produktart statt kaputtem Bild
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <span className="grid shrink-0 place-items-center rounded-md bg-paper text-[#9aa6b1] ring-1 ring-line"
        style={{ width: size, height: size }} aria-hidden>
        <KindIcon kind={kindOf(category)} size={Math.round(size * 0.56)} />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} loading="lazy" onError={() => setBroken(true)}
      className="shrink-0 rounded-md bg-white object-contain" style={{ width: size, height: size }} />
  );
}

/** Eine Zeile in Listen: Bild, Name, Kategorie + Sprache, rechts Wert und Veränderung. */
export function ProductRow({ id, name, image, category, lang, value, change, note, changeNote }: {
  id: number;
  name: string | null;
  image: string | null;
  category: string | null;
  lang?: Lang;
  value: string;
  change?: number | null;
  note?: string;
  changeNote?: string;
}) {
  const game = useGame();
  return (
    <li>
      <Link href={`${gameHref(game, `/product/${id}`)}${lang ? `?lang=${lang}` : ""}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface">
        <Thumb src={image} name={name} category={category} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{name}</span>
          <span className="flex gap-2 text-xs text-slate">
            {lang && <span className="rounded bg-paper px-1.5 font-semibold text-ink ring-1 ring-line">{LANG_SHORT[lang]}</span>}
            <span className="truncate">{shortCategory(category)}</span>
            {note && <span className="truncate">{note}</span>}
          </span>
        </span>
        <span className="text-right">
          <span className="num block font-semibold">{value}</span>
          {change !== undefined && <span className={`num block text-sm ${trendClass(change)}`}>{pct(change)}</span>}
          {changeNote && <span className="num block text-xs text-slate">{changeNote}</span>}
        </span>
      </Link>
    </li>
  );
}

export { money };

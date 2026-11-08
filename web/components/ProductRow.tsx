"use client";

import Link from "next/link";
import { LANG_SHORT, money, pct, trendClass } from "@/lib/format";
import type { Lang } from "@/lib/types";

export function shortCategory(c: string | null): string {
  return (c ?? "").replace(/^Pokémon\s+/, "");
}

export function Thumb({ src, name, size = 44 }: { src: string | null; name: string | null; size?: number }) {
  if (!src) {
    return (
      <span
        className="display grid shrink-0 place-items-center rounded-md bg-paper text-[11px] text-slate ring-1 ring-line"
        style={{ width: size, height: size }}
        aria-hidden
      >
        {(name ?? "?").slice(0, 2)}
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={size} height={size} loading="lazy" className="shrink-0 rounded-md bg-white object-contain" style={{ width: size, height: size }} />;
}

/** Eine Zeile in Listen: Bild, Name, Kategorie + Sprache, rechts Wert und Veränderung. */
export function ProductRow({ id, name, image, category, lang, value, change, note }: {
  id: number;
  name: string | null;
  image: string | null;
  category: string | null;
  lang?: Lang;
  value: string;
  change?: number | null;
  note?: string;
}) {
  return (
    <li>
      <Link href={`/product/${id}${lang ? `?lang=${lang}` : ""}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface">
        <Thumb src={image} name={name} />
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
        </span>
      </Link>
    </li>
  );
}

export { money };

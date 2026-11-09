"use client";

// Suche über den Katalog (im Browser, ohne Server): Name, deutscher Name oder Cardmarket-ID.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { useCatalog } from "@/lib/data";
import { money } from "@/lib/format";
import { gameHref, useGame } from "@/lib/games";
import { useSettings } from "@/lib/settings";
import type { ProductSummary } from "@/lib/types";

function bestPrice(p: ProductSummary, region: "eu" | "all", incl: boolean): number | null {
  const prices = Object.values(p.languages)
    .map((v) => v?.price?.[region]?.[incl ? "incl" : "excl"] ?? null)
    .filter((x): x is number => x !== null);
  return prices.length ? Math.min(...prices) : null;
}

export function matches(p: ProductSummary, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${p.name ?? ""} ${p.nameDe ?? ""} ${p.id}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function Search({ large = false, autoFocus = false }: { large?: boolean; autoFocus?: boolean }) {
  const game = useGame();
  const { data: catalog } = useCatalog();
  const { region } = useSettings();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const router = useRouter();
  const listId = useId();

  const results = useMemo(() => {
    if (!catalog || q.trim().length < 2) return [];
    return catalog.products.filter((p) => matches(p, q)).slice(0, 8);
  }, [catalog, q]);

  function go(p: ProductSummary) {
    setOpen(false);
    setQ("");
    router.push(gameHref(game, `/product/${p.id}`));
  }

  return (
    <div className="relative w-full">
      <input
        type="search"
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          else if (e.key === "Enter" && results[active]) go(results[active]);
          else if (e.key === "Enter" && q.trim()) router.push(`${gameHref(game, "/browse")}?q=${encodeURIComponent(q.trim())}`);
          else if (e.key === "Escape") setOpen(false);
        }}
        placeholder={large ? "Search a set, box or Cardmarket ID" : `Search ${game.name}`}
        aria-label="Search products"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        className={`w-full rounded-[var(--radius-control)] border border-line bg-surface px-5 text-ink outline-none placeholder:text-slate focus:border-cobalt ${
          large ? "h-14 text-lg" : "h-10 text-sm"
        }`}
      />
      {open && results.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-2 w-full overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[0_12px_32px_-12px_rgba(23,33,43,0.25)]"
        >
          {results.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === active}>
              <Link
                href={gameHref(game, `/product/${p.id}`)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => go(p)}
                className={`flex items-center gap-3 px-4 py-2.5 ${i === active ? "bg-cobalt-soft" : ""}`}
              >
                {p.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.image} alt="" className="h-9 w-9 shrink-0 rounded object-contain" loading="lazy" />
                ) : (
                  <span className="h-9 w-9 shrink-0 rounded bg-paper" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{p.name}</span>
                  <span className="flex gap-3 text-xs text-slate">
                    <span>{p.category}</span>
                    <span className="num">#{p.id}</span>
                  </span>
                </span>
                <span className="num text-sm">{money(bestPrice(p, region, true))}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

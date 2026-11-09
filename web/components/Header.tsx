"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SITE_NAME } from "@/lib/site";
import { useSettings } from "@/lib/settings";
import { Search } from "./Search";
import { Switch } from "./Switch";

const NAV = [
  { href: "/", label: "Market" },
  { href: "/browse", label: "Browse" },
];

export function Header() {
  const { euOnly, setEuOnly } = useSettings();
  const path = usePathname();
  const home = path === "/";
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-8 gap-y-2 px-4 pt-3 pb-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label={`${SITE_NAME} home`}>
          <span className="h-6 w-6 rounded-[5px]" style={{ background: "var(--holo)" }} aria-hidden />
          <span className="display text-lg">{SITE_NAME}</span>
        </Link>
        <nav aria-label="Main" className="flex gap-1">
          {NAV.map((n) => {
            const active = n.href === "/" ? home : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined}
                className={`rounded-[var(--radius-control)] px-4 py-1.5 text-[15px] font-semibold ${
                  active ? "bg-ink text-white" : "text-ink hover:bg-cobalt-soft"
                }`}>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto">
          <Switch label="EU only" checked={euOnly} onChange={setEuOnly}
            hint="Prices only from sellers in the EU (no customs). Items listed always count all countries." />
        </div>
      </div>
      {!home && (
        <div className="border-t border-line bg-paper">
          <div className="mx-auto max-w-[1200px] px-4 py-3 sm:px-6">
            <div className="max-w-2xl">
              <Search />
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
